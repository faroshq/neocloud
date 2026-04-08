# Deploy

Deployment manifests organized by architectural layer, each with dev and prod paths.

```
Layer 3: Production        Billing, metering, monitoring, backup
──────────────────────────────────────────────────────────────────
Layer 2: Platform           kcp, cloud APIs, identity, operators, console
──────────────── kubeconfig ─────────────────────────────────────
Layer 1: Infrastructure     Bare metal → Kubernetes, KubeVirt, networking, storage
```

The boundary between Layer 1 and Layer 2 is a **kubeconfig**. Layer 1 produces it, Layer 2+ consumes it.

## Structure

Each layer has `dev/` (local dev environment) and `prod/` (production templates):

| Directory | Dev | Prod |
|-----------|-----|------|
| [layer1-infra/](layer1-infra/) | Linux: libvirt + Metal3 + Ironic | Metal3, Cluster API, Kube-OVN, Ceph |
| [layer2-platform/](layer2-platform/) | Lima VM (k3s + KubeVirt) + Zitadel compose | kcp operator, platform APIs, operators |
| [layer3-production/](layer3-production/) | Stubs (skip in dev) | Observability, backup, billing, quota |

## Quick Start (Dev, macOS/Linux)

```bash
make lima-up                # Workload cluster via Lima (k3s + KubeVirt)
make layer2-dev-up          # Zitadel OIDC via docker-compose
make run-dev                # Platform binary with embedded kcp
```

## Layer 1 (Linux only)

```bash
make layer1-dev-up          # libvirt VMs + Metal3 + Ironic (requires Linux + KVM)
```

See each layer's README for details.
