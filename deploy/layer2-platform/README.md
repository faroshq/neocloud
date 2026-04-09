# Layer 2: Platform

Multi-tenant control plane with kcp, cloud APIs, identity, and self-service.

## Prerequisites

Layer 2 needs a **kubeconfig** for a workload cluster (the output of Layer 1).

Two dev flavors are available depending on what you're working on:

| | **Lima (local dev)** | **Integration (libvirt)** |
|---|---|---|
| **Purpose** | Fast code iteration | End-to-end integration testing |
| **Layer 1** | Lima VM, k3s | libvirt VMs, Metal3/CAPI, kube-ovn |
| **kcp** | Embedded (in-process) | kcp-operator (prod manifests) |
| **Zitadel** | docker-compose (localhost) | Helm on cluster (prod manifests) |
| **Operators** | Built-in reconcilers | Separate deployments |
| **Host** | macOS or Linux | Linux only (KVM required) |

## Dev Lima (local, fast iteration)

```bash
make dev-lima-up          # Create Lima VM + start Zitadel docker-compose
make dev-lima-run         # Build + run platform with embedded kcp
make dev-lima-login       # Login via OIDC
make console-dev          # Start console in dev mode (hot reload)
make dev-lima-down        # Tear down Lima VM + Zitadel
```

- Zitadel: https://localhost:10443
- Platform API: https://localhost:9443
- Console: http://localhost:1234 (via `make console-dev`)

### Lima Dev Files

| Directory | Contents |
|-----------|----------|
| [dev/lima/](dev/lima/) | Lima VM config (k3s + KubeVirt workload cluster) |
| [dev/zitadel-compose/](dev/zitadel-compose/) | Zitadel docker-compose + self-signed certs |

## Dev Integration (libvirt, prod-like)

Deploys the same manifests as production onto the Layer 1 libvirt cluster.
Single replicas, dev-generated secrets, configurable domain.

```bash
make layer1-dev-up            # Provision libvirt VMs + Metal3 cluster
make dev-integration-up       # Deploy Layer 2 prod manifests onto cluster
make dev-integration-down     # Remove Layer 2 from cluster
make layer1-dev-down          # Tear down libvirt VMs
```

Customize the dev domain (default: `dev.local`):

```bash
DEV_DOMAIN=my.test make dev-integration-up
```

### What gets deployed

The integration script applies prod manifests with dev overrides:

| Component | Prod | Dev Override |
|-----------|------|-------------|
| KCP FrontProxy | 2 replicas | 1 replica |
| Zitadel | 2 replicas, PDB | 1 replica, no PDB |
| PostgreSQL | 10Gi storage | Same (single instance) |
| Domain | `*.demo.example.com` | `*.dev.local` (configurable) |
| Secrets | Manual/Vault | Auto-generated |

### Integration Dev Files

| Directory | Contents |
|-----------|----------|
| [dev/integration/](dev/integration/) | up.sh/down.sh scripts for deploying prod manifests with dev overrides |

## Prod

| Component | Directory | Purpose |
|-----------|-----------|---------|
| kcp | [prod/kcp/](prod/kcp/) | RootShard + FrontProxy deployment |
| Platform APIs | [prod/platform-apis/](prod/platform-apis/) | APIResourceSchemas + APIExports |
| Operators | [prod/operators/](prod/operators/) | Compute, VM, notebook, GPU job, storage, network |
| Console | [prod/console/](prod/console/) | Web console deployment + HTTPRoute |
| CLI | [prod/cli/](prod/cli/) | Tunnel service for CLI access |
| Onboarding | [prod/onboarding/](prod/onboarding/) | Auto-provision tenant workspaces |
| Zitadel | [prod/zitadel/](prod/zitadel/) | Helm-based Zitadel + PostgreSQL |
