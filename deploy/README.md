# Deploy

Deployment manifests organized by architectural layer, each with dev and prod paths.

```
Layer 3: Production        Billing, metering, monitoring, backup
──────────────────────────────────────────────────────────────────
Layer 2: Platform           kcp, cloud APIs, identity, operators, console
──────────────────────────────────────────────────────────────────
Layer 1: Infrastructure     Bare metal → Kubernetes, KubeVirt, networking, storage
```

## Structure

Each layer has `dev/` (local dev environment) and `prod/` (production templates):

| Directory | Dev | Prod |
|-----------|-----|------|
| [layer1-infra/](layer1-infra/) | 3 Lima VMs (mgmt + cpu + gpu worker) | Metal3, Cluster API, Kube-OVN, Ceph |
| [layer2-platform/](layer2-platform/) | Zitadel docker-compose + embedded kcp | kcp operator, platform APIs, operators |
| [layer3-production/](layer3-production/) | Stubs (skip in dev) | Observability, backup, billing, quota |

## Quick Start (Dev)

```bash
make layer1-dev-up          # 3-node cluster via Lima
make layer2-dev-up          # Zitadel OIDC via docker-compose
make run-dev                # Platform binary with embedded kcp
```

See each layer's README for details.
