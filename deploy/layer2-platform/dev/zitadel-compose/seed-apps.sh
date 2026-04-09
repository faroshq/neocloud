#!/usr/bin/env bash
# =============================================================================
# Zitadel Dev Seed Script
# =============================================================================
# Pre-creates OIDC applications in Zitadel for local development.
# Uses the admin-sa PAT (IAM_OWNER) that Zitadel auto-generates on first startup.
#
# Creates:
#   1. "Sovereign Cloud Platform" project
#   2. KCP Web Console OIDC app (Authorization Code + PKCE)
#   3. KCP CLI OIDC app (Device Authorization flow)
#
# Outputs client IDs to .seed-output for use by other targets.
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SEED_OUTPUT="${SCRIPT_DIR}/.seed-output"

# ---------------------------------------------------------------------------
# Color output helpers
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()    { echo -e "${GREEN}[INFO]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}    $*"; }
error()   { echo -e "${RED}[ERROR]${NC}   $*" >&2; }
section() { echo -e "\n${BLUE}==>${NC} $*"; }

# ---------------------------------------------------------------------------
# Read configuration from .env
# ---------------------------------------------------------------------------
ZITADEL_DOMAIN="${ZITADEL_DOMAIN:-localhost}"
ZITADEL_EXTERNALPORT="${ZITADEL_EXTERNALPORT:-10443}"
ZITADEL_EXTERNALSECURE="${ZITADEL_EXTERNALSECURE:-true}"

if [ "${ZITADEL_EXTERNALSECURE}" = "true" ]; then
    ZITADEL_API="https://${ZITADEL_DOMAIN}:${ZITADEL_EXTERNALPORT}"
    CURL_OPTS="-sk"
else
    ZITADEL_API="http://${ZITADEL_DOMAIN}:${ZITADEL_EXTERNALPORT}"
    CURL_OPTS="-s"
fi

# ---------------------------------------------------------------------------
# Check if already seeded
# ---------------------------------------------------------------------------
if [ -f "${SEED_OUTPUT}" ]; then
    info "Apps already seeded (${SEED_OUTPUT} exists). To re-seed, remove it first."
    cat "${SEED_OUTPUT}"
    exit 0
fi

# ---------------------------------------------------------------------------
# Get admin-sa PAT from the bootstrap volume
# ---------------------------------------------------------------------------
section "Retrieving admin-sa PAT from Zitadel bootstrap volume..."

CONTAINER_NAME=$(cd "${SCRIPT_DIR}" && docker compose ps -q zitadel-api 2>/dev/null || true)
if [ -z "${CONTAINER_NAME}" ]; then
    error "Zitadel container not running. Run 'make layer2-dev-up' first."
    exit 1
fi

# Zitadel container is distroless (no cat/sh), so use docker cp
TMP_PAT=$(mktemp)
trap "rm -f ${TMP_PAT}" EXIT

if ! docker cp "${CONTAINER_NAME}:/zitadel/bootstrap/admin.pat" "${TMP_PAT}" 2>/dev/null; then
    error "Could not read admin.pat from bootstrap volume."
    error "If this is an existing Zitadel instance, you need to reset it first:"
    error "  cd ${SCRIPT_DIR} && docker compose down -v && docker compose up -d --wait"
    exit 1
fi

ZITADEL_PAT=$(cat "${TMP_PAT}")
if [ -z "${ZITADEL_PAT}" ]; then
    error "admin.pat is empty. Is Zitadel fully initialized?"
    exit 1
fi

info "PAT retrieved successfully."

AUTH_HEADER="Authorization: Bearer ${ZITADEL_PAT}"
CONTENT_TYPE="Content-Type: application/json"

# ---------------------------------------------------------------------------
# Helper: Make API call to Zitadel Management API
# ---------------------------------------------------------------------------
zitadel_api() {
    local method="$1"
    local endpoint="$2"
    local data="${3:-}"

    local url="${ZITADEL_API}${endpoint}"

    if [ -n "${data}" ]; then
        curl ${CURL_OPTS} -X "${method}" "${url}" \
            -H "${AUTH_HEADER}" \
            -H "${CONTENT_TYPE}" \
            -d "${data}"
    else
        curl ${CURL_OPTS} -X "${method}" "${url}" \
            -H "${AUTH_HEADER}" \
            -H "${CONTENT_TYPE}"
    fi
}

# ---------------------------------------------------------------------------
# Step 1: Create project
# ---------------------------------------------------------------------------
section "Creating project..."

PROJECT_RESPONSE=$(zitadel_api POST "/management/v1/projects" "{
    \"name\": \"Sovereign Cloud Platform\",
    \"projectRoleAssertion\": true,
    \"projectRoleCheck\": false,
    \"hasProjectCheck\": false
}")

PROJECT_ID=$(echo "${PROJECT_RESPONSE}" | jq -r '.id // empty')
if [ -n "${PROJECT_ID}" ]; then
    info "Project created with ID: ${PROJECT_ID}"
else
    warn "Project may already exist. Searching..."
    PROJECT_ID=$(zitadel_api POST "/management/v1/projects/_search" "{
        \"queries\": [{
            \"nameQuery\": {
                \"name\": \"Sovereign Cloud Platform\",
                \"method\": \"TEXT_QUERY_METHOD_EQUALS\"
            }
        }]
    }" | jq -r '.result[0].id // empty')

    if [ -z "${PROJECT_ID}" ]; then
        error "Could not create or find the project. Aborting."
        exit 1
    fi
    info "Found existing project: ${PROJECT_ID}"
fi

# ---------------------------------------------------------------------------
# Step 2: Create KCP Web Console OIDC App
# ---------------------------------------------------------------------------
section "Creating KCP Web Console OIDC app..."

KCP_WEB_APP_RESPONSE=$(zitadel_api POST "/management/v1/projects/${PROJECT_ID}/apps/oidc" "{
    \"name\": \"KCP Web Console\",
    \"redirectUris\": [
        \"https://localhost:9443/auth/callback\",
        \"http://localhost:1234/callback\"
    ],
    \"responseTypes\": [\"OIDC_RESPONSE_TYPE_CODE\"],
    \"grantTypes\": [
        \"OIDC_GRANT_TYPE_AUTHORIZATION_CODE\",
        \"OIDC_GRANT_TYPE_REFRESH_TOKEN\"
    ],
    \"appType\": \"OIDC_APP_TYPE_WEB\",
    \"authMethodType\": \"OIDC_AUTH_METHOD_TYPE_NONE\",
    \"postLogoutRedirectUris\": [
        \"https://localhost:9443\",
        \"http://localhost:1234\"
    ],
    \"devMode\": true,
    \"accessTokenType\": \"OIDC_TOKEN_TYPE_JWT\",
    \"idTokenRoleAssertion\": true,
    \"idTokenUserinfoAssertion\": true
}")

KCP_WEB_CLIENT_ID=$(echo "${KCP_WEB_APP_RESPONSE}" | jq -r '.clientId // empty')
if [ -n "${KCP_WEB_CLIENT_ID}" ]; then
    info "KCP Web Console app created. Client ID: ${KCP_WEB_CLIENT_ID}"
else
    warn "Web app creation response: ${KCP_WEB_APP_RESPONSE}"
    error "Failed to create KCP Web Console app."
    exit 1
fi

# ---------------------------------------------------------------------------
# Step 3: Create KCP CLI OIDC App
# ---------------------------------------------------------------------------
section "Creating KCP CLI OIDC app..."

KCP_CLI_APP_RESPONSE=$(zitadel_api POST "/management/v1/projects/${PROJECT_ID}/apps/oidc" "{
    \"name\": \"KCP CLI\",
    \"redirectUris\": [
        \"http://localhost:8085/callback\",
        \"urn:ietf:wg:oauth:2.0:oob\"
    ],
    \"responseTypes\": [\"OIDC_RESPONSE_TYPE_CODE\"],
    \"grantTypes\": [
        \"OIDC_GRANT_TYPE_AUTHORIZATION_CODE\",
        \"OIDC_GRANT_TYPE_REFRESH_TOKEN\",
        \"OIDC_GRANT_TYPE_DEVICE_CODE\"
    ],
    \"appType\": \"OIDC_APP_TYPE_NATIVE\",
    \"authMethodType\": \"OIDC_AUTH_METHOD_TYPE_NONE\",
    \"devMode\": true,
    \"accessTokenType\": \"OIDC_TOKEN_TYPE_JWT\",
    \"idTokenRoleAssertion\": true,
    \"idTokenUserinfoAssertion\": true
}")

KCP_CLI_CLIENT_ID=$(echo "${KCP_CLI_APP_RESPONSE}" | jq -r '.clientId // empty')
if [ -n "${KCP_CLI_CLIENT_ID}" ]; then
    info "KCP CLI app created. Client ID: ${KCP_CLI_CLIENT_ID}"
else
    warn "CLI app creation response: ${KCP_CLI_APP_RESPONSE}"
    error "Failed to create KCP CLI app."
    exit 1
fi

# ---------------------------------------------------------------------------
# Save output
# ---------------------------------------------------------------------------
cat > "${SEED_OUTPUT}" <<EOF
OIDC_WEB_CLIENT_ID=${KCP_WEB_CLIENT_ID}
OIDC_CLI_CLIENT_ID=${KCP_CLI_CLIENT_ID}
ZITADEL_PROJECT_ID=${PROJECT_ID}
EOF

section "Seed complete!"
info "Project ID:       ${PROJECT_ID}"
info "Web Client ID:    ${KCP_WEB_CLIENT_ID}"
info "CLI Client ID:    ${KCP_CLI_CLIENT_ID}"
info "Output saved to:  ${SEED_OUTPUT}"
