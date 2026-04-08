# Platform Control Plane

The platform binary implements Layer 2 of the reference architecture: a multi-tenant cloud control plane built on [kcp](https://kcp.io).

## What It Does

- Runs an embedded kcp server (or connects to an external one)
- Bootstraps workspace hierarchy (`root:platform` → `providers` + `tenants`)
- Installs cloud APIs via kcp APIExport/APIBinding (`compute.cloud.platform/v1alpha1`)
- Reconciles tenant resources into real workloads on a backend Kubernetes cluster (KubeVirt VMs, etc.)
- Proxies the NeoCloud web console at `/console`

## Quick Start

```bash
# Build
make build

# Run with embedded kcp (all-in-one)
./bin/platform start --embedded-kcp

# Run against external kcp
./bin/platform start --kubeconfig /path/to/kcp-admin.kubeconfig
```

## Flags

| Flag | Default | Description |
|------|---------|-------------|
| `--data-dir` | `.platform-data` | State directory |
| `--listen-addr` | `:9443` | HTTP listen address |
| `--embedded-kcp` | `false` | Run kcp in-process |
| `--kubeconfig` | | Kubeconfig for hub cluster |
| `--workload-kubeconfig` | | Kubeconfig for backend workload cluster (KubeVirt) |
| `--console-addr` | | NeoCloud console address to reverse-proxy |
| `--kcp-secure-port` | `6443` | Embedded kcp API server port |
| `--kcp-bind-address` | `127.0.0.1` | Embedded kcp bind address |
| `--kcp-batteries-include` | `admin,user` | kcp batteries to enable |

## Project Layout

```
apis/                       API type definitions (importable)
  common/v1alpha1/            RelatedResource, status helpers
  compute/v1alpha1/           VirtualMachine, KubernetesCluster
cmd/platform/               Cobra entrypoint
config/
  crds/                     Generated CRDs (controller-gen output)
  kcp/                      Generated APIResourceSchemas, APIExports, workspace templates
pkg/
  bootstrap/                CRD installer (embeds YAML, creates/updates, waits Established)
  controllers/compute/      Reconciler: platform VM → KubeVirt VMI on workload cluster
  kcp/                      Embedded kcp wrapper + workspace bootstrap
  server/                   Server orchestration, options, scheme
hack/
  update-codegen-crds.sh    Code generation pipeline
  gen-core-apiexport/       Merges per-group APIExports into cloud.platform
  go-install.sh             Tool installer
```

## API Groups

| Group | Resources | Status |
|-------|-----------|--------|
| `compute.cloud.platform/v1alpha1` | VirtualMachine, KubernetesCluster | Implemented |
| `databases.cloud.platform/v1alpha1` | SQL, NoSQL, KeyValue, Vector | Planned |
| `storage.cloud.platform/v1alpha1` | Object, Block, File | Planned |
| `networking.cloud.platform/v1alpha1` | VirtualNetwork, Peering | Planned |

## Code Generation

All CRDs, deepcopy, and kcp APIResourceSchemas are generated from Go type definitions:

```bash
# Install tools (controller-gen + kcp apigen)
make tools

# Run full pipeline: deepcopy → CRDs → bootstrap embed → APIResourceSchemas → merged APIExport
make codegen

# Verify generated files are up to date
make verify-codegen
```

The pipeline:
1. `controller-gen object` → `zz_generated.deepcopy.go`
2. `controller-gen crd` → `config/crds/*.yaml`
3. Copy CRDs → `pkg/bootstrap/crds/`
4. `kcp apigen` → `config/kcp/apiresourceschema-*.yaml`
5. `gen-core-apiexport` → `config/kcp/apiexport-cloud.platform.yaml`

## Architecture

```
                    ┌──────────────────────┐
                    │   platform start     │
                    │                      │
  ┌─────────┐      │  ┌───────────────┐   │     ┌──────────────┐
  │ Tenant  │─────▶│  │  kcp (embed)  │   │     │   Workload   │
  │ kubectl │      │  │  APIExport    │   │────▶│   Cluster    │
  └─────────┘      │  └───────────────┘   │     │  (KubeVirt)  │
                   │  ┌───────────────┐   │     └──────────────┘
  ┌─────────┐      │  │  Controllers  │   │
  │ Browser │─────▶│  │  (reconcile)  │   │
  └─────────┘      │  └───────────────┘   │
    /console       │  ┌───────────────┐   │
                   │  │   NeoCloud    │   │
                   │  │   (proxy)     │   │
                   │  └───────────────┘   │
                   └──────────────────────┘
```
