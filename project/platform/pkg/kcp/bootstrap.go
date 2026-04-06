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
	"strings"
	"time"

	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/util/wait"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/rest"
	"k8s.io/klog/v2"

	kcpconfig "github.com/faroshq/kcp-ref-arch/project/platform/config/kcp"
	publicimagesconfig "github.com/faroshq/kcp-ref-arch/project/platform/config/publicimages"
	"github.com/faroshq/kcp-ref-arch/project/platform/pkg/bootstrap"
	"github.com/faroshq/kcp-ref-arch/project/platform/pkg/kcp/confighelpers"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// kcp resource GVRs.
var (
	workspaceGVR = schema.GroupVersionResource{
		Group: "tenancy.kcp.io", Version: "v1alpha1", Resource: "workspaces",
	}
	apiExportGVR = schema.GroupVersionResource{
		Group: "apis.kcp.io", Version: "v1alpha1", Resource: "apiexports",
	}
	clusterRoleBindingGVR = schema.GroupVersionResource{
		Group: "rbac.authorization.k8s.io", Version: "v1", Resource: "clusterrolebindings",
	}
	apiBindingGVR = schema.GroupVersionResource{
		Group: "apis.kcp.io", Version: "v1alpha2", Resource: "apibindings",
	}
	logicalClusterGVR = schema.GroupVersionResource{
		Group: "core.kcp.io", Version: "v1alpha1", Resource: "logicalclusters",
	}
	cachedResourceGVR = schema.GroupVersionResource{
		Group: "cache.kcp.io", Version: "v1alpha1", Resource: "cachedresources",
	}
)

// Bootstrapper sets up the kcp workspace hierarchy and API exports.
type Bootstrapper struct {
	config           *rest.Config
	staticAuthTokens []string
}

// NewBootstrapper creates a new bootstrapper.
func NewBootstrapper(config *rest.Config, staticAuthTokens []string) *Bootstrapper {
	return &Bootstrapper{config: config, staticAuthTokens: staticAuthTokens}
}

// Bootstrap creates the workspace hierarchy:
//
//	root:platform                     - Root platform workspace
//	root:platform:providers           - Holds APIExport "cloud.platform"
//	root:platform:tenants             - Parent for tenant workspaces
func (b *Bootstrapper) Bootstrap(ctx context.Context) error {
	logger := klog.FromContext(ctx)
	logger.Info("Bootstrapping kcp workspace hierarchy")

	// 1. Clients targeting root workspace.
	rootDynamic, rootDiscovery, err := newClients(b.config)
	if err != nil {
		return fmt.Errorf("creating root clients: %w", err)
	}

	// 2. Bootstrap root:platform workspace.
	logger.Info("Bootstrapping root:platform workspace")
	if err := confighelpers.Bootstrap(ctx, rootDiscovery, rootDynamic, kcpconfig.RootWorkspaceFS); err != nil {
		return fmt.Errorf("bootstrapping root:platform workspace: %w", err)
	}
	if err := waitForWorkspaceReady(ctx, rootDynamic, "platform"); err != nil {
		return fmt.Errorf("waiting for platform workspace: %w", err)
	}

	// 3. Bootstrap child workspaces: providers, tenants.
	platformConfig := configForPath(b.config, "root:platform")
	platformDynamic, platformDiscovery, err := newClients(platformConfig)
	if err != nil {
		return fmt.Errorf("creating platform clients: %w", err)
	}

	logger.Info("Bootstrapping child workspaces: providers, tenants")
	if err := confighelpers.Bootstrap(ctx, platformDiscovery, platformDynamic, kcpconfig.PlatformWorkspaceFS); err != nil {
		return fmt.Errorf("bootstrapping child workspaces: %w", err)
	}
	for _, name := range []string{"providers", "tenants"} {
		if err := waitForWorkspaceReady(ctx, platformDynamic, name); err != nil {
			return fmt.Errorf("waiting for %s workspace: %w", name, err)
		}
	}

	// 4. Fetch tenancy.kcp.io identity hash from root workspace.
	logger.Info("Fetching tenancy.kcp.io identity hash from root workspace")
	tenancyExport, err := rootDynamic.Resource(apiExportGVR).Get(ctx, "tenancy.kcp.io", metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("getting tenancy.kcp.io APIExport from root: %w", err)
	}
	identityHash, _, _ := unstructured.NestedString(tenancyExport.Object, "status", "identityHash")
	if identityHash == "" {
		return fmt.Errorf("tenancy.kcp.io APIExport has no identity hash yet")
	}
	logger.Info("Got tenancy.kcp.io identity hash", "hash", identityHash)

	// 5. Create providers clients and install CRDs in root:platform:providers.
	providersConfig := configForPath(b.config, "root:platform:providers")
	providersDynamic, providersDiscovery, err := newClients(providersConfig)
	if err != nil {
		return fmt.Errorf("creating providers clients: %w", err)
	}

	logger.Info("Installing CRDs in providers workspace")
	if err := bootstrap.InstallCRDs(ctx, providersConfig); err != nil {
		return fmt.Errorf("installing CRDs in providers: %w", err)
	}

	// 6. Create PublicImage CRs in root:platform:providers (source for cache replication).
	logger.Info("Bootstrapping PublicImage resources in providers workspace")
	if err := confighelpers.Bootstrap(ctx, providersDiscovery, providersDynamic, publicimagesconfig.PublicImagesFS); err != nil {
		return fmt.Errorf("bootstrapping public images: %w", err)
	}

	// 7. Create CachedResource in root:platform:providers for publicimages replication.
	logger.Info("Bootstrapping CachedResource in providers workspace")
	if err := confighelpers.Bootstrap(ctx, providersDiscovery, providersDynamic, publicimagesconfig.CachedResourceFS); err != nil {
		return fmt.Errorf("bootstrapping cached resource: %w", err)
	}

	// 8. Wait for CachedResource to be ready and get publicimages identity hash.
	logger.Info("Waiting for CachedResource publicimages to be ready")
	publicimagesIdentityHash, err := waitForCachedResourceReady(ctx, providersDynamic, "publicimages")
	if err != nil {
		return fmt.Errorf("waiting for CachedResource publicimages: %w", err)
	}
	logger.Info("Got publicimages identity hash", "hash", publicimagesIdentityHash)

	// 9. Bootstrap APIResourceSchemas and APIExport in root:platform:providers.
	logger.Info("Bootstrapping APIResourceSchemas and APIExport")
	if err := confighelpers.Bootstrap(ctx, providersDiscovery, providersDynamic, kcpconfig.ProvidersFS,
		confighelpers.ReplaceOption("__TENANCY_IDENTITY_HASH__", identityHash),
		confighelpers.ReplaceOption("__PUBLICIMAGES_IDENTITY_HASH__", publicimagesIdentityHash),
	); err != nil {
		return fmt.Errorf("bootstrapping providers: %w", err)
	}

	// 10. Create APIBinding in root workspace to bind to cloud.platform APIExport.
	logger.Info("Ensuring APIBinding for cloud.platform in root workspace")
	if err := ensureAPIBinding(ctx, rootDynamic, "cloud.platform", "root:platform:providers"); err != nil {
		return fmt.Errorf("creating APIBinding for cloud.platform: %w", err)
	}

	// 11. Create ClusterRoleBindings for static token users in root workspace.
	if len(b.staticAuthTokens) > 0 {
		logger.Info("Bootstrapping RBAC for static token users")
		for _, token := range b.staticAuthTokens {
			if token == "" {
				continue
			}
			h := sha256.Sum256([]byte("static-token/" + token))
			subHash := hex.EncodeToString(h[:])[:63]
			userName := fmt.Sprintf("platform:static:%s", subHash[:16])

			if err := ensureClusterAdmin(ctx, rootDynamic, userName); err != nil {
				return fmt.Errorf("creating ClusterRoleBinding for %s: %w", userName, err)
			}
			logger.Info("Ensured cluster-admin binding", "user", userName)
		}
	}

	logger.Info("kcp bootstrap complete")
	return nil
}

// ensureClusterAdmin creates a ClusterRoleBinding granting cluster-admin to the given user.
func ensureClusterAdmin(ctx context.Context, client dynamic.Interface, userName string) error {
	// Sanitize name: replace colons with dashes for valid k8s resource name.
	crbName := "platform-admin-" + strings.ReplaceAll(userName, ":", "-")

	crb := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "rbac.authorization.k8s.io/v1",
			"kind":       "ClusterRoleBinding",
			"metadata": map[string]interface{}{
				"name": crbName,
			},
			"roleRef": map[string]interface{}{
				"apiGroup": "rbac.authorization.k8s.io",
				"kind":     "ClusterRole",
				"name":     "cluster-admin",
			},
			"subjects": []interface{}{
				map[string]interface{}{
					"apiGroup": "rbac.authorization.k8s.io",
					"kind":     "User",
					"name":     userName,
				},
			},
		},
	}

	_, err := client.Resource(clusterRoleBindingGVR).Create(ctx, crb, metav1.CreateOptions{})
	if err != nil && !errors.IsAlreadyExists(err) {
		return fmt.Errorf("creating ClusterRoleBinding: %w", err)
	}
	return nil
}

// ensureAPIBinding creates an APIBinding in the target workspace that binds to the
// given APIExport name from the specified workspace path.
func ensureAPIBinding(ctx context.Context, client dynamic.Interface, exportName, exportWorkspacePath string) error {
	bindingName := exportName

	binding := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "apis.kcp.io/v1alpha2",
			"kind":       "APIBinding",
			"metadata": map[string]interface{}{
				"name": bindingName,
			},
			"spec": map[string]interface{}{
				"reference": map[string]interface{}{
					"export": map[string]interface{}{
						"path": exportWorkspacePath,
						"name": exportName,
					},
				},
			},
		},
	}

	_, err := client.Resource(apiBindingGVR).Create(ctx, binding, metav1.CreateOptions{})
	if err != nil && !errors.IsAlreadyExists(err) {
		return fmt.Errorf("creating APIBinding %q: %w", bindingName, err)
	}
	return nil
}

// EnsureTenantWorkspace creates a tenant workspace and RBAC for an OIDC user.
// It implements the auth.WorkspaceProvisioner interface.
// Returns the full kcp cluster path (e.g. "root:platform:tenants:u-abc123").
func (b *Bootstrapper) EnsureTenantWorkspace(ctx context.Context, workspaceName, oidcUserName string) (string, error) {
	logger := klog.FromContext(ctx)
	tenantsPath := "root:platform:tenants"

	// 1. Create workspace under root:platform:tenants.
	tenantsConfig := configForPath(b.config, tenantsPath)
	tenantsDynamic, _, err := newClients(tenantsConfig)
	if err != nil {
		return "", fmt.Errorf("creating tenants clients: %w", err)
	}

	ws := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "tenancy.kcp.io/v1alpha1",
			"kind":       "Workspace",
			"metadata": map[string]interface{}{
				"name": workspaceName,
			},
			"spec": map[string]interface{}{
				"type": map[string]interface{}{
					"name": "universal",
					"path": "root",
				},
			},
		},
	}

	_, err = tenantsDynamic.Resource(workspaceGVR).Create(ctx, ws, metav1.CreateOptions{})
	if err != nil && !errors.IsAlreadyExists(err) {
		return "", fmt.Errorf("creating tenant workspace %q: %w", workspaceName, err)
	}

	if err := waitForWorkspaceReady(ctx, tenantsDynamic, workspaceName); err != nil {
		return "", fmt.Errorf("waiting for tenant workspace %q to be ready: %w", workspaceName, err)
	}
	logger.Info("Tenant workspace ready", "workspace", workspaceName)

	// 2. Create ClusterRoleBinding for the OIDC user in the tenant workspace.
	wsPath := tenantsPath + ":" + workspaceName
	wsConfig := configForPath(b.config, wsPath)
	wsDynamic, _, err := newClients(wsConfig)
	if err != nil {
		return "", fmt.Errorf("creating workspace clients: %w", err)
	}

	if err := ensureClusterAdmin(ctx, wsDynamic, oidcUserName); err != nil {
		return "", fmt.Errorf("creating ClusterRoleBinding for %s in %s: %w", oidcUserName, wsPath, err)
	}
	logger.Info("Ensured cluster-admin for tenant", "user", oidcUserName, "workspace", wsPath)

	// 3. Create APIBinding for cloud.platform in the tenant workspace.
	if err := ensureAPIBinding(ctx, wsDynamic, "cloud.platform", "root:platform:providers"); err != nil {
		return "", fmt.Errorf("creating APIBinding in %s: %w", wsPath, err)
	}
	logger.Info("Ensured APIBinding for cloud.platform", "workspace", wsPath)

	// 4. Read the logical cluster name (the obfuscated cluster ID used in URLs).
	lc, err := wsDynamic.Resource(logicalClusterGVR).Get(ctx, "cluster", metav1.GetOptions{})
	if err != nil {
		return "", fmt.Errorf("getting LogicalCluster in %s: %w", wsPath, err)
	}
	lcName := lc.GetName()
	// The logical cluster path is in metadata.annotations["kcp.io/path"] or we derive from status.URL.
	// The URL field has the form https://host/clusters/<logicalClusterName>.
	clusterURL, _, _ := unstructured.NestedString(lc.Object, "status", "URL")
	if clusterURL != "" {
		if idx := strings.LastIndex(clusterURL, "/clusters/"); idx != -1 {
			lcName = clusterURL[idx+len("/clusters/"):]
		}
	}
	logger.Info("Resolved logical cluster", "workspace", wsPath, "logicalCluster", lcName)

	return lcName, nil
}

// ProvidersConfig returns a rest.Config targeting root:platform:providers.
func (b *Bootstrapper) ProvidersConfig() *rest.Config {
	return configForPath(b.config, "root:platform:providers")
}

// newClients creates dynamic and discovery clients from a rest.Config.
func newClients(cfg *rest.Config) (dynamic.Interface, discovery.DiscoveryInterface, error) {
	dynClient, err := dynamic.NewForConfig(cfg)
	if err != nil {
		return nil, nil, fmt.Errorf("creating dynamic client: %w", err)
	}
	discClient, err := discovery.NewDiscoveryClientForConfig(cfg)
	if err != nil {
		return nil, nil, fmt.Errorf("creating discovery client: %w", err)
	}
	return dynClient, discClient, nil
}

// configForPath returns a rest.Config targeting the given kcp workspace path.
func configForPath(base *rest.Config, clusterPath string) *rest.Config {
	cfg := rest.CopyConfig(base)
	cfg.Host = ClusterURL(cfg.Host, clusterPath)
	return cfg
}

// waitForWorkspaceReady polls until a workspace has phase "Ready".
func waitForWorkspaceReady(ctx context.Context, client dynamic.Interface, name string) error {
	return wait.PollUntilContextTimeout(ctx, 500*time.Millisecond, 60*time.Second, true, func(ctx context.Context) (bool, error) {
		ws, err := client.Resource(workspaceGVR).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return false, nil
		}
		phase, _, _ := unstructured.NestedString(ws.Object, "status", "phase")
		return phase == "Ready", nil
	})
}

// waitForCachedResourceReady polls until a CachedResource has phase "Ready" and returns its identityHash.
func waitForCachedResourceReady(ctx context.Context, client dynamic.Interface, name string) (string, error) {
	var identityHash string
	err := wait.PollUntilContextTimeout(ctx, 500*time.Millisecond, 60*time.Second, true, func(ctx context.Context) (bool, error) {
		cr, err := client.Resource(cachedResourceGVR).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return false, nil
		}
		phase, _, _ := unstructured.NestedString(cr.Object, "status", "phase")
		if phase != "Ready" {
			return false, nil
		}
		identityHash, _, _ = unstructured.NestedString(cr.Object, "status", "identityHash")
		return identityHash != "", nil
	})
	return identityHash, err
}
