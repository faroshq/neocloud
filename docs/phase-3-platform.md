# Phase 3: Platform Server

The platform server is the core binary that runs embedded kcp, proxies APIs, handles OIDC auth, and reconciles tenant workloads.

## Quick Setup

```bash
make run-dev
```

This builds the binary and starts it with all integrations wired up.

## What It Does

`platform start` launches these components in a single process:

1. **Embedded kcp** — in-process kcp server on `:6443`
2. **kcp Bootstrap** — creates workspace hierarchy (`root:platform:providers`, `root:platform:tenants`), installs APIExports and APIBindings
3. **OIDC Auth Handler** — `/auth/authorize` and `/auth/callback` endpoints (delegates to Zitadel)
4. **kcp API Proxy** — `/clusters/*`, `/api`, `/openapi`, `/version` with OIDC or static token auth
5. **Console Proxy** — `/console/*` reverse-proxied to the console dev server
6. **Cloud Operator** — multicluster controllers that reconcile tenant resources (VirtualMachines, etc.) to the workload cluster

## Endpoints

| Path | Description |
|------|-------------|
| `https://localhost:9443/console/` | Web console (proxied) |
| `https://localhost:9443/auth/authorize` | OIDC authorization |
| `https://localhost:9443/auth/callback` | OIDC callback |
| `https://localhost:9443/auth/token-login` | Static token login |
| `https://localhost:9443/clusters/*` | kcp workspace API proxy |
| `https://localhost:9443/api` | Kubernetes API discovery |
| `https://localhost:9443/version` | Server version |

## Flags

All flags used by `make run-dev`:

| Flag | Default | Description |
|------|---------|-------------|
| `--embedded-kcp` | `false` | Run kcp in-process |
| `--dev-mode` | `false` | Skip TLS verification |
| `--listen-addr` | `:9443` | Server listen address |
| `--console-addr` | `localhost:1234` | Console dev server to proxy |
| `--oidc-issuer-url` | | Zitadel OIDC issuer URL |
| `--oidc-client-id` | | OIDC client ID |
| `--workload-kubeconfig` | | Kubeconfig for Kind workload cluster |
| `--data-dir` | `.platform-data` | State directory |
| `--kcp-secure-port` | `6443` | Embedded kcp port |
| `--kcp-bind-address` | `127.0.0.1` | Embedded kcp bind address |
| `--kcp-batteries-include` | `admin,user` | kcp batteries to enable |
| `--hub-external-url` | `https://localhost:9443` | External URL for kubeconfig generation |
| `--static-auth-tokens` | | Comma-separated static bearer tokens |

## How `run-dev` Wires Everything

```makefile
run-dev: build-platform zitadel-up
    ./bin/platform start \
        --embedded-kcp \
        --dev-mode \
        --console-addr localhost:1234 \
        --oidc-issuer-url http://localhost:8080 \
        --oidc-client-id 366808256712106243 \
        --workload-kubeconfig .platform-data/workload-kubeconfig  # if file exists
```

The `--workload-kubeconfig` flag is only passed when `.platform-data/workload-kubeconfig` exists (created by `make kind-up`).

## Data Directory

All state is stored in `.platform-data/`:

```
.platform-data/
├── workload-kubeconfig    # Kind cluster kubeconfig (from make kind-up)
└── ... (kcp data, TLS certs, etcd)
```

## Running Without KubeVirt

The workload cluster is optional. If you skip `make kind-kubevirt`, the platform still runs — the cloud operator won't reconcile VM resources to a backend cluster, but kcp, OIDC, and the console all work.

```bash
make zitadel-up
make console-dev   # separate terminal
make run-dev       # runs without --workload-kubeconfig
```

## Running Without Zitadel

You can use static tokens instead of OIDC:

```bash
make build-platform
./bin/platform start \
    --embedded-kcp \
    --dev-mode \
    --static-auth-tokens my-dev-token

# Login with static token
./bin/platform-cli login \
    --hub-url https://localhost:9443 \
    --token my-dev-token \
    --insecure-skip-tls-verify
```

## Verify

```bash
# Server is running
curl -k https://localhost:9443/version

# OIDC discovery (proxied from Zitadel)
curl -s http://localhost:8080/.well-known/openid-configuration | jq .issuer

# After login, list workspaces
kubectl ws tree
```
