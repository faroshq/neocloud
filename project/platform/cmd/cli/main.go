/*
Copyright 2026 The KCP Reference Architecture Authors.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package main

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	oidc "github.com/coreos/go-oidc"
	"github.com/gorilla/websocket"
	"github.com/spf13/cobra"
	"golang.org/x/oauth2"
"k8s.io/client-go/tools/clientcmd"
	clientcmdapi "k8s.io/client-go/tools/clientcmd/api"
	"k8s.io/klog/v2"

	"github.com/faroshq/kcp-ref-arch/project/platform/apis/auth"
	platformauth "github.com/faroshq/kcp-ref-arch/project/platform/pkg/auth"
)

func main() {
	cmd := &cobra.Command{
		Use:   "platform-cli",
		Short: "Platform CLI - authenticate and interact with the platform",
	}

	cmd.AddCommand(newLoginCommand())
	cmd.AddCommand(newGetTokenCommand())
	cmd.AddCommand(newSSHCommand())
	cmd.AddCommand(newSSHProxyCommand())

	goFlags := flag.NewFlagSet("", flag.ContinueOnError)
	klog.InitFlags(goFlags)
	cmd.PersistentFlags().AddGoFlagSet(goFlags)

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	if err := cmd.ExecuteContext(ctx); err != nil {
		klog.Fatal(err)
		os.Exit(1)
	}
}

// =============================================================================
// Token cache
// =============================================================================

// tokenCache is persisted to ~/.config/platform/tokens/<hash>.json.
type tokenCache struct {
	IDToken      string `json:"idToken"`
	RefreshToken string `json:"refreshToken,omitempty"`
	ExpiresAt    int64  `json:"expiresAt"`
	IssuerURL    string `json:"issuerUrl"`
	ClientID     string `json:"clientId"`
}

func tokenCacheDir() string {
	cfgDir, err := os.UserConfigDir()
	if err != nil {
		cfgDir = filepath.Join(os.Getenv("HOME"), ".config")
	}
	return filepath.Join(cfgDir, "platform", "tokens")
}

func tokenCacheKey(issuerURL, clientID string) string {
	h := sha256.Sum256([]byte(issuerURL + "\n" + clientID))
	return hex.EncodeToString(h[:])[:32]
}

func tokenCachePath(issuerURL, clientID string) string {
	return filepath.Join(tokenCacheDir(), tokenCacheKey(issuerURL, clientID)+".json")
}

func loadTokenCache(issuerURL, clientID string) (*tokenCache, error) {
	data, err := os.ReadFile(tokenCachePath(issuerURL, clientID))
	if err != nil {
		return nil, err
	}
	var tc tokenCache
	if err := json.Unmarshal(data, &tc); err != nil {
		return nil, err
	}
	return &tc, nil
}

func saveTokenCache(tc *tokenCache) error {
	dir := tokenCacheDir()
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("creating token cache dir: %w", err)
	}
	data, err := json.MarshalIndent(tc, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(tokenCachePath(tc.IssuerURL, tc.ClientID), data, 0600)
}

func (tc *tokenCache) isExpired() bool {
	return time.Now().Unix() > tc.ExpiresAt-30
}

// =============================================================================
// get-token command (exec credential plugin)
// =============================================================================

func newGetTokenCommand() *cobra.Command {
	var (
		issuerURL             string
		clientID              string
		insecureSkipTLSVerify bool
	)

	cmd := &cobra.Command{
		Use:    "get-token",
		Short:  "Get an OIDC token (exec credential plugin for kubectl)",
		Hidden: true, // Called by kubectl, not directly by users.
		RunE: func(cmd *cobra.Command, args []string) error {
			if issuerURL == "" || clientID == "" {
				return fmt.Errorf("--oidc-issuer-url and --oidc-client-id are required")
			}
			return runGetToken(cmd.Context(), issuerURL, clientID, insecureSkipTLSVerify)
		},
	}

	cmd.Flags().StringVar(&issuerURL, "oidc-issuer-url", "", "OIDC provider issuer URL")
	cmd.Flags().StringVar(&clientID, "oidc-client-id", "", "OIDC client ID")
	cmd.Flags().BoolVar(&insecureSkipTLSVerify, "insecure-skip-tls-verify", false, "Skip TLS verification for OIDC provider")

	return cmd
}

func runGetToken(ctx context.Context, issuerURL, clientID string, insecure bool) error {
	tc, err := loadTokenCache(issuerURL, clientID)
	if err != nil {
		return fmt.Errorf("no cached token found — run 'platform-cli login' first: %w", err)
	}

	// Refresh if expired.
	if tc.isExpired() {
		if tc.RefreshToken == "" {
			return fmt.Errorf("token expired and no refresh token — run 'platform-cli login' again")
		}
		if err := refreshToken(ctx, tc, insecure); err != nil {
			return fmt.Errorf("token refresh failed — run 'platform-cli login' again: %w", err)
		}
		if err := saveTokenCache(tc); err != nil {
			klog.V(2).Infof("Warning: failed to save refreshed token: %v", err)
		}
	}

	// Output ExecCredential JSON to stdout.
	expiry := time.Unix(tc.ExpiresAt, 0).UTC().Format(time.RFC3339)
	cred := map[string]interface{}{
		"apiVersion": "client.authentication.k8s.io/v1beta1",
		"kind":       "ExecCredential",
		"status": map[string]interface{}{
			"token":               tc.IDToken,
			"expirationTimestamp": expiry,
		},
	}

	data, err := json.Marshal(cred)
	if err != nil {
		return fmt.Errorf("encoding ExecCredential: %w", err)
	}
	_, err = os.Stdout.Write(data)
	return err
}

func refreshToken(ctx context.Context, tc *tokenCache, insecure bool) error {
	providerCtx := ctx
	if insecure {
		tr := &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec
		}
		httpClient := &http.Client{Transport: tr}
		providerCtx = oidc.ClientContext(ctx, httpClient)
	}

	provider, err := oidc.NewProvider(providerCtx, tc.IssuerURL)
	if err != nil {
		return fmt.Errorf("creating OIDC provider: %w", err)
	}

	oauth2Config := &oauth2.Config{
		ClientID: tc.ClientID,
		Endpoint: provider.Endpoint(),
		Scopes:   []string{oidc.ScopeOpenID, "profile", "email", "offline_access"},
	}

	exchangeCtx := ctx
	if insecure {
		tr := &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec
		}
		httpClient := &http.Client{Transport: tr}
		exchangeCtx = context.WithValue(ctx, oauth2.HTTPClient, httpClient)
	}

	tokenSource := oauth2Config.TokenSource(exchangeCtx, &oauth2.Token{
		RefreshToken: tc.RefreshToken,
	})
	newToken, err := tokenSource.Token()
	if err != nil {
		return fmt.Errorf("refreshing token: %w", err)
	}

	rawIDToken, ok := newToken.Extra("id_token").(string)
	if !ok {
		return fmt.Errorf("no id_token in refresh response")
	}

	tc.IDToken = rawIDToken
	tc.RefreshToken = newToken.RefreshToken
	tc.ExpiresAt = newToken.Expiry.Unix()
	return nil
}

// =============================================================================
// login command
// =============================================================================

func newLoginCommand() *cobra.Command {
	var (
		hubURL                string
		insecureSkipTLSVerify bool
		token                 string
	)

	cmd := &cobra.Command{
		Use:   "login",
		Short: "Authenticate with the platform hub (OIDC or static token)",
		Long: `Authenticate with the platform hub.

Without --token, opens a browser for OIDC login (Zitadel).
With --token, uses static bearer token authentication.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if hubURL == "" {
				return fmt.Errorf("--hub-url is required")
			}
			hubURL = strings.TrimRight(hubURL, "/")

			if token != "" {
				return runStaticTokenLogin(hubURL, token, insecureSkipTLSVerify)
			}
			return runOIDCLogin(cmd.Context(), hubURL, insecureSkipTLSVerify)
		},
	}

	cmd.Flags().StringVar(&hubURL, "hub-url", "", "Platform hub server URL (required)")
	cmd.Flags().BoolVar(&insecureSkipTLSVerify, "insecure-skip-tls-verify", false, "Skip TLS certificate verification")
	cmd.Flags().StringVar(&token, "token", "", "Static bearer token (if omitted, OIDC browser login is used)")

	return cmd
}

func runOIDCLogin(ctx context.Context, hubURL string, insecure bool) error {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("starting callback listener: %w", err)
	}
	defer listener.Close()

	port := listener.Addr().(*net.TCPAddr).Port
	callbackURL := fmt.Sprintf("http://127.0.0.1:%d/callback", port)

	responseCh := make(chan *platformauth.CallbackResponse, 1)
	errCh := make(chan error, 1)

	mux := http.NewServeMux()
	mux.HandleFunc("/callback", func(w http.ResponseWriter, r *http.Request) {
		responseParam := r.URL.Query().Get("response")
		if responseParam == "" {
			http.Error(w, "missing response parameter", http.StatusBadRequest)
			errCh <- fmt.Errorf("callback missing response parameter")
			return
		}

		decoded, err := base64.URLEncoding.DecodeString(responseParam)
		if err != nil {
			http.Error(w, "invalid response parameter", http.StatusBadRequest)
			errCh <- fmt.Errorf("decoding callback response: %w", err)
			return
		}

		var resp platformauth.CallbackResponse
		if err := json.Unmarshal(decoded, &resp); err != nil {
			http.Error(w, "invalid response payload", http.StatusBadRequest)
			errCh <- fmt.Errorf("parsing callback response: %w", err)
			return
		}

		w.Header().Set("Content-Type", "text/html")
		_, _ = fmt.Fprint(w, `<!DOCTYPE html><html><body>
			<h2>Login successful!</h2>
			<p>You can close this window and return to the terminal.</p>
			<script>window.close();</script>
		</body></html>`)

		responseCh <- &resp
	})

	server := &http.Server{Handler: mux}
	go func() {
		if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
			errCh <- err
		}
	}()
	defer server.Close()

	authorizeURL := fmt.Sprintf("%s/auth/authorize?redirect_uri=%s", hubURL, callbackURL)
	fmt.Printf("Opening browser for OIDC login...\n")
	fmt.Printf("If the browser doesn't open, visit:\n  %s\n\n", authorizeURL)

	if err := openBrowser(authorizeURL); err != nil {
		klog.V(2).Infof("Failed to open browser: %v", err)
	}

	fmt.Printf("Waiting for authentication...\n")
	select {
	case resp := <-responseCh:
		return handleOIDCResponse(resp, insecure)
	case err := <-errCh:
		return fmt.Errorf("OIDC login failed: %w", err)
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(5 * time.Minute):
		return fmt.Errorf("OIDC login timed out (5 minutes)")
	}
}

func handleOIDCResponse(resp *platformauth.CallbackResponse, insecure bool) error {
	// 1. Save tokens to cache for the get-token exec plugin.
	tc := &tokenCache{
		IDToken:      resp.IDToken,
		RefreshToken: resp.RefreshToken,
		ExpiresAt:    resp.ExpiresAt,
		IssuerURL:    resp.IssuerURL,
		ClientID:     resp.ClientID,
	}
	if err := saveTokenCache(tc); err != nil {
		return fmt.Errorf("saving token cache: %w", err)
	}

	// 2. Build kubeconfig with exec credential plugin and user's cluster URL.
	hubURL := resp.HubURL
	serverURL := hubURL
	if resp.ClusterName != "" {
		// ClusterName is the full kcp cluster path (e.g. "root:platform:tenants:u-abc123").
		serverURL = hubURL + "/clusters/" + resp.ClusterName
	}

	// Find the platform-cli binary path for the exec plugin.
	cliPath, err := os.Executable()
	if err != nil {
		cliPath = "platform-cli" // Fall back to PATH lookup.
	}

	config := clientcmdapi.NewConfig()

	config.Clusters["platform"] = &clientcmdapi.Cluster{
		Server:                serverURL,
		InsecureSkipTLSVerify: insecure,
	}

	execArgs := []string{
		"get-token",
		"--oidc-issuer-url=" + resp.IssuerURL,
		"--oidc-client-id=" + resp.ClientID,
	}
	if insecure {
		execArgs = append(execArgs, "--insecure-skip-tls-verify")
	}

	config.AuthInfos["platform"] = &clientcmdapi.AuthInfo{
		Exec: &clientcmdapi.ExecConfig{
			APIVersion: "client.authentication.k8s.io/v1beta1",
			Command:    cliPath,
			Args:       execArgs,
		},
	}

	config.Contexts["platform"] = &clientcmdapi.Context{
		Cluster:  "platform",
		AuthInfo: "platform",
	}

	config.CurrentContext = "platform"

	kubeconfigBytes, err := clientcmd.Write(*config)
	if err != nil {
		return fmt.Errorf("serializing kubeconfig: %w", err)
	}

	if err := mergeKubeconfig(kubeconfigBytes); err != nil {
		return fmt.Errorf("merging kubeconfig: %w", err)
	}

	fmt.Printf("Login successful! User: %s\n", resp.Email)
	fmt.Printf("Cluster: %s\n", serverURL)
	fmt.Printf("Kubeconfig context \"platform\" has been set.\n")
	fmt.Printf("Run: kubectl --context=platform get namespaces\n")
	return nil
}

func openBrowser(url string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", url).Start()
	case "linux":
		return exec.Command("xdg-open", url).Start()
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	default:
		return fmt.Errorf("unsupported platform")
	}
}

// =============================================================================
// static token login
// =============================================================================

func runStaticTokenLogin(hubURL, token string, insecure bool) error {
	client := &http.Client{Timeout: 10 * time.Second}
	if insecure {
		client.Transport = &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec
		}
	}

	req, err := http.NewRequest(http.MethodPost, hubURL+"/auth/token-login", nil)
	if err != nil {
		return fmt.Errorf("creating request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("calling token-login endpoint: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("reading response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("token-login failed (status %d): %s", resp.StatusCode, string(body))
	}

	var loginResp auth.LoginResponse
	if err := json.Unmarshal(body, &loginResp); err != nil {
		return fmt.Errorf("parsing login response: %w", err)
	}

	if err := mergeKubeconfig(loginResp.Kubeconfig); err != nil {
		return fmt.Errorf("merging kubeconfig: %w", err)
	}

	fmt.Printf("Login successful! User: %s\n", loginResp.UserID)
	fmt.Printf("Kubeconfig context \"platform\" has been set.\n")
	fmt.Printf("Run: kubectl --context=platform get namespaces\n")
	return nil
}

// =============================================================================
// kubeconfig helpers
// =============================================================================

func mergeKubeconfig(kubeconfigBytes []byte) error {
	newConfig, err := clientcmd.Load(kubeconfigBytes)
	if err != nil {
		return fmt.Errorf("parsing received kubeconfig: %w", err)
	}

	loadingRules := clientcmd.NewDefaultClientConfigLoadingRules()
	existingConfig, err := loadingRules.GetStartingConfig()
	if err != nil {
		existingConfig = clientcmdapi.NewConfig()
	}

	for k, v := range newConfig.Clusters {
		existingConfig.Clusters[k] = v
	}
	for k, v := range newConfig.AuthInfos {
		existingConfig.AuthInfos[k] = v
	}
	for k, v := range newConfig.Contexts {
		existingConfig.Contexts[k] = v
	}
	existingConfig.CurrentContext = newConfig.CurrentContext

	configPath := loadingRules.GetDefaultFilename()
	if err := clientcmd.WriteToFile(*existingConfig, configPath); err != nil {
		return fmt.Errorf("writing kubeconfig to %s: %w", configPath, err)
	}

	return nil
}

// =============================================================================
// ssh command (interactive SSH via WebSocket tunnel)
// =============================================================================

func newSSHCommand() *cobra.Command {
	var (
		hubURL                string
		insecureSkipTLSVerify bool
		token                 string
		username              string
	)

	cmd := &cobra.Command{
		Use:   "ssh <vm-name>",
		Short: "SSH into a virtual machine via the platform proxy",
		Long: `Opens an interactive SSH session to a VM through the platform's
WebSocket SSH proxy. Spawns an OpenSSH client using the built-in
ssh-proxy as the ProxyCommand. Authenticates using a cached OIDC token
(from 'platform-cli login') or a static bearer token.`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			vmName := args[0]

			// Find our own binary to use as ProxyCommand.
			self, err := os.Executable()
			if err != nil {
				return fmt.Errorf("finding own executable: %w", err)
			}

			// Build the ProxyCommand that calls our ssh-proxy subcommand.
			proxyCmd := fmt.Sprintf("%s ssh-proxy %s", self, vmName)
			if hubURL != "" {
				proxyCmd += fmt.Sprintf(" --hub-url %s", hubURL)
			}
			if insecureSkipTLSVerify {
				proxyCmd += " --insecure-skip-tls-verify"
			}
			if token != "" {
				proxyCmd += fmt.Sprintf(" --token %s", token)
			}

			// Spawn ssh with our proxy command.
			sshArgs := []string{
				"-o", fmt.Sprintf("ProxyCommand=%s", proxyCmd),
				"-o", "StrictHostKeyChecking=no",
				"-o", "UserKnownHostsFile=/dev/null",
				fmt.Sprintf("%s@%s", username, vmName),
			}

			sshBin, err := exec.LookPath("ssh")
			if err != nil {
				return fmt.Errorf("ssh not found in PATH: %w", err)
			}

			sshCmd := exec.CommandContext(cmd.Context(), sshBin, sshArgs...)
			sshCmd.Stdin = os.Stdin
			sshCmd.Stdout = os.Stdout
			sshCmd.Stderr = os.Stderr

			return sshCmd.Run()
		},
	}

	cmd.Flags().StringVar(&hubURL, "hub-url", "", "Platform hub server URL (defaults to kubeconfig 'platform' context)")
	cmd.Flags().BoolVar(&insecureSkipTLSVerify, "insecure-skip-tls-verify", false, "Skip TLS certificate verification")
	cmd.Flags().StringVar(&token, "token", "", "Bearer token (defaults to cached OIDC token)")
	cmd.Flags().StringVarP(&username, "user", "l", "root", "SSH username")

	return cmd
}

// =============================================================================
// ssh-proxy command (ProxyCommand mode for OpenSSH)
// =============================================================================

func newSSHProxyCommand() *cobra.Command {
	var (
		hubURL                string
		insecureSkipTLSVerify bool
		token                 string
	)

	cmd := &cobra.Command{
		Use:   "ssh-proxy <vm-name>",
		Short: "SSH ProxyCommand for use with OpenSSH",
		Long: `Bridges stdin/stdout to the platform's WebSocket SSH proxy.
Use as an OpenSSH ProxyCommand:

  ssh -o 'ProxyCommand=platform-cli ssh-proxy %h' user@my-vm`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			vmName := args[0]
			bearerToken, err := resolveToken(cmd.Context(), token, insecureSkipTLSVerify)
			if err != nil {
				return err
			}
			hubURL, err = resolveHubURL(hubURL)
			if err != nil {
				return err
			}
			return runSSHProxy(cmd.Context(), hubURL, vmName, bearerToken, insecureSkipTLSVerify)
		},
	}

	cmd.Flags().StringVar(&hubURL, "hub-url", "", "Platform hub server URL (defaults to kubeconfig 'platform' context)")
	cmd.Flags().BoolVar(&insecureSkipTLSVerify, "insecure-skip-tls-verify", false, "Skip TLS certificate verification")
	cmd.Flags().StringVar(&token, "token", "", "Bearer token (defaults to cached OIDC token)")

	return cmd
}

// resolveToken returns the bearer token to use: explicit flag, or cached OIDC token,
// or the static token from kubeconfig.
func resolveToken(ctx context.Context, explicit string, insecure bool) (string, error) {
	if explicit != "" {
		return explicit, nil
	}

	// Try to load from kubeconfig's platform context exec credential.
	loadingRules := clientcmd.NewDefaultClientConfigLoadingRules()
	cfg, err := loadingRules.GetStartingConfig()
	if err == nil {
		if ctxCfg, ok := cfg.Contexts["platform"]; ok {
			if authInfo, ok := cfg.AuthInfos[ctxCfg.AuthInfo]; ok {
				// If exec-based (OIDC), run get-token logic.
				if authInfo.Exec != nil {
					for i, arg := range authInfo.Exec.Args {
						if strings.HasPrefix(arg, "--oidc-issuer-url=") {
							issuerURL := strings.TrimPrefix(arg, "--oidc-issuer-url=")
							var clientID string
							for _, a := range authInfo.Exec.Args[i:] {
								if strings.HasPrefix(a, "--oidc-client-id=") {
									clientID = strings.TrimPrefix(a, "--oidc-client-id=")
									break
								}
							}
							if clientID != "" {
								tc, err := loadTokenCache(issuerURL, clientID)
								if err == nil {
									if tc.isExpired() && tc.RefreshToken != "" {
										_ = refreshToken(ctx, tc, insecure)
										_ = saveTokenCache(tc)
									}
									if !tc.isExpired() {
										return tc.IDToken, nil
									}
								}
							}
							break
						}
					}
				}
				// If token-based auth.
				if authInfo.Token != "" {
					return authInfo.Token, nil
				}
			}
		}
	}

	return "", fmt.Errorf("no token available — run 'platform-cli login' first or pass --token")
}

// resolveHubURL returns the hub URL: explicit flag, or from kubeconfig's platform context.
func resolveHubURL(explicit string) (string, error) {
	if explicit != "" {
		return strings.TrimRight(explicit, "/"), nil
	}

	loadingRules := clientcmd.NewDefaultClientConfigLoadingRules()
	cfg, err := loadingRules.GetStartingConfig()
	if err == nil {
		if ctxCfg, ok := cfg.Contexts["platform"]; ok {
			if cluster, ok := cfg.Clusters[ctxCfg.Cluster]; ok {
				// Strip /clusters/... path to get the base hub URL.
				serverURL := cluster.Server
				if idx := strings.Index(serverURL, "/clusters/"); idx != -1 {
					serverURL = serverURL[:idx]
				}
				return strings.TrimRight(serverURL, "/"), nil
			}
		}
	}

	return "", fmt.Errorf("--hub-url is required (no 'platform' context found in kubeconfig)")
}

// runSSHProxy connects to the platform SSH proxy via WebSocket and bridges
// stdin/stdout for use as an OpenSSH ProxyCommand.
func runSSHProxy(ctx context.Context, hubURL, vmName, token string, insecure bool) error {
	// Build WebSocket URL.
	wsURL := strings.Replace(hubURL, "https://", "wss://", 1)
	wsURL = strings.Replace(wsURL, "http://", "ws://", 1)
	wsURL = fmt.Sprintf("%s/ssh/%s", wsURL, vmName)

	dialer := &websocket.Dialer{}
	if insecure {
		dialer.TLSClientConfig = &tls.Config{InsecureSkipVerify: true} //nolint:gosec
	}

	headers := http.Header{}
	headers.Set("Authorization", "Bearer "+token)

	conn, resp, err := dialer.DialContext(ctx, wsURL, headers)
	if err != nil {
		if resp != nil {
			body, _ := io.ReadAll(resp.Body)
			resp.Body.Close()
			return fmt.Errorf("SSH proxy connection failed (status %d): %s", resp.StatusCode, string(body))
		}
		return fmt.Errorf("SSH proxy connection failed: %w", err)
	}
	defer conn.Close()

	errCh := make(chan error, 2)

	// stdin → WebSocket.
	go func() {
		buf := make([]byte, 32*1024)
		for {
			n, err := os.Stdin.Read(buf)
			if n > 0 {
				if werr := conn.WriteMessage(websocket.BinaryMessage, buf[:n]); werr != nil {
					errCh <- werr
					return
				}
			}
			if err != nil {
				errCh <- err
				return
			}
		}
	}()

	// WebSocket → stdout.
	go func() {
		for {
			_, data, err := conn.ReadMessage()
			if err != nil {
				errCh <- err
				return
			}
			if _, err := os.Stdout.Write(data); err != nil {
				errCh <- err
				return
			}
		}
	}()

	// Wait for either direction to finish.
	select {
	case <-ctx.Done():
		return ctx.Err()
	case err := <-errCh:
		// EOF from stdin or WebSocket close are normal termination.
		if err == io.EOF {
			return nil
		}
		if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
			return nil
		}
		return err
	}
}
