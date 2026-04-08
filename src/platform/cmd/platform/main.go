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
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/spf13/cobra"
	"k8s.io/klog/v2"

	"github.com/faroshq/kcp-ref-arch/project/platform/pkg/server"
)

func main() {
	opts := server.NewOptions()

	cmd := &cobra.Command{
		Use:   "platform",
		Short: "Platform control plane - multi-tenant cloud API server",
	}

	startCmd := &cobra.Command{
		Use:   "start",
		Short: "Start the platform server (all-in-one or connected to external kcp)",
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
			defer cancel()

			srv, err := server.NewServer(opts)
			if err != nil {
				return fmt.Errorf("failed to create server: %w", err)
			}

			return srv.Run(ctx)
		},
	}

	// Server flags
	startCmd.Flags().StringVar(&opts.DataDir, "data-dir", opts.DataDir, "Data directory for state")
	startCmd.Flags().StringVar(&opts.ListenAddr, "listen-addr", opts.ListenAddr, "Address to listen on")
	startCmd.Flags().StringVar(&opts.Kubeconfig, "kubeconfig", "", "Kubeconfig for hub cluster")
	startCmd.Flags().StringVar(&opts.ExternalKCPKubeconfig, "external-kcp-kubeconfig", "", "Kubeconfig for external kcp (empty for embedded)")

	// Workload cluster flags
	startCmd.Flags().StringVar(&opts.WorkloadKubeconfig, "workload-kubeconfig", "", "Kubeconfig for the backend workload cluster (KubeVirt)")

	// Console flags
	startCmd.Flags().StringVar(&opts.ConsoleAddr, "console-addr", "", "Address of the NeoCloud console to proxy (e.g. localhost:4466)")

	// Auth flags
	startCmd.Flags().StringSliceVar(&opts.StaticAuthTokens, "static-auth-tokens", nil, "Comma-separated list of static bearer tokens accepted by the proxy")
	startCmd.Flags().StringVar(&opts.HubExternalURL, "hub-external-url", opts.HubExternalURL, "External URL of the platform hub (for kubeconfig generation)")
	startCmd.Flags().BoolVar(&opts.DevMode, "dev-mode", false, "Enable dev mode (skip TLS verification for self-signed certs)")

	// OIDC flags
	startCmd.Flags().StringVar(&opts.OIDCIssuerURL, "oidc-issuer-url", "", "OIDC provider issuer URL (e.g. Zitadel). Enables OIDC authentication for the console and API proxy")
	startCmd.Flags().StringVar(&opts.OIDCClientID, "oidc-client-id", "", "OIDC client ID (public client, no secret needed with PKCE)")
	startCmd.Flags().StringVar(&opts.OIDCCAFile, "oidc-ca-file", "", "CA certificate file for OIDC issuer (for self-signed certs)")

	// Embedded kcp flags
	startCmd.Flags().BoolVar(&opts.EmbeddedKCP, "embedded-kcp", opts.EmbeddedKCP, "Enable embedded kcp server (runs kcp in-process)")
	startCmd.Flags().StringVar(&opts.KCPRootDir, "kcp-root-dir", "", "Root directory for embedded kcp data (default: <data-dir>/kcp)")
	startCmd.Flags().IntVar(&opts.KCPSecurePort, "kcp-secure-port", opts.KCPSecurePort, "Secure port for embedded kcp API server")
	startCmd.Flags().StringVar(&opts.KCPBindAddress, "kcp-bind-address", opts.KCPBindAddress, "Bind address for embedded kcp API server")
	startCmd.Flags().StringVar(&opts.KCPBatteriesInclude, "kcp-batteries-include", opts.KCPBatteriesInclude, "Comma-separated list of kcp batteries to include")

	cmd.AddCommand(startCmd)

	// Add klog flags
	goFlags := flag.NewFlagSet("", flag.ContinueOnError)
	klog.InitFlags(goFlags)
	cmd.PersistentFlags().AddGoFlagSet(goFlags)

	if err := cmd.Execute(); err != nil {
		klog.Fatal(err)
		os.Exit(1)
	}
}
