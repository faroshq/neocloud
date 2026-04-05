# Phase 4: Console & CLI

## Web Console

The console is a Piral micro-frontend in `project/console/`.

### Dev Mode (Hot Reload)

```bash
make console-dev
```

This installs npm dependencies and starts the Piral debug server. The console runs at `http://localhost:1234` with hot reload.

When the platform server is running, it proxies the console at `https://localhost:9443/console/`.

### Production Build

```bash
make build-console   # builds to project/console/app-shell/dist/
make docker-console  # builds Docker image
make run-console     # runs Docker image on :4466
```

### Console Structure

```
project/console/
├── app-shell/       # Piral app shell (main entry point)
│   ├── src/
│   └── package.json
└── pilets/          # Micro-frontend modules
    └── */
```

## CLI

The CLI (`platform-cli`) authenticates with the platform and configures kubectl.

### Build

```bash
make build-cli
```

### Login via OIDC

```bash
make dev-login
# equivalent to:
# ./bin/platform-cli login --hub-url https://localhost:9443 --insecure-skip-tls-verify
```

This opens a browser for OIDC login via Zitadel. After authentication:
- Tokens cached at `~/.config/platform/tokens/<hash>.json`
- Kubeconfig entry merged into your default kubeconfig
- kubectl configured with an exec credential plugin (`platform-cli get-token`)

### Login via Static Token

```bash
./bin/platform-cli login \
    --hub-url https://localhost:9443 \
    --token my-dev-token \
    --insecure-skip-tls-verify
```

### After Login

```bash
# List workspaces
kubectl ws tree

# See available APIs
kubectl api-resources

# Create resources
kubectl apply -f my-vm.yaml
```

### CLI Commands

| Command | Description |
|---------|-------------|
| `login` | Authenticate with the platform (OIDC or static token) |
| `get-token` | Exec credential plugin for kubectl (auto-refreshes tokens) |

### Login Flags

| Flag | Description |
|------|-------------|
| `--hub-url` | Platform server URL (required) |
| `--token` | Static bearer token (skips OIDC if provided) |
| `--insecure-skip-tls-verify` | Skip TLS verification (needed for self-signed certs) |
