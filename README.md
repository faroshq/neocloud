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
| [docs/layers/01-infrastructure.md](docs/layers/01-infrastructure.md) | **Layer 1:** From bare metal to compute-ready K8s |
| [docs/layers/02-platform.md](docs/layers/02-platform.md) | **Layer 2:** Multi-tenant cloud APIs with kcp — **demo lives here** |
| [docs/layers/03-production.md](docs/layers/03-production.md) | **Layer 3:** Billing, monitoring, backup, operations |
| [docs/architecture/overview.md](docs/architecture/overview.md) | Simplified architecture overview |
| [docs/architecture/whitepaper.md](docs/architecture/whitepaper.md) | Full whitepaper |
| [docs/guides/deployment.md](docs/guides/deployment.md) | Production deployment guide |
| [docs/guides/demo.md](docs/guides/demo.md) | Quick demo setup guide |
| [dev/docs/](dev/docs/) | Local dev setup guides |
| [deploy/](deploy/) | Layered deploy manifests (dev + prod per layer) |
| [src/](src/) | Source code (platform + console) |

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
