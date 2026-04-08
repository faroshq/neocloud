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

package kcp

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"

	"github.com/kcp-dev/embeddedetcd"
	genericapiserver "k8s.io/apiserver/pkg/server"
	utilfeature "k8s.io/apiserver/pkg/util/feature"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/klog/v2"

	kcpfeatures "github.com/kcp-dev/kcp/pkg/features"
	"github.com/kcp-dev/kcp/pkg/server"
	serveroptions "github.com/kcp-dev/kcp/pkg/server/options"
)

// EmbeddedKCPOptions contains configuration for the embedded kcp server.
type EmbeddedKCPOptions struct {
	RootDir          string
	SecurePort       int
	BindAddress      string
	BatteriesInclude []string

	// StaticAuthTokens are bearer tokens that kcp should accept directly
	// via its token-auth-file mechanism.
	StaticAuthTokens []string

	// OIDC options for native kcp authentication.
	OIDCIssuerURL      string
	OIDCClientID       string
	OIDCCAFile         string
	OIDCUsernameClaim  string
	OIDCUsernamePrefix string
	OIDCGroupsClaim    string
	OIDCGroupsPrefix   string
}

// EmbeddedKCP wraps a kcp server that runs in-process.
type EmbeddedKCP struct {
	opts    EmbeddedKCPOptions
	server  *server.Server
	readyCh chan struct{}
	// adminConfig is the rest.Config for the kcp admin user.
	adminConfig *rest.Config
}

// NewEmbeddedKCP creates a new embedded kcp instance.
func NewEmbeddedKCP(opts EmbeddedKCPOptions) *EmbeddedKCP {
	if opts.RootDir == "" {
		opts.RootDir = ".kcp"
	}
	if opts.SecurePort == 0 {
		opts.SecurePort = 6443
	}
	if len(opts.BatteriesInclude) == 0 {
		opts.BatteriesInclude = []string{"admin", "user"}
	}
	return &EmbeddedKCP{
		opts:    opts,
		readyCh: make(chan struct{}),
	}
}

// Run starts the embedded kcp server and blocks until context is cancelled.
func (e *EmbeddedKCP) Run(ctx context.Context) error {
	logger := klog.FromContext(ctx)
	logger.Info("Starting embedded kcp server", "rootDir", e.opts.RootDir, "securePort", e.opts.SecurePort)

	// Enable feature gates.
	featureGates := fmt.Sprintf("%s=true,%s=true", kcpfeatures.WorkspaceMounts, kcpfeatures.CacheAPIs)
	if err := utilfeature.DefaultMutableFeatureGate.Set(featureGates); err != nil {
		return fmt.Errorf("enabling feature gates: %w", err)
	}

	kcpOpts := serveroptions.NewOptions(e.opts.RootDir)
	kcpOpts.GenericControlPlane.SecureServing.BindPort = e.opts.SecurePort
	if e.opts.BindAddress != "" {
		kcpOpts.GenericControlPlane.SecureServing.BindAddress = net.ParseIP(e.opts.BindAddress)
	}
	// Write static token auth file for kcp if static tokens are configured.
	if len(e.opts.StaticAuthTokens) > 0 {
		if err := os.MkdirAll(e.opts.RootDir, 0700); err != nil {
			return fmt.Errorf("creating kcp root directory: %w", err)
		}
		tokenFilePath := filepath.Join(e.opts.RootDir, "token-auth-file.csv")
		var lines []string
		for _, token := range e.opts.StaticAuthTokens {
			if token == "" {
				continue
			}
			h := sha256.Sum256([]byte("static-token/" + token))
			subHash := hex.EncodeToString(h[:])[:63]
			user := fmt.Sprintf("platform:static:%s", subHash[:16])
			uid := subHash[:16]
			lines = append(lines, fmt.Sprintf("%s,%s,%s,\"system:authenticated\"", token, user, uid))
		}
		if len(lines) > 0 {
			if err := os.WriteFile(tokenFilePath, []byte(strings.Join(lines, "\n")+"\n"), 0600); err != nil {
				return fmt.Errorf("writing token auth file: %w", err)
			}
			kcpOpts.GenericControlPlane.Authentication.TokenFile.TokenFile = tokenFilePath
			logger.Info("Static token auth file configured for kcp", "path", tokenFilePath, "tokens", len(lines))
		}
	}

	// Configure OIDC authentication if provided.
	if e.opts.OIDCIssuerURL != "" && e.opts.OIDCClientID != "" {
		kcpOpts.GenericControlPlane.Authentication.OIDC.IssuerURL = e.opts.OIDCIssuerURL
		kcpOpts.GenericControlPlane.Authentication.OIDC.ClientID = e.opts.OIDCClientID
		if e.opts.OIDCUsernameClaim != "" {
			kcpOpts.GenericControlPlane.Authentication.OIDC.UsernameClaim = e.opts.OIDCUsernameClaim
		} else {
			kcpOpts.GenericControlPlane.Authentication.OIDC.UsernameClaim = "email"
		}
		if e.opts.OIDCUsernamePrefix != "" {
			kcpOpts.GenericControlPlane.Authentication.OIDC.UsernamePrefix = e.opts.OIDCUsernamePrefix
		} else {
			kcpOpts.GenericControlPlane.Authentication.OIDC.UsernamePrefix = "oidc:"
		}
		if e.opts.OIDCGroupsClaim != "" {
			kcpOpts.GenericControlPlane.Authentication.OIDC.GroupsClaim = e.opts.OIDCGroupsClaim
		} else {
			kcpOpts.GenericControlPlane.Authentication.OIDC.GroupsClaim = "groups"
		}
		if e.opts.OIDCGroupsPrefix != "" {
			kcpOpts.GenericControlPlane.Authentication.OIDC.GroupsPrefix = e.opts.OIDCGroupsPrefix
		} else {
			kcpOpts.GenericControlPlane.Authentication.OIDC.GroupsPrefix = "oidc:"
		}
		if e.opts.OIDCCAFile != "" {
			kcpOpts.GenericControlPlane.Authentication.OIDC.CAFile = e.opts.OIDCCAFile
		}
		logger.Info("OIDC authentication configured for kcp", "issuer", e.opts.OIDCIssuerURL, "clientID", e.opts.OIDCClientID)
	}

	kcpOpts.Extra.BatteriesIncluded = e.opts.BatteriesInclude
	kcpOpts.EmbeddedEtcd.Enabled = true

	completedOpts, err := kcpOpts.Complete(ctx, e.opts.RootDir)
	if err != nil {
		return fmt.Errorf("completing kcp options: %w", err)
	}

	if errs := completedOpts.Validate(); len(errs) > 0 {
		return fmt.Errorf("validating kcp options: %v", errs)
	}

	logger.Info("Running kcp with batteries", "batteries", strings.Join(completedOpts.Extra.BatteriesIncluded, ","))

	serverConfig, err := server.NewConfig(ctx, *completedOpts)
	if err != nil {
		return fmt.Errorf("creating kcp server config: %w", err)
	}

	completedConfig, err := serverConfig.Complete()
	if err != nil {
		return fmt.Errorf("completing kcp server config: %w", err)
	}

	if completedConfig.EmbeddedEtcd.Config != nil {
		logger.Info("Starting embedded etcd")
		if err := embeddedetcd.NewServer(completedConfig.EmbeddedEtcd).Run(ctx); err != nil {
			return fmt.Errorf("starting embedded etcd: %w", err)
		}
	}

	e.server, err = server.NewServer(completedConfig)
	if err != nil {
		return fmt.Errorf("creating kcp server: %w", err)
	}

	if err := e.server.AddPostStartHook("platform-kcp-ready", func(hookContext genericapiserver.PostStartHookContext) error {
		e.server.WaitForPhase1Finished()

		adminKubeconfigPath := filepath.Join(e.opts.RootDir, "admin.kubeconfig")
		adminConfig, err := clientcmd.BuildConfigFromFlags("", adminKubeconfigPath)
		if err != nil {
			logger.Error(err, "Failed to load admin kubeconfig, using loopback")
			e.adminConfig = rest.CopyConfig(hookContext.LoopbackClientConfig)
			e.adminConfig.Host = ClusterURL(e.adminConfig.Host, "root")
		} else {
			e.adminConfig = adminConfig
		}

		logger.Info("kcp server is ready")
		close(e.readyCh)
		return nil
	}); err != nil {
		return fmt.Errorf("adding post-start hook: %w", err)
	}

	return e.server.Run(ctx)
}

// Ready returns a channel that is closed when kcp is ready to serve requests.
func (e *EmbeddedKCP) Ready() <-chan struct{} {
	return e.readyCh
}

// AdminConfig returns a rest.Config for the kcp admin user.
func (e *EmbeddedKCP) AdminConfig() *rest.Config {
	return e.adminConfig
}

// AdminKubeconfigPath returns the path to the admin kubeconfig file.
func (e *EmbeddedKCP) AdminKubeconfigPath() string {
	return filepath.Join(e.opts.RootDir, "admin.kubeconfig")
}

// ClusterURL sets the /clusters/<path> segment on a kcp URL.
func ClusterURL(host, clusterPath string) string {
	base := strings.TrimSuffix(host, "/")
	if idx := strings.Index(base, "/clusters/"); idx != -1 {
		base = base[:idx]
	}
	return base + "/clusters/" + clusterPath
}
