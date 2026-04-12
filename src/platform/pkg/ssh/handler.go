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

// Package ssh provides a WebSocket-based SSH proxy that tunnels SSH connections
// to KubeVirt VMs through the Kubernetes API server's portforward subresource.
package ssh

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"

	oidc "github.com/coreos/go-oidc"
	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"golang.org/x/oauth2"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/rest"
	"k8s.io/klog/v2"

	kcputil "github.com/faroshq/kcp-ref-arch/project/platform/pkg/kcp"
)

const workloadNamespacePrefix = "tenant-"

var (
	vmGVR = schema.GroupVersionResource{
		Group:    "compute.cloud.platform",
		Version:  "v1alpha1",
		Resource: "virtualmachines",
	}

	logicalClusterGVR = schema.GroupVersionResource{
		Group:    "core.kcp.io",
		Version:  "v1alpha1",
		Resource: "logicalclusters",
	}
)

// Handler is a WebSocket SSH proxy that authenticates users, looks up their VM
// in kcp, and tunnels the SSH connection to the KubeVirt VM via the workload
// cluster's portforward subresource over WebSocket.
type Handler struct {
	kcpConfig        *rest.Config
	workloadConfig   *rest.Config
	verifier         *oidc.IDTokenVerifier
	verifyCtx        context.Context
	staticAuthTokens []string
	upgrader         websocket.Upgrader
	logger           klog.Logger
}

// NewHandler creates a new SSH proxy handler.
func NewHandler(kcpConfig *rest.Config, workloadConfig *rest.Config, verifier *oidc.IDTokenVerifier, staticAuthTokens []string, devMode bool) *Handler {
	verifyCtx := context.Background()
	if devMode {
		insecureClient := &http.Client{
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec // dev mode only
			},
		}
		verifyCtx = context.WithValue(verifyCtx, oauth2.HTTPClient, insecureClient)
	}

	return &Handler{
		kcpConfig:        kcpConfig,
		workloadConfig:   workloadConfig,
		verifier:         verifier,
		verifyCtx:        verifyCtx,
		staticAuthTokens: staticAuthTokens,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
		logger: klog.Background().WithName("ssh-proxy"),
	}
}

// ServeHTTP handles WebSocket SSH proxy requests.
//
// Flow:
//  1. Authenticate the user (static token or OIDC)
//  2. Look up the VM in the user's kcp workspace
//  3. Dial the VM's SSH port via KubeVirt WebSocket portforward
//  4. Upgrade to WebSocket and bridge the connections
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	vmName := mux.Vars(r)["vm-name"]
	if vmName == "" {
		writeError(w, http.StatusBadRequest, "missing vm name")
		return
	}

	// SSH clients send "user@host" — strip the SSH username prefix if present.
	if idx := strings.LastIndex(vmName, "@"); idx != -1 {
		vmName = vmName[idx+1:]
	}

	// Authenticate.
	username, err := h.authenticate(r)
	if err != nil {
		h.logger.Info("Authentication failed", "error", err)
		writeError(w, http.StatusUnauthorized, "Unauthorized")
		return
	}

	h.logger.Info("SSH proxy request", "user", username, "vm", vmName)

	// Look up the VM in the user's workspace.
	vm, workloadNS, err := h.lookupVM(r.Context(), username, vmName)
	if err != nil {
		h.logger.Error(err, "VM lookup failed", "user", username, "vm", vmName)
		writeError(w, http.StatusNotFound, fmt.Sprintf("VM %q not found or not accessible", vmName))
		return
	}

	// Verify VM is running.
	phase, _, _ := unstructured.NestedString(vm.Object, "status", "phase")
	if phase != "Running" {
		writeError(w, http.StatusConflict, fmt.Sprintf("VM %q is not running (phase: %s)", vmName, phase))
		return
	}

	// Get the KubeVirt VM name from the platform VM's UID.
	uid, _, _ := unstructured.NestedString(vm.Object, "metadata", "uid")
	if uid == "" {
		writeError(w, http.StatusInternalServerError, "VM has no UID")
		return
	}
	kvVMName := fmt.Sprintf("platform-%s", strings.ToLower(uid[:8]))

	// Dial the VM's SSH port via WebSocket portforward through the workload cluster API server.
	vmWS, err := h.dialVMPortforward(kvVMName, workloadNS, 22)
	if err != nil {
		h.logger.Error(err, "Failed to connect to VM via portforward", "kubevirtVM", kvVMName)
		writeError(w, http.StatusBadGateway, "failed to connect to VM SSH port")
		return
	}
	defer func() { _ = vmWS.Close() }()

	// Upgrade client connection to WebSocket.
	clientWS, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.logger.Error(err, "WebSocket upgrade failed")
		return // Upgrade already wrote the error response.
	}
	defer func() { _ = clientWS.Close() }()

	h.logger.Info("SSH tunnel established", "user", username, "vm", vmName, "kubevirtVM", kvVMName)

	// Bridge client WebSocket <-> VM WebSocket.
	h.bridgeWebSockets(clientWS, vmWS)
}

// dialVMPortforward connects to a KubeVirt VM's SSH port via WebSocket portforward
// through the workload cluster's API server.
func (h *Handler) dialVMPortforward(kvVMName string, namespace string, port int) (*websocket.Conn, error) {
	hostURL, err := url.Parse(h.workloadConfig.Host)
	if err != nil {
		return nil, fmt.Errorf("parsing workload host URL: %w", err)
	}

	// Build WebSocket URL for the KubeVirt VMI portforward subresource.
	wsScheme := "wss"
	if hostURL.Scheme == "http" {
		wsScheme = "ws"
	}

	// KubeVirt portforward subresource: the port goes in the URL path, not as a query param.
	// Format: /apis/subresources.kubevirt.io/v1/namespaces/{ns}/virtualmachineinstances/{name}/portforward/{port}/tcp
	pfURL := url.URL{
		Scheme: wsScheme,
		Host:   hostURL.Host,
		Path: fmt.Sprintf("/apis/subresources.kubevirt.io/v1/namespaces/%s/virtualmachineinstances/%s/portforward/%d/tcp",
			namespace, kvVMName, port),
	}

	// Build TLS config with client certs from the workload rest.Config.
	tlsConfig, err := rest.TLSConfigFor(h.workloadConfig)
	if err != nil {
		return nil, fmt.Errorf("building TLS config: %w", err)
	}
	if tlsConfig == nil {
		tlsConfig = &tls.Config{} //nolint:gosec
	}

	h.logger.Info("Dialing VM portforward", "url", pfURL.String(),
		"hasCerts", tlsConfig.GetClientCertificate != nil || len(tlsConfig.Certificates) > 0,
		"hasCA", tlsConfig.RootCAs != nil)

	dialer := websocket.Dialer{
		TLSClientConfig: tlsConfig,
		Subprotocols:    []string{"portforward.kubevirt.io"},
	}

	headers := http.Header{}
	if h.workloadConfig.BearerToken != "" {
		headers.Set("Authorization", "Bearer "+h.workloadConfig.BearerToken)
	}

	conn, resp, err := dialer.Dial(pfURL.String(), headers)
	if err != nil {
		if resp != nil {
			body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
			_ = resp.Body.Close()
			return nil, fmt.Errorf("dialing portforward WebSocket (status=%d, body=%s): %w", resp.StatusCode, string(body), err)
		}
		return nil, fmt.Errorf("dialing portforward WebSocket: %w", err)
	}

	h.logger.Info("VM portforward connected", "subprotocol", conn.Subprotocol())
	return conn, nil
}

// bridgeWebSockets pipes data between two WebSocket connections.
func (h *Handler) bridgeWebSockets(clientWS, vmWS *websocket.Conn) {
	var wg sync.WaitGroup
	wg.Add(2)

	// Client → VM.
	go func() {
		defer wg.Done()
		for {
			msgType, data, err := clientWS.ReadMessage()
			if err != nil {
				break
			}
			if err := vmWS.WriteMessage(msgType, data); err != nil {
				break
			}
		}
		_ = vmWS.Close()
	}()

	// VM → Client.
	go func() {
		defer wg.Done()
		for {
			msgType, data, err := vmWS.ReadMessage()
			if err != nil {
				break
			}
			if err := clientWS.WriteMessage(msgType, data); err != nil {
				break
			}
		}
		_ = clientWS.Close()
	}()

	wg.Wait()
}

// authenticate extracts and verifies the bearer token from the request.
// Returns the username on success.
func (h *Handler) authenticate(r *http.Request) (string, error) {
	token := extractToken(r)
	if token == "" {
		return "", fmt.Errorf("no bearer token")
	}

	// Check static tokens.
	for _, staticToken := range h.staticAuthTokens {
		if staticToken != "" && subtle.ConstantTimeCompare([]byte(token), []byte(staticToken)) == 1 {
			tokenHash := sha256.Sum256([]byte("static-token/" + token))
			subHash := hex.EncodeToString(tokenHash[:])[:63]
			return fmt.Sprintf("platform:static:%s", subHash[:16]), nil
		}
	}

	// Try OIDC verification.
	if h.verifier != nil {
		idToken, err := h.verifier.Verify(h.verifyCtx, token)
		if err == nil {
			return usernameFromIDToken(idToken)
		}
	}

	return "", fmt.Errorf("invalid token")
}

// usernameFromIDToken extracts the best username from OIDC token claims.
func usernameFromIDToken(idToken *oidc.IDToken) (string, error) {
	var claims struct {
		Email             string `json:"email"`
		PreferredUsername string `json:"preferred_username"`
		Name              string `json:"name"`
		Sub               string `json:"sub"`
	}
	if err := idToken.Claims(&claims); err != nil {
		return "", fmt.Errorf("parsing claims: %w", err)
	}

	for _, candidate := range []string{claims.Email, claims.PreferredUsername, claims.Name, claims.Sub} {
		if candidate != "" {
			return candidate, nil
		}
	}

	return "", fmt.Errorf("no usable identity in token")
}

// workspaceNameForUser derives a DNS-safe workspace name from a user identity.
// Must match the logic in pkg/auth/handler.go.
func workspaceNameForUser(username string) string {
	h := sha256.Sum256([]byte(username))
	return "u-" + hex.EncodeToString(h[:])[:10]
}

// lookupVM finds a VirtualMachine by name in the user's kcp workspace and returns
// the VM along with the workload namespace where the KubeVirt VM lives.
func (h *Handler) lookupVM(ctx context.Context, username, vmName string) (*unstructured.Unstructured, string, error) {
	wsName := workspaceNameForUser(username)
	clusterPath := "root:platform:tenants:" + wsName

	// Build a kcp client scoped to the user's workspace.
	scopedConfig := rest.CopyConfig(h.kcpConfig)
	scopedConfig.Host = kcputil.ClusterURL(scopedConfig.Host, clusterPath)

	client, err := dynamic.NewForConfig(scopedConfig)
	if err != nil {
		return nil, "", fmt.Errorf("creating workspace client: %w", err)
	}

	// VirtualMachine is cluster-scoped, so we use an empty namespace.
	vm, err := client.Resource(vmGVR).Get(ctx, vmName, metav1.GetOptions{})
	if err != nil {
		return nil, "", fmt.Errorf("getting VM %q in workspace %s: %w", vmName, clusterPath, err)
	}

	// Resolve the logical cluster name to derive the workload namespace.
	lc, err := client.Resource(logicalClusterGVR).Get(ctx, "cluster", metav1.GetOptions{})
	if err != nil {
		return nil, "", fmt.Errorf("getting LogicalCluster in %s: %w", clusterPath, err)
	}
	lcName := lc.GetName()
	clusterURL, _, _ := unstructured.NestedString(lc.Object, "status", "URL")
	if clusterURL != "" {
		if idx := strings.LastIndex(clusterURL, "/clusters/"); idx != -1 {
			lcName = clusterURL[idx+len("/clusters/"):]
		}
	}

	workloadNS := workloadNamespacePrefix + lcName
	return vm, workloadNS, nil
}

func extractToken(r *http.Request) string {
	authHeader := r.Header.Get("Authorization")
	if strings.HasPrefix(authHeader, "Bearer ") {
		return strings.TrimPrefix(authHeader, "Bearer ")
	}
	return ""
}

func writeError(w http.ResponseWriter, code int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_, _ = fmt.Fprintf(w, `{"kind":"Status","apiVersion":"v1","metadata":{},"status":"Failure","message":%q,"code":%d}`, message, code)
}
