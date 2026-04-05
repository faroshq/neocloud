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
	"k8s.io/client-go/transport/spdy"
	"k8s.io/klog/v2"

	kcputil "github.com/faroshq/kcp-ref-arch/project/platform/pkg/kcp"
)

var (
	vmGVR = schema.GroupVersionResource{
		Group:    "compute.cloud.platform",
		Version:  "v1alpha1",
		Resource: "virtualmachines",
	}
)

// Handler is a WebSocket SSH proxy that authenticates users, looks up their VM
// in kcp, and tunnels the SSH connection to the KubeVirt VM via the workload
// cluster's SPDY portforward subresource.
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
//  3. Dial the VM's SSH port via KubeVirt SPDY portforward
//  4. Upgrade to WebSocket and bridge the connections
func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	vmName := mux.Vars(r)["vm-name"]
	if vmName == "" {
		writeError(w, http.StatusBadRequest, "missing vm name")
		return
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
	vm, err := h.lookupVM(r.Context(), username, vmName)
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

	// Dial the VM's SSH port via SPDY portforward through the workload cluster API server.
	dataStream, err := h.dialVMPortforward(kvVMName, 22)
	if err != nil {
		h.logger.Error(err, "Failed to connect to VM via portforward", "kubevirtVM", kvVMName)
		writeError(w, http.StatusBadGateway, "failed to connect to VM SSH port")
		return
	}
	defer dataStream.Close()

	// Upgrade client connection to WebSocket.
	wsConn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		h.logger.Error(err, "WebSocket upgrade failed")
		return // Upgrade already wrote the error response.
	}
	defer wsConn.Close()

	h.logger.Info("SSH tunnel established", "user", username, "vm", vmName, "kubevirtVM", kvVMName)

	// Bridge WebSocket <-> VM SSH port.
	h.bridge(wsConn, dataStream)
}

// dialVMPortforward connects to a KubeVirt VM's SSH port via the SPDY portforward
// subresource on the workload cluster's API server. This tunnels through the
// K8s API server so we don't need direct pod network access.
func (h *Handler) dialVMPortforward(kvVMName string, port int) (io.ReadWriteCloser, error) {
	// Build the portforward URL for the KubeVirt VMI subresource.
	hostURL, err := url.Parse(h.workloadConfig.Host)
	if err != nil {
		return nil, fmt.Errorf("parsing workload host URL: %w", err)
	}

	pfURL := &url.URL{
		Scheme: hostURL.Scheme,
		Host:   hostURL.Host,
		Path: fmt.Sprintf("/apis/subresources.kubevirt.io/v1/namespaces/default/virtualmachineinstances/%s/portforward",
			kvVMName),
	}

	// Create SPDY transport using the workload cluster's rest.Config.
	transport, upgrader, err := spdy.RoundTripperFor(h.workloadConfig)
	if err != nil {
		return nil, fmt.Errorf("creating SPDY round tripper: %w", err)
	}

	h.logger.Info("Dialing SPDY portforward", "url", pfURL.String())

	// Pre-flight: check the endpoint is reachable and see what status we get.
	preReq, _ := http.NewRequest(http.MethodPost, pfURL.String(), nil)
	preResp, preErr := (&http.Client{Transport: transport}).Do(preReq)
	if preErr != nil {
		h.logger.Info("Pre-flight request failed", "error", preErr)
	} else {
		body, _ := io.ReadAll(io.LimitReader(preResp.Body, 512))
		preResp.Body.Close()
		h.logger.Info("Pre-flight response", "status", preResp.StatusCode, "body", string(body))
	}

	dialer := spdy.NewDialer(upgrader, &http.Client{Transport: transport}, http.MethodPost, pfURL)

	// Dial the SPDY connection using the portforward protocol.
	streamConn, protocol, err := dialer.Dial("portforward.k8s.io")
	if err != nil {
		return nil, fmt.Errorf("dialing SPDY portforward to %s: %w", pfURL.String(), err)
	}
	h.logger.V(4).Info("SPDY portforward connected", "protocol", protocol)

	// Create the request ID header (required for multiplexed connections).
	requestID := "0"
	headers := http.Header{}
	headers.Set("streamType", "error")
	headers.Set("port", fmt.Sprintf("%d", port))
	headers.Set("requestID", requestID)

	// Create error stream first (required by the portforward protocol).
	errorStream, err := streamConn.CreateStream(headers)
	if err != nil {
		streamConn.Close()
		return nil, fmt.Errorf("creating error stream: %w", err)
	}
	// Drain errors in background.
	go func() {
		buf := make([]byte, 1024)
		for {
			n, err := errorStream.Read(buf)
			if n > 0 {
				klog.V(4).Infof("portforward error stream: %s", string(buf[:n]))
			}
			if err != nil {
				return
			}
		}
	}()

	// Create data stream.
	headers.Set("streamType", "data")
	dataStream, err := streamConn.CreateStream(headers)
	if err != nil {
		streamConn.Close()
		return nil, fmt.Errorf("creating data stream: %w", err)
	}

	return dataStream, nil
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

// lookupVM finds a VirtualMachine by name in the user's kcp workspace.
func (h *Handler) lookupVM(ctx context.Context, username, vmName string) (*unstructured.Unstructured, error) {
	wsName := workspaceNameForUser(username)
	clusterPath := "root:platform:tenants:" + wsName

	// Build a kcp client scoped to the user's workspace.
	scopedConfig := rest.CopyConfig(h.kcpConfig)
	scopedConfig.Host = kcputil.ClusterURL(scopedConfig.Host, clusterPath)

	client, err := dynamic.NewForConfig(scopedConfig)
	if err != nil {
		return nil, fmt.Errorf("creating workspace client: %w", err)
	}

	// VirtualMachine is cluster-scoped, so we use an empty namespace.
	vm, err := client.Resource(vmGVR).Get(ctx, vmName, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("getting VM %q in workspace %s: %w", vmName, clusterPath, err)
	}

	return vm, nil
}

// bridge pipes data between the client WebSocket and the VM portforward stream.
func (h *Handler) bridge(clientWS *websocket.Conn, vmStream io.ReadWriteCloser) {
	var wg sync.WaitGroup
	wg.Add(2)

	// Client WebSocket → VM.
	go func() {
		defer wg.Done()
		for {
			_, data, err := clientWS.ReadMessage()
			if err != nil {
				break
			}
			if _, err := vmStream.Write(data); err != nil {
				break
			}
		}
		vmStream.Close()
	}()

	// VM → Client WebSocket.
	go func() {
		defer wg.Done()
		buf := make([]byte, 32*1024)
		for {
			n, err := vmStream.Read(buf)
			if n > 0 {
				if werr := clientWS.WriteMessage(websocket.BinaryMessage, buf[:n]); werr != nil {
					break
				}
			}
			if err != nil {
				break
			}
		}
		clientWS.Close()
	}()

	wg.Wait()
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
