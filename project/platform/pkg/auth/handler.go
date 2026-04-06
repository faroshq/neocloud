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

// Package auth provides OIDC authentication endpoints for the platform.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	oidc "github.com/coreos/go-oidc"
	"github.com/gorilla/mux"
	"golang.org/x/oauth2"
	"k8s.io/klog/v2"
)

// OIDCConfig holds OIDC provider settings.
type OIDCConfig struct {
	IssuerURL string
	ClientID  string
	// RedirectURL is built from HubExternalURL + "/auth/callback".
	RedirectURL string
	Scopes      []string
}

// authState is encoded into the OAuth2 state parameter.
type authState struct {
	RedirectURL  string `json:"redirectURL"`
	SessionID    string `json:"sessionID"`
	CodeVerifier string `json:"codeVerifier"`
	// PlatformState is the downstream client's OAuth2 state (e.g. from Headlamp).
	// When set, the callback uses the OIDC proxy code flow instead of the
	// legacy response= redirect.
	PlatformState string `json:"platformState,omitempty"`
}

// CallbackResponse is returned to the browser/CLI after successful OIDC login.
type CallbackResponse struct {
	IDToken      string `json:"idToken"`
	RefreshToken string `json:"refreshToken,omitempty"`
	ExpiresAt    int64  `json:"expiresAt"`
	Email        string `json:"email"`
	ClusterName  string `json:"clusterName,omitempty"`
	// OIDC config needed by the CLI to refresh tokens.
	IssuerURL string `json:"issuerURL,omitempty"`
	ClientID  string `json:"clientID,omitempty"`
	// Hub URL so the CLI can build the kubeconfig server URL.
	HubURL string `json:"hubURL,omitempty"`
}

// WorkspaceProvisioner creates tenant workspaces and RBAC on login.
// Implemented by the kcp bootstrapper.
type WorkspaceProvisioner interface {
	// EnsureTenantWorkspace creates the workspace and RBAC if they don't exist.
	// Returns the full kcp workspace path (e.g. "root:platform:tenants:u-abc123").
	EnsureTenantWorkspace(ctx context.Context, workspaceName, oidcUserName string) (string, error)
}

// pendingAuth stores the result of a completed OIDC flow, keyed by a
// short-lived platform auth code. This lets the platform server act as
// an OIDC provider proxy: the callback issues a code that the downstream
// client (e.g. Headlamp) exchanges at /auth/token.
type pendingAuth struct {
	rawIDToken   string
	refreshToken string
	expiresAt    int64
	email        string
	clusterPath  string
	createdAt    time.Time
}

// Handler provides OAuth2/OIDC authentication endpoints.
type Handler struct {
	oidcProvider   *oidc.Provider
	oauth2Config   *oauth2.Config
	oidcConfig     *OIDCConfig
	hubExternalURL string
	provisioner    WorkspaceProvisioner
	devMode        bool
	logger         klog.Logger

	// pendingCodes maps platform-issued auth codes to their token data.
	// Codes are single-use and expire after 60 seconds.
	pendingMu    sync.Mutex
	pendingCodes map[string]*pendingAuth
}

// NewHandler creates a new OIDC auth handler.
// provisioner may be nil if workspace auto-creation is not needed.
func NewHandler(ctx context.Context, config *OIDCConfig, hubExternalURL string, provisioner WorkspaceProvisioner, devMode bool) (*Handler, error) {
	if config.IssuerURL == "" {
		return nil, fmt.Errorf("OIDC issuer URL is required")
	}

	providerCtx := ctx
	if devMode {
		tr := &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec // dev mode only
		}
		httpClient := &http.Client{Transport: tr}
		providerCtx = oidc.ClientContext(ctx, httpClient)
	}

	provider, err := oidc.NewProvider(providerCtx, config.IssuerURL)
	if err != nil {
		return nil, fmt.Errorf("creating OIDC provider: %w", err)
	}

	if config.Scopes == nil {
		config.Scopes = []string{oidc.ScopeOpenID, "profile", "email", "offline_access"}
	}
	if config.RedirectURL == "" {
		config.RedirectURL = hubExternalURL + "/auth/callback"
	}

	oauth2Config := &oauth2.Config{
		ClientID:    config.ClientID,
		RedirectURL: config.RedirectURL,
		Endpoint:    provider.Endpoint(),
		Scopes:      config.Scopes,
	}

	return &Handler{
		oidcProvider:   provider,
		oauth2Config:   oauth2Config,
		oidcConfig:     config,
		hubExternalURL: hubExternalURL,
		provisioner:    provisioner,
		devMode:        devMode,
		logger:         klog.Background().WithName("auth-handler"),
		pendingCodes:   make(map[string]*pendingAuth),
	}, nil
}

// Verifier returns the OIDC token verifier for use by other components.
func (h *Handler) Verifier() *oidc.IDTokenVerifier {
	return h.oidcProvider.Verifier(&oidc.Config{ClientID: h.oidcConfig.ClientID})
}

// RegisterRoutes registers auth routes on the given router.
func (h *Handler) RegisterRoutes(router *mux.Router) {
	router.HandleFunc("/.well-known/openid-configuration", h.HandleDiscovery).Methods("GET")
	router.HandleFunc("/auth/authorize", h.HandleAuthorize).Methods("GET")
	router.HandleFunc("/auth/callback", h.HandleCallback).Methods("GET")
	router.HandleFunc("/auth/token", h.HandleTokenExchange).Methods("POST")
	router.HandleFunc("/auth/keys", h.HandleJWKS).Methods("GET")
	router.HandleFunc("/auth/me", h.HandleMe).Methods("GET", "OPTIONS")
}

// HandleAuthorize redirects to the OIDC provider for authentication.
//
// Browser/portal flow:
//
//	GET /auth/authorize?redirect_uri=<console_callback_url>
//
// The handler generates a PKCE code_verifier, stores it in the OAuth2 state,
// and redirects to the OIDC provider with the S256 code_challenge.
func (h *Handler) HandleAuthorize(w http.ResponseWriter, r *http.Request) {
	redirectURI := r.URL.Query().Get("redirect_uri")
	if redirectURI == "" {
		http.Error(w, "missing redirect_uri parameter", http.StatusBadRequest)
		return
	}

	if err := h.validateRedirectURI(redirectURI); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	// Generate PKCE code_verifier server-side.
	codeVerifier, err := generateCodeVerifier()
	if err != nil {
		http.Error(w, "failed to generate PKCE verifier", http.StatusInternalServerError)
		return
	}

	sessionID := r.URL.Query().Get("s")
	if sessionID == "" {
		sessionID = "browser"
	}

	// If the caller passes a standard OAuth2 "state" param, store it so the
	// callback can return it alongside the platform-issued code (OIDC proxy mode).
	clientState := r.URL.Query().Get("state")

	state := authState{
		RedirectURL:   redirectURI,
		SessionID:     sessionID,
		CodeVerifier:  codeVerifier,
		PlatformState: clientState,
	}
	stateJSON, err := json.Marshal(state)
	if err != nil {
		http.Error(w, "failed to encode state", http.StatusInternalServerError)
		return
	}
	stateParam := base64.URLEncoding.EncodeToString(stateJSON)

	authURL := h.oauth2Config.AuthCodeURL(stateParam, oauth2.S256ChallengeOption(codeVerifier))
	http.Redirect(w, r, authURL, http.StatusFound)
}

// oidcClaims captures all relevant claims from the ID token.
// Different OIDC providers use different claim names.
type oidcClaims struct {
	Email             string `json:"email"`
	PreferredUsername string `json:"preferred_username"`
	Name              string `json:"name"`
	Sub               string `json:"sub"`
}

// username returns the best available username from the claims.
func (c *oidcClaims) username() string {
	if c.Email != "" {
		return c.Email
	}
	if c.PreferredUsername != "" {
		return c.PreferredUsername
	}
	if c.Name != "" {
		return c.Name
	}
	return c.Sub
}

// HandleCallback handles the OIDC callback after authentication.
func (h *Handler) HandleCallback(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	code := r.URL.Query().Get("code")
	stateParam := r.URL.Query().Get("state")
	if code == "" || stateParam == "" {
		http.Error(w, "missing code or state parameter", http.StatusBadRequest)
		return
	}

	stateJSON, err := base64.URLEncoding.DecodeString(stateParam)
	if err != nil {
		http.Error(w, "invalid state parameter", http.StatusBadRequest)
		return
	}
	var state authState
	if err := json.Unmarshal(stateJSON, &state); err != nil {
		http.Error(w, "invalid state payload", http.StatusBadRequest)
		return
	}

	// Exchange code for tokens using PKCE verifier (no client secret).
	exchangeCtx := ctx
	if h.devMode {
		tr := &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec // dev mode only
		}
		httpClient := &http.Client{Transport: tr}
		exchangeCtx = context.WithValue(ctx, oauth2.HTTPClient, httpClient)
	}

	token, err := h.oauth2Config.Exchange(exchangeCtx, code, oauth2.VerifierOption(state.CodeVerifier))
	if err != nil {
		h.logger.Error(err, "failed to exchange code for token")
		http.Error(w, "token exchange failed", http.StatusInternalServerError)
		return
	}

	rawIDToken, ok := token.Extra("id_token").(string)
	if !ok {
		http.Error(w, "missing id_token in token response", http.StatusInternalServerError)
		return
	}

	// Verify the ID token.
	verifier := h.oidcProvider.Verifier(&oidc.Config{ClientID: h.oidcConfig.ClientID})
	idToken, err := verifier.Verify(ctx, rawIDToken)
	if err != nil {
		h.logger.Error(err, "failed to verify ID token")
		http.Error(w, "token verification failed", http.StatusInternalServerError)
		return
	}

	// Parse claims — try multiple claim names for compatibility.
	var claims oidcClaims
	if err := idToken.Claims(&claims); err != nil {
		h.logger.Error(err, "failed to parse ID token claims")
		http.Error(w, "failed to parse claims", http.StatusInternalServerError)
		return
	}

	// Log all claims for debugging.
	var allClaims map[string]interface{}
	_ = idToken.Claims(&allClaims)
	h.logger.Info("OIDC login", "sub", claims.Sub, "email", claims.Email,
		"preferred_username", claims.PreferredUsername, "name", claims.Name,
		"allClaims", allClaims)

	username := claims.username()
	if username == "" {
		h.logger.Error(nil, "no usable identity claim found in token", "claims", allClaims)
		http.Error(w, "no usable identity in token (missing email, preferred_username, name, sub)", http.StatusInternalServerError)
		return
	}

	// Derive workspace name from the user identity.
	wsName := workspaceNameForUser(username)

	// The OIDC user name as kcp sees it (with oidc: prefix from RootShard config).
	oidcUserName := "oidc:" + username

	// Provision workspace and RBAC if a provisioner is configured.
	clusterPath := ""
	if h.provisioner != nil {
		var err error
		clusterPath, err = h.provisioner.EnsureTenantWorkspace(ctx, wsName, oidcUserName)
		if err != nil {
			h.logger.Error(err, "failed to provision tenant workspace", "workspace", wsName, "user", oidcUserName)
			http.Error(w, "failed to provision workspace", http.StatusInternalServerError)
			return
		}
		h.logger.Info("Provisioned tenant workspace", "workspace", wsName, "clusterPath", clusterPath, "user", oidcUserName)
	}

	// Determine whether the caller expects a standard OIDC code flow
	// (e.g. Headlamp) or the legacy response= redirect (CLI/console).
	// If the state contains a platformState, use the OIDC code flow.
	if state.PlatformState != "" {
		// OIDC proxy mode: issue a platform auth code and redirect with
		// code= and state= params, like a standard OIDC provider.
		platformCode, err := generateCodeVerifier()
		if err != nil {
			http.Error(w, "failed to generate auth code", http.StatusInternalServerError)
			return
		}

		h.pendingMu.Lock()
		h.pendingCodes[platformCode] = &pendingAuth{
			rawIDToken:   rawIDToken,
			refreshToken: token.RefreshToken,
			expiresAt:    token.Expiry.Unix(),
			email:        username,
			clusterPath:  clusterPath,
			createdAt:    time.Now(),
		}
		h.pendingMu.Unlock()

		redirectURL := state.RedirectURL + "?code=" + url.QueryEscape(platformCode) + "&state=" + url.QueryEscape(state.PlatformState)
		http.Redirect(w, r, redirectURL, http.StatusFound)
		return
	}

	// Legacy flow (CLI): return tokens directly as a base64-encoded response
	// param. Use the platform server URL as the issuer so the CLI refreshes
	// tokens through the platform server's /auth/token endpoint.
	resp := CallbackResponse{
		IDToken:      rawIDToken,
		RefreshToken: token.RefreshToken,
		ExpiresAt:    token.Expiry.Unix(),
		Email:        username,
		ClusterName:  clusterPath,
		IssuerURL:    h.hubExternalURL,
		ClientID:     h.oidcConfig.ClientID,
		HubURL:       h.hubExternalURL,
	}
	respJSON, err := json.Marshal(resp)
	if err != nil {
		http.Error(w, "failed to encode response", http.StatusInternalServerError)
		return
	}

	encoded := base64.URLEncoding.EncodeToString(respJSON)
	redirectURL := state.RedirectURL + "?response=" + encoded
	http.Redirect(w, r, redirectURL, http.StatusFound)
}

// validateRedirectURI checks that the redirect URI is safe.
func (h *Handler) validateRedirectURI(redirectURI string) error {
	parsed, err := url.Parse(redirectURI)
	if err != nil {
		return fmt.Errorf("invalid redirect_uri: %w", err)
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return fmt.Errorf("redirect_uri must be an absolute URL")
	}

	host := strings.Split(parsed.Host, ":")[0]
	if host == "localhost" || host == "127.0.0.1" {
		return nil
	}

	hubParsed, err := url.Parse(h.hubExternalURL)
	if err != nil {
		return fmt.Errorf("invalid hub external URL configuration")
	}
	hubHost := strings.Split(hubParsed.Host, ":")[0]
	if host != hubHost {
		return fmt.Errorf("redirect_uri origin must match hub external URL")
	}

	return nil
}

// workspaceNameForUser derives a DNS-safe workspace name from a user identity.
func workspaceNameForUser(username string) string {
	h := sha256.Sum256([]byte(username))
	return "u-" + hex.EncodeToString(h[:])[:10]
}

// generateCodeVerifier creates a cryptographically random PKCE code_verifier.
func generateCodeVerifier() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// HandleDiscovery returns an OpenID Connect discovery document so that
// downstream OIDC clients (e.g. Headlamp) can treat the platform server
// as a standard OIDC provider.
func (h *Handler) HandleDiscovery(w http.ResponseWriter, r *http.Request) {
	// Fetch the upstream provider's discovery to forward signing alg values.
	var upstreamAlgs []string
	var rawDiscovery struct {
		Algorithms []string `json:"id_token_signing_alg_values_supported"`
	}
	if err := h.oidcProvider.Claims(&rawDiscovery); err == nil && len(rawDiscovery.Algorithms) > 0 {
		upstreamAlgs = rawDiscovery.Algorithms
	} else {
		upstreamAlgs = []string{"RS256"}
	}

	discovery := map[string]interface{}{
		"issuer":                                h.hubExternalURL,
		"authorization_endpoint":                h.hubExternalURL + "/auth/authorize",
		"token_endpoint":                        h.hubExternalURL + "/auth/token",
		"jwks_uri":                              h.hubExternalURL + "/auth/keys",
		"response_types_supported":              []string{"code"},
		"grant_types_supported":                 []string{"authorization_code", "refresh_token"},
		"subject_types_supported":               []string{"public"},
		"id_token_signing_alg_values_supported": upstreamAlgs,
		"scopes_supported":                      []string{"openid", "profile", "email"},
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(discovery) //nolint:errcheck
}

// HandleTokenExchange implements the OIDC token endpoint. It exchanges
// platform-issued auth codes (from HandleCallback) for the actual tokens
// obtained from the upstream provider.
func (h *Handler) HandleTokenExchange(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "invalid request", http.StatusBadRequest)
		return
	}

	grantType := r.FormValue("grant_type")

	switch grantType {
	case "authorization_code":
		h.handleAuthCodeExchange(w, r)
	case "refresh_token":
		h.handleRefreshToken(w, r)
	default:
		http.Error(w, "unsupported grant_type", http.StatusBadRequest)
	}
}

func (h *Handler) handleAuthCodeExchange(w http.ResponseWriter, r *http.Request) {
	code := r.FormValue("code")
	if code == "" {
		http.Error(w, "missing code", http.StatusBadRequest)
		return
	}

	// Look up and consume the single-use code.
	h.pendingMu.Lock()
	pending, ok := h.pendingCodes[code]
	if ok {
		delete(h.pendingCodes, code)
	}
	// Garbage-collect expired codes while holding the lock.
	for k, v := range h.pendingCodes {
		if time.Since(v.createdAt) > 60*time.Second {
			delete(h.pendingCodes, k)
		}
	}
	h.pendingMu.Unlock()

	if !ok || time.Since(pending.createdAt) > 60*time.Second {
		http.Error(w, "invalid or expired code", http.StatusBadRequest)
		return
	}

	tokenResp := map[string]interface{}{
		"access_token":  pending.rawIDToken,
		"id_token":      pending.rawIDToken,
		"token_type":    "Bearer",
		"expires_in":    pending.expiresAt - time.Now().Unix(),
		"refresh_token": pending.refreshToken,
		"cluster_name":  pending.clusterPath,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(tokenResp) //nolint:errcheck
}

// handleRefreshToken proxies refresh token requests to the upstream OIDC
// provider's token endpoint, so clients using the platform server as issuer
// can transparently refresh their tokens.
func (h *Handler) handleRefreshToken(w http.ResponseWriter, r *http.Request) {
	refreshToken := r.FormValue("refresh_token")
	if refreshToken == "" {
		http.Error(w, "missing refresh_token", http.StatusBadRequest)
		return
	}

	// Get the upstream token endpoint from the provider.
	endpoint := h.oidcProvider.Endpoint()

	// Build the upstream refresh request.
	data := url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {refreshToken},
		"client_id":     {h.oidcConfig.ClientID},
	}

	client := http.DefaultClient
	if h.devMode {
		client = &http.Client{
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec // dev mode only
			},
		}
	}

	resp, err := client.PostForm(endpoint.TokenURL, data)
	if err != nil {
		h.logger.Error(err, "failed to refresh token with upstream provider")
		http.Error(w, "upstream token refresh failed", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body) //nolint:errcheck
}

// HandleJWKS proxies the upstream OIDC provider's JWKS endpoint. The ID
// tokens are signed by the upstream provider, so verification keys must match.
func (h *Handler) HandleJWKS(w http.ResponseWriter, r *http.Request) {
	// Get the upstream JWKS URI from the provider's discovery.
	var rawDiscovery struct {
		JWKSURI string `json:"jwks_uri"`
	}
	if err := h.oidcProvider.Claims(&rawDiscovery); err != nil || rawDiscovery.JWKSURI == "" {
		http.Error(w, "failed to determine upstream JWKS URI", http.StatusInternalServerError)
		return
	}

	client := http.DefaultClient
	if h.devMode {
		client = &http.Client{
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec // dev mode only
			},
		}
	}

	jwksResp, err := client.Get(rawDiscovery.JWKSURI)
	if err != nil {
		h.logger.Error(err, "failed to fetch upstream JWKS")
		http.Error(w, "failed to fetch JWKS", http.StatusBadGateway)
		return
	}
	defer jwksResp.Body.Close()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(jwksResp.StatusCode)
	io.Copy(w, jwksResp.Body) //nolint:errcheck
}

// MeResponse is returned by the /auth/me endpoint.
type MeResponse struct {
	Email       string `json:"email"`
	ClusterName string `json:"clusterName,omitempty"`
	HubURL      string `json:"hubURL"`
	ServerURL   string `json:"serverURL"`
}

// HandleMe validates the caller's Bearer token, provisions their workspace
// if needed, and returns workspace connection info. This lets headlamp
// plugins discover the user's cluster URL after OIDC login.
func (h *Handler) HandleMe(w http.ResponseWriter, r *http.Request) {
	// CORS: allow cross-origin requests from headlamp (different port).
	w.Header().Set("Access-Control-Allow-Origin", r.Header.Get("Origin"))
	w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
	w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	authHeader := r.Header.Get("Authorization")
	if !strings.HasPrefix(authHeader, "Bearer ") {
		http.Error(w, "missing or invalid Authorization header", http.StatusUnauthorized)
		return
	}
	rawToken := strings.TrimPrefix(authHeader, "Bearer ")

	verifier := h.oidcProvider.Verifier(&oidc.Config{ClientID: h.oidcConfig.ClientID})

	verifyCtx := r.Context()
	if h.devMode {
		tr := &http.Transport{
			TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec // dev mode only
		}
		httpClient := &http.Client{Transport: tr}
		verifyCtx = oidc.ClientContext(verifyCtx, httpClient)
	}

	idToken, err := verifier.Verify(verifyCtx, rawToken)
	if err != nil {
		h.logger.Error(err, "failed to verify token in /auth/me")
		http.Error(w, "invalid token", http.StatusUnauthorized)
		return
	}

	var claims oidcClaims
	if err := idToken.Claims(&claims); err != nil {
		http.Error(w, "failed to parse claims", http.StatusInternalServerError)
		return
	}

	username := claims.username()
	if username == "" {
		http.Error(w, "no usable identity in token", http.StatusInternalServerError)
		return
	}

	wsName := workspaceNameForUser(username)
	oidcUserName := "oidc:" + username

	clusterPath := ""
	if h.provisioner != nil {
		clusterPath, err = h.provisioner.EnsureTenantWorkspace(r.Context(), wsName, oidcUserName)
		if err != nil {
			h.logger.Error(err, "failed to provision workspace in /auth/me")
			http.Error(w, "failed to provision workspace", http.StatusInternalServerError)
			return
		}
	}

	serverURL := h.hubExternalURL
	if clusterPath != "" {
		serverURL = h.hubExternalURL + "/clusters/" + clusterPath
	}

	meResp := MeResponse{
		Email:       username,
		ClusterName: clusterPath,
		HubURL:      h.hubExternalURL,
		ServerURL:   serverURL,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(meResp) //nolint:errcheck
}
