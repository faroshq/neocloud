# Phase 2: Zitadel (Identity / OIDC)

Zitadel provides OIDC authentication for the platform. It runs via Docker Compose locally.

## Quick Setup

```bash
make zitadel-up
```

## What Happens

Docker Compose starts four services in `dev/zitadel-compose/`:

| Service | Image | Role |
|---------|-------|------|
| **proxy** | Traefik 3.6.8 | Reverse proxy, routes requests to API or Login |
| **zitadel-api** | ghcr.io/zitadel/zitadel:v4.11.0 | OIDC provider, gRPC/REST API |
| **zitadel-login** | ghcr.io/zitadel/zitadel-login:v4.11.0 | Login UI at `/ui/v2/login` |
| **postgres** | postgres:17.2-alpine | Database backend |

Traefik listens on port `8080` and routes:
- `/api/*` → Zitadel API (h2c)
- `/ui/v2/login/*` → Zitadel Login UI
- `/` → redirects to Login UI
- Everything else → Zitadel API (catch-all for OIDC endpoints)

## Access

| Item | Value |
|------|-------|
| Admin console | http://localhost:8080/ui/console |
| Admin login hint | http://localhost:8080/ui/console?login_hint=zitadel-admin@zitadel.localhost |
| Admin username | `zitadel-admin@zitadel.localhost` |
| Admin password | `Password1!` |
| OIDC issuer URL | `http://localhost:8080` |
| OIDC client ID | `366808256712106243` |
| OIDC discovery | http://localhost:8080/.well-known/openid-configuration |

## Configuration

Environment variables in `dev/zitadel-compose/.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `ZITADEL_DOMAIN` | `localhost` | External domain |
| `PROXY_HTTP_PUBLISHED_PORT` | `8080` | Published HTTP port |
| `ZITADEL_EXTERNALSECURE` | `false` | TLS termination (false for local) |
| `ZITADEL_MASTERKEY` | `MasterkeyNeedsToHave32Characters` | Encryption master key |
| `POSTGRES_ADMIN_PASSWORD` | `postgres` | Postgres password |

## Setting Up Identity Providers

To add GitHub/Google login, use the setup script:

```bash
export ZITADEL_DOMAIN=localhost
export ZITADEL_PAT=<personal-access-token>  # create in admin console

# Optional: GitHub OIDC
export GITHUB_CLIENT_ID=<github-oauth-client-id>
export GITHUB_CLIENT_SECRET=<github-oauth-client-secret>

# Optional: Google OIDC
export GOOGLE_CLIENT_ID=<google-oauth-client-id>
export GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>

./deploy/zitadel/setup-oidc.sh
```

This creates:
- **KCP Web Console** OIDC app (Authorization Code + PKCE)
- **KCP CLI** OIDC app (Device Authorization flow)
- GitHub and/or Google as identity providers

## Verify

```bash
# OIDC discovery endpoint
curl -s http://localhost:8080/.well-known/openid-configuration | jq .issuer

# Docker Compose status
cd dev/zitadel-compose && docker compose ps

# Logs
cd dev/zitadel-compose && docker compose logs -f zitadel-api
```

## Tear Down

```bash
make zitadel-down
```

This stops all containers. Data is persisted in Docker volumes (`postgres-data`, `zitadel-bootstrap`).

To fully reset Zitadel (including data):

```bash
cd dev/zitadel-compose && docker compose down -v
```
