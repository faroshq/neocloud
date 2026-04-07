# Sovereign Small Cloud — Reference Architecture

A reference architecture for building a multi-tenant cloud platform on commodity hardware using [kcp](https://kcp.io) as the control plane.

## What Is This?

A blueprint for small infrastructure providers who want to offer cloud services to external users. Tenants sign in via OIDC, get an isolated workspace, and deploy workloads through Kubernetes-native APIs — without ever touching the underlying clusters.

## Architecture

```
Layer 3: Production           Billing, metering, monitoring, day-2 ops
──────────────────────────────────────────────────────────────────────
Layer 2: Platform              kcp, cloud APIs, identity, cloud operator
                               ← DEMO
──────────────────────────────────────────────────────────────────────
Layer 1: Infrastructure        Bare metal → Kubernetes (Metal3, Flatcar,
                               Kube-OVN, Ceph, GPU Operator, KubeVirt)
```

## Documents

| Document | What it covers |
|----------|---------------|
| [01-infrastructure.md](01-infrastructure.md) | **Layer 1:** From bare metal to compute-ready K8s |
| [02-platform.md](02-platform.md) | **Layer 2:** Multi-tenant cloud APIs with kcp — **demo lives here** |
| [03-production.md](03-production.md) | **Layer 3:** Billing, monitoring, backup, operations |
| [overview.md](overview.md) | Simplified architecture overview |
| [deployment.md](deployment.md) | Production deployment guide (20 phases) |
| [demo.md](demo.md) | Quick demo setup guide |
| [deploy/](deploy/) | 83 YAML manifests for all components |

## Core Stack

| Component | Role | License |
|-----------|------|---------|
| [kcp](https://kcp.io) | Multi-tenant control plane | Apache 2.0 |
| [Kubernetes](https://kubernetes.io) | Workload execution | Apache 2.0 |
| [Kube-OVN](https://kubeovn.github.io/docs/) | Networking + tenant virtual networks | Apache 2.0 |
| [Dex](https://dexidp.io) | OIDC broker (demo) | Apache 2.0 |

## Status

**Working draft.** We're building the demo around Layer 2 first, then extending to Layers 1 and 3.

## License

Apache 2.0
