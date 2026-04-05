# Local Development Setup

Quick start guide for running the full NeoCloud stack locally.

## Prerequisites

```bash
go            # 1.22+
node / npm    # 20+
docker        # with Docker Compose v2
kind          # https://kind.sigs.k8s.io/
kubectl       # v1.30+
```

System: 16 GB+ RAM, 8+ CPU cores recommended.

## Quick Start

```bash
# 1. Bring up all dependencies (Kind + KubeVirt + Zitadel)
make dev-up

# 2. Start the console dev server (separate terminal)
make console-dev

# 3. Start the platform server (separate terminal)
make run-dev

# 4. Login (separate terminal)
make dev-login
```

Platform runs at `https://localhost:9443`. Console at `https://localhost:9443/console/`.

## Architecture

```
                    ┌─────────────────────────────────────┐
                    │         Platform Server (:9443)      │
                    │  ┌──────────┐  ┌────────────────┐   │
                    │  │ Embedded │  │  OIDC Proxy     │   │
                    │  │   kcp    │  │  (→ Zitadel)    │   │
                    │  └──────────┘  └────────────────┘   │
                    │  ┌──────────┐  ┌────────────────┐   │
                    │  │ kcp API  │  │ Console Proxy   │   │
                    │  │  Proxy   │  │ (→ :1234)       │   │
                    │  └──────────┘  └────────────────┘   │
                    └──────────┬──────────────┬───────────┘
                               │              │
              ┌────────────────┘              └──────────────┐
              ▼                                              ▼
  ┌───────────────────────┐                  ┌──────────────────────┐
  │  Zitadel (Compose)    │                  │  Kind Cluster        │
  │  :8080                │                  │  (neocloud-workload) │
  │  ├── Traefik proxy    │                  │  ├── KubeVirt        │
  │  ├── Zitadel API      │                  │  └── Tenant VMs     │
  │  ├── Zitadel Login    │                  └──────────────────────┘
  │  └── PostgreSQL       │
  └───────────────────────┘
```

## Individual Phases

Each phase can be set up independently. See:

- [Phase 1: Kind + KubeVirt](phase-1-kind-kubevirt.md) — Workload cluster setup
- [Phase 2: Zitadel](phase-2-zitadel.md) — Identity / OIDC provider
- [Phase 3: Platform Server](phase-3-platform.md) — Core platform binary
- [Phase 4: Console & CLI](phase-4-console-cli.md) — Web console and CLI tools

## Tear Down

```bash
# Everything
make dev-down

# Or individually:
make zitadel-down
make kind-down
```

## Full Reset

```bash
make dev-down
rm -rf .platform-data
make dev-up
```

## Make Targets Reference

### Dev Environment

| Target | Description |
|--------|-------------|
| `make dev-up` | Bring up all deps (Kind + KubeVirt + Zitadel) |
| `make dev-down` | Tear down all deps |
| `make run-dev` | Build + start platform server |
| `make dev-login` | Login to local platform via OIDC |
| `make console-dev` | Start console dev server with hot reload |

### Infrastructure (individual)

| Target | Description |
|--------|-------------|
| `make kind-up` | Create Kind workload cluster |
| `make kind-down` | Delete Kind workload cluster |
| `make kind-kubevirt` | Create Kind cluster + install KubeVirt |
| `make zitadel-up` | Start Zitadel via Docker Compose |
| `make zitadel-down` | Stop Zitadel |

### Build

| Target | Description |
|--------|-------------|
| `make build` | Build platform + CLI binaries |
| `make build-platform` | Build platform server binary |
| `make build-cli` | Build CLI binary |
| `make build-console` | Build console for production |

### Overridable Variables

```bash
make run-dev \
  OIDC_ISSUER_URL=http://localhost:8080 \
  OIDC_CLIENT_ID=366808256712106243 \
  CONSOLE_ADDR=localhost:1234 \
  WORKLOAD_KUBECONFIG=.platform-data/workload-kubeconfig

make kind-kubevirt \
  KIND_CLUSTER_NAME=neocloud-workload \
  KUBEVIRT_VERSION=v1.4.0
```
