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

package server

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"
	"path/filepath"
	"strings"
	"time"

	oidc "github.com/coreos/go-oidc"
	"github.com/gorilla/mux"
	"github.com/kcp-dev/multicluster-provider/apiexport"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/klog/v2"
	ctrl "sigs.k8s.io/controller-runtime"
	"sigs.k8s.io/controller-runtime/pkg/manager"
	metricsserver "sigs.k8s.io/controller-runtime/pkg/metrics/server"

	platformauth "github.com/faroshq/kcp-ref-arch/project/platform/pkg/auth"
	"github.com/faroshq/kcp-ref-arch/project/platform/pkg/bootstrap"
	compute "github.com/faroshq/kcp-ref-arch/project/platform/pkg/controllers/compute/virtualmachines"
	kcputil "github.com/faroshq/kcp-ref-arch/project/platform/pkg/kcp"
	"github.com/faroshq/kcp-ref-arch/project/platform/pkg/proxy"

	mcmanager "sigs.k8s.io/multicluster-runtime/pkg/manager"
)

// Server is the platform server orchestrator.
type Server struct {
	opts *Options
}

// NewServer creates a new platform server.
func NewServer(opts *Options) (*Server, error) {
	if opts == nil {
		return nil, fmt.Errorf("options must not be nil")
	}
	return &Server{opts: opts}, nil
}

// Run starts the platform server and blocks until the context is cancelled.
func (s *Server) Run(ctx context.Context) error {
	logger := klog.FromContext(ctx)
	logger.Info("Starting platform server",
		"listenAddr", s.opts.ListenAddr,
		"embeddedKCP", s.opts.EmbeddedKCP,
	)

	var kcpConfig *rest.Config
	var embeddedKCP *kcputil.EmbeddedKCP

	// kcpErrCh receives errors from the embedded kcp server goroutine.
	kcpErrCh := make(chan error, 1)

	// Start embedded kcp if enabled.
	if s.opts.EmbeddedKCP {
		kcpRootDir := s.opts.KCPRootDir
		if kcpRootDir == "" {
			kcpRootDir = filepath.Join(s.opts.DataDir, "kcp")
		}

		batteries := []string{"admin", "user"}
		if s.opts.KCPBatteriesInclude != "" {
			batteries = strings.Split(s.opts.KCPBatteriesInclude, ",")
		}

		embeddedKCP = kcputil.NewEmbeddedKCP(kcputil.EmbeddedKCPOptions{
			RootDir:          kcpRootDir,
			SecurePort:       s.opts.KCPSecurePort,
			BindAddress:      s.opts.KCPBindAddress,
			BatteriesInclude: batteries,
			StaticAuthTokens: s.opts.StaticAuthTokens,
		})

		go func() {
			if err := embeddedKCP.Run(ctx); err != nil {
				logger.Error(err, "Embedded kcp server failed")
				kcpErrCh <- err
			}
		}()

		logger.Info("Waiting for embedded kcp to be ready...")
		select {
		case <-embeddedKCP.Ready():
			logger.Info("Embedded kcp is ready")
		case err := <-kcpErrCh:
			return fmt.Errorf("embedded kcp failed to start: %w", err)
		case <-ctx.Done():
			return ctx.Err()
		}

		kcpConfig = embeddedKCP.AdminConfig()
		if kcpConfig == nil {
			var err error
			kcpConfig, err = clientcmd.BuildConfigFromFlags("", embeddedKCP.AdminKubeconfigPath())
			if err != nil {
				return fmt.Errorf("loading embedded kcp admin kubeconfig: %w", err)
			}
		}
	} else if s.opts.ExternalKCPKubeconfig != "" {
		var err error
		kcpConfig, err = clientcmd.BuildConfigFromFlags("", s.opts.ExternalKCPKubeconfig)
		if err != nil {
			return fmt.Errorf("building kcp rest config: %w", err)
		}
	}

	// Build rest.Config for the base cluster.
	var config *rest.Config
	if kcpConfig != nil {
		config = kcpConfig
	} else {
		var err error
		config, err = s.buildRestConfig()
		if err != nil {
			return fmt.Errorf("building rest config: %w", err)
		}
	}

	// Bootstrap CRDs only when NOT using kcp (kcp uses APIExport/APIBinding instead).
	if kcpConfig == nil {
		logger.Info("Installing CRDs")
		if err := bootstrap.InstallCRDs(ctx, config); err != nil {
			return fmt.Errorf("installing CRDs: %w", err)
		}
	}

	// kcp bootstrap (workspace hierarchy + APIExport + APIBinding).
	var bootstrapper *kcputil.Bootstrapper
	if kcpConfig != nil {
		bootstrapper = kcputil.NewBootstrapper(kcpConfig, s.opts.StaticAuthTokens)
		if err := bootstrapper.Bootstrap(ctx); err != nil {
			return fmt.Errorf("bootstrapping kcp: %w", err)
		}
		logger.Info("kcp bootstrap complete")
	}

	// Build HTTP router.
	router := mux.NewRouter()

	router.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = fmt.Fprint(w, `{"status":"ok"}`)
	})
	router.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = fmt.Fprint(w, "ok")
	})

	// OIDC auth handler: provides /auth/authorize and /auth/callback for
	// browser-based OIDC login (used by the NeoCloud console).
	var authHandler *platformauth.Handler
	if s.opts.OIDCIssuerURL != "" && s.opts.OIDCClientID != "" {
		oidcConfig := &platformauth.OIDCConfig{
			IssuerURL: s.opts.OIDCIssuerURL,
			ClientID:  s.opts.OIDCClientID,
		}
		// Pass bootstrapper as workspace provisioner (nil-safe: auth handler handles nil provisioner).
		var provisioner platformauth.WorkspaceProvisioner
		if bootstrapper != nil {
			provisioner = bootstrapper
		}
		var err error
		authHandler, err = platformauth.NewHandler(ctx, oidcConfig, s.opts.HubExternalURL, provisioner, s.opts.DevMode)
		if err != nil {
			return fmt.Errorf("creating OIDC auth handler: %w", err)
		}
		authHandler.RegisterRoutes(router)
		logger.Info("OIDC auth endpoints registered", "issuer", s.opts.OIDCIssuerURL)
	}

	// kcp API proxy: catch-all that forwards authenticated requests to kcp.
	// Supports both static token auth and OIDC ID token auth.
	if kcpConfig != nil && (len(s.opts.StaticAuthTokens) > 0 || authHandler != nil) {
		// Pass the OIDC verifier to the proxy (nil if OIDC is not configured).
		var oidcVerifier = oidcVerifierFrom(authHandler)

		kcpProxy, err := proxy.New(kcpConfig, oidcVerifier, s.opts.StaticAuthTokens, s.opts.HubExternalURL, s.opts.DevMode)
		if err != nil {
			return fmt.Errorf("creating kcp proxy: %w", err)
		}

		// Static token login endpoint.
		if len(s.opts.StaticAuthTokens) > 0 {
			router.HandleFunc("/auth/token-login", kcpProxy.HandleTokenLogin).Methods("POST")
			logger.Info("Static token login endpoint registered at /auth/token-login")
		}

		// Catch-all: proxy authenticated kubectl/console requests to kcp.
		router.PathPrefix("/clusters/").Handler(kcpProxy)
		router.PathPrefix("/api").Handler(kcpProxy)
		router.PathPrefix("/openapi").Handler(kcpProxy)
		router.PathPrefix("/version").Handler(kcpProxy)
		logger.Info("kcp API proxy enabled", "oidc", authHandler != nil, "staticTokens", len(s.opts.StaticAuthTokens))
	}

	// Console: reverse proxy to NeoCloud console (Piral SPA).
	// The console container serves its SPA at /console/ with nginx.
	// All paths are forwarded as-is; the console handles SPA fallback.
	if s.opts.ConsoleAddr != "" {
		consoleTarget := &url.URL{Scheme: "http", Host: s.opts.ConsoleAddr}
		consoleProxy := &httputil.ReverseProxy{
			Director: func(req *http.Request) {
				req.URL.Scheme = consoleTarget.Scheme
				req.URL.Host = consoleTarget.Host
				req.Host = consoleTarget.Host
			},
		}
		router.PathPrefix("/console").Handler(consoleProxy)
		logger.Info("NeoCloud console proxy enabled", "target", consoleTarget.String())
	}

	// Start multicluster controllers (when kcp is configured).
	if kcpConfig != nil {
		ctrl.SetLogger(klog.NewKlogr())

		scheme := NewScheme()

		providersConfig := rest.CopyConfig(kcpConfig)
		providersConfig.Host = kcputil.ClusterURL(providersConfig.Host, "root:platform:providers")

		provider, err := apiexport.New(providersConfig, "cloud.platform", apiexport.Options{Scheme: scheme})
		if err != nil {
			return fmt.Errorf("creating multicluster provider: %w", err)
		}

		mgr, err := mcmanager.New(providersConfig, provider, manager.Options{
			Scheme:  scheme,
			Metrics: metricsserver.Options{BindAddress: "0"},
		})
		if err != nil {
			return fmt.Errorf("creating multicluster manager: %w", err)
		}

		if err := compute.SetupWithManager(mgr); err != nil {
			return fmt.Errorf("setting up compute controller: %w", err)
		}

		go func() {
			logger.Info("Starting multicluster manager")
			if err := mgr.Start(ctx); err != nil {
				logger.Error(err, "Multicluster manager failed")
			}
		}()
	}

	// Start HTTP server.
	httpServer := &http.Server{
		Addr:              s.opts.ListenAddr,
		Handler:           router,
		ReadHeaderTimeout: 10 * time.Second,
	}

	httpErrCh := make(chan error, 1)

	go func() {
		select {
		case <-ctx.Done():
			logger.Info("Shutting down HTTP server (context cancelled)")
		case err := <-kcpErrCh:
			logger.Error(err, "Embedded kcp server failed, shutting down")
		}
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := httpServer.Shutdown(shutdownCtx); err != nil {
			logger.Error(err, "HTTP server shutdown error")
		}
	}()

	// Use kcp's TLS cert if available (kubectl won't send tokens over plain HTTP).
	kcpRootDir := s.opts.KCPRootDir
	if kcpRootDir == "" {
		kcpRootDir = filepath.Join(s.opts.DataDir, "kcp")
	}
	certFile := filepath.Join(kcpRootDir, "apiserver.crt")
	keyFile := filepath.Join(kcpRootDir, "apiserver.key")

	go func() {
		logger.Info("Platform server starting (TLS)", "addr", s.opts.ListenAddr, "cert", certFile)
		err := httpServer.ListenAndServeTLS(certFile, keyFile)
		if err != nil && err != http.ErrServerClosed {
			httpErrCh <- err
		}
		close(httpErrCh)
	}()

	// Wait for either HTTP server error, kcp error, or context cancellation.
	select {
	case err := <-httpErrCh:
		if err != nil {
			return fmt.Errorf("HTTP server error: %w", err)
		}
	case err := <-kcpErrCh:
		return fmt.Errorf("embedded kcp server failed: %w", err)
	case <-ctx.Done():
		<-httpErrCh
	}

	return nil
}

// oidcVerifierFrom extracts the OIDC token verifier from the auth handler.
// Returns nil if the handler is nil (OIDC not configured).
func oidcVerifierFrom(h *platformauth.Handler) *oidc.IDTokenVerifier {
	if h == nil {
		return nil
	}
	return h.Verifier()
}

func (s *Server) buildRestConfig() (*rest.Config, error) {
	if s.opts.Kubeconfig != "" {
		return clientcmd.BuildConfigFromFlags("", s.opts.Kubeconfig)
	}
	if s.opts.ExternalKCPKubeconfig != "" {
		return clientcmd.BuildConfigFromFlags("", s.opts.ExternalKCPKubeconfig)
	}
	config, err := rest.InClusterConfig()
	if err != nil {
		loadingRules := clientcmd.NewDefaultClientConfigLoadingRules()
		configOverrides := &clientcmd.ConfigOverrides{}
		kubeConfig := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(loadingRules, configOverrides)
		return kubeConfig.ClientConfig()
	}
	return config, nil
}
