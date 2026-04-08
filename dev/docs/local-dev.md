# Local Development Setup

Quick start guide for running the full NeoCloud stack locally.

## Prerequisites

```bash
go            # 1.22+
node / npm    # 20+
docker        # with Docker Compose v2
lima          # brew install lima
kubectl       # v1.30+
```

System: 16 GB+ RAM, 8+ CPU cores recommended.

## Quick Start

```bash
# 1. Bring up all dependencies (Lima workload cluster + Zitadel)
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
  │  Zitadel (Compose)    │                  │  Lima VM (x86_64)    │
  │  :10443               │                  │  ├── k3s             │
  │  ├── Traefik proxy    │                  │  ├── KubeVirt        │
  │  ├── Zitadel API      │                  │  └── Tenant VMs     │
  │  ├── Zitadel Login    │                  └──────────────────────┘
  │  └── PostgreSQL       │
  └───────────────────────┘
```

## Layer Boundaries

```
Layer 2+ (runs on macOS/Linux)
   Platform, kcp, Zitadel, console, operators
────────────── kubeconfig ──────────────────
Layer 1 (Linux only, or Lima for dev)
   Bare metal → Kubernetes + KubeVirt
```

For macOS dev, Lima replaces Layer 1 entirely — same output (kubeconfig), simpler setup.

## Make Targets

### Dev Environment

| Target | Description |
|--------|-------------|
| `make dev-up` | Bring up all deps (Lima + Zitadel) |
| `make dev-down` | Tear down all deps |
| `make run-dev` | Build + start platform server |
| `make dev-login` | Login to local platform via OIDC |
| `make console-dev` | Start console dev server with hot reload |

### Workload Cluster (Lima)

| Target | Description |
|--------|-------------|
| `make lima-up` | Create Lima VM with k3s + KubeVirt |
| `make lima-down` | Delete Lima VM |
| `make lima-status` | Show Lima VM status |
| `make lima-kubeconfig` | Extract kubeconfig |

### Layer 2 (Zitadel)

| Target | Description |
|--------|-------------|
| `make layer2-dev-up` | Start Zitadel via Docker Compose |
| `make layer2-dev-down` | Stop Zitadel |

### Build

| Target | Description |
|--------|-------------|
| `make build` | Build platform + CLI binaries |
| `make build-platform` | Build platform server binary |
| `make build-cli` | Build CLI binary |
| `make build-console` | Build console for production |
| `make docker-platform` | Build platform Docker image |
| `make docker-console` | Build console Docker image |

## Tear Down

```bash
# Everything
make dev-down

# Or individually:
make layer2-dev-down    # Zitadel
make lima-down          # Lima VM
```

## Full Reset

```bash
make dev-down
rm -rf .platform-data
make dev-up
```
