# Layer 2: Platform

Multi-tenant control plane with kcp, cloud APIs, identity, and self-service.

## Prerequisites

Layer 2 needs a **kubeconfig** for a workload cluster (the output of Layer 1). For local dev, use Lima to create one:

```bash
make lima-up                # Create Lima VM with k3s + KubeVirt
```

## Dev Mode

```bash
make lima-up                # Workload cluster (Lima VM, k3s + KubeVirt)
make layer2-dev-up          # Start Zitadel OIDC (docker-compose)
make run-dev                # Platform binary with embedded kcp
make layer2-dev-down        # Stop Zitadel
make lima-down              # Delete Lima VM
```

Dev uses embedded kcp (in-process) and Zitadel via docker-compose with self-signed certs.

- Zitadel: https://localhost:10443
- Platform API: https://localhost:9443
- Console: http://localhost:1234 (via `make console-dev`)

### Dev Files

| Directory | Contents |
|-----------|----------|
| [dev/lima/](dev/lima/) | Lima VM config (k3s + KubeVirt workload cluster) |
| [dev/zitadel-compose/](dev/zitadel-compose/) | Zitadel docker-compose + self-signed certs |

## Prod Mode

| Component | Directory | Purpose |
|-----------|-----------|---------|
| kcp | [prod/kcp/](prod/kcp/) | RootShard + FrontProxy deployment |
| Platform APIs | [prod/platform-apis/](prod/platform-apis/) | APIResourceSchemas + APIExports |
| Operators | [prod/operators/](prod/operators/) | Compute, VM, notebook, GPU job, storage, network |
| Console | [prod/console/](prod/console/) | Web console deployment + HTTPRoute |
| CLI | [prod/cli/](prod/cli/) | Tunnel service for CLI access |
| Onboarding | [prod/onboarding/](prod/onboarding/) | Auto-provision tenant workspaces |
| Zitadel | [prod/zitadel/](prod/zitadel/) | Helm-based Zitadel + PostgreSQL |

## Dev vs Prod Parity

| Concern | Dev | Prod |
|---------|-----|------|
| kcp | Embedded (in-process) | kcp-operator (RootShard + FrontProxy) |
| Workload cluster | Lima VM (k3s + KubeVirt) | Layer 1 bare metal cluster |
| Identity | Zitadel docker-compose | Helm-deployed Zitadel + PostgreSQL |
| TLS | Self-signed certs | cert-manager + Let's Encrypt |
| Operators | Built-in reconcilers | Separate deployments per operator |
