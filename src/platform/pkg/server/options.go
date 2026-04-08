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

// Options holds configuration for the platform server.
type Options struct {
	DataDir               string
	ListenAddr            string
	Kubeconfig            string
	ExternalKCPKubeconfig string

	// Workload cluster options
	WorkloadKubeconfig string

	// Console (NeoCloud) options
	ConsoleAddr string

	// Auth options
	StaticAuthTokens []string // Static bearer tokens accepted by the proxy
	HubExternalURL   string   // External URL for kubeconfig generation
	DevMode          bool     // Skip TLS verification (self-signed certs)

	// OIDC options
	OIDCIssuerURL string // OIDC provider issuer URL (e.g. Zitadel)
	OIDCClientID  string // OIDC client ID (public client, no secret)
	OIDCCAFile    string // CA file for OIDC issuer (self-signed certs)

	// Embedded kcp options
	EmbeddedKCP         bool
	KCPRootDir          string
	KCPSecurePort       int
	KCPBindAddress      string
	KCPBatteriesInclude string
}

// NewOptions returns default Options.
func NewOptions() *Options {
	return &Options{
		DataDir:        ".platform-data",
		ListenAddr:     ":9443",
		HubExternalURL: "https://localhost:9443",

		EmbeddedKCP:         false,
		KCPSecurePort:       6443,
		KCPBindAddress:      "127.0.0.1",
		KCPBatteriesInclude: "admin,user",
	}
}
