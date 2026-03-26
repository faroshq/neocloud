#!/usr/bin/env bash
# =============================================================================
# Zitadel OIDC Configuration Script
# =============================================================================
#
# This script configures OIDC providers and applications in Zitadel for use
# with the Sovereign Cloud Platform. It creates:
#
#   1. GitHub Identity Provider  - Social login via GitHub
#   2. Google Identity Provider  - Social login via Google
#   3. KCP Web OIDC App          - Web application (authorization code flow)
#   4. KCP CLI OIDC App          - Native application (device authorization)
#
# Prerequisites:
#   - Zitadel is deployed and accessible at https://auth.demo.example.com
#   - A service account or PAT (Personal Access Token) with admin privileges
#   - GitHub OAuth App credentials (from https://github.com/settings/developers)
#   - Google OAuth 2.0 credentials (from https://console.cloud.google.com)
#
# Environment variables (required):
#   ZITADEL_DOMAIN          - Zitadel domain (e.g., auth.demo.example.com)
#   ZITADEL_PAT             - Personal Access Token for Zitadel admin API
#   GITHUB_CLIENT_ID        - GitHub OAuth App client ID
#   GITHUB_CLIENT_SECRET    - GitHub OAuth App client secret
#   GOOGLE_CLIENT_ID        - Google OAuth 2.0 client ID
#   GOOGLE_CLIENT_SECRET    - Google OAuth 2.0 client secret
#
# Usage:
#   export ZITADEL_DOMAIN="auth.demo.example.com"
#   export ZITADEL_PAT="your-personal-access-token"
#   export GITHUB_CLIENT_ID="your-github-client-id"
#   export GITHUB_CLIENT_SECRET="your-github-client-secret"
#   export GOOGLE_CLIENT_ID="your-google-client-id"
#   export GOOGLE_CLIENT_SECRET="your-google-client-secret"
#
#   ./deploy/zitadel/setup-oidc.sh
#
# How to get a Zitadel PAT:
#   1. Log into Zitadel Console at https://auth.demo.example.com/ui/console
#   2. Go to Users > Service Users > Create
#   3. Create a service user with Manager role
#   4. Go to the service user > Personal Access Tokens > New
#   5. Copy the token and set it as ZITADEL_PAT
#
# How to create a GitHub OAuth App:
#   1. Go to https://github.com/settings/developers
#   2. Click "New OAuth App"
#   3. Set Homepage URL: https://auth.demo.example.com
#   4. Set Callback URL: https://auth.demo.example.com/ui/login/login/externalidp/callback
#   5. Copy Client ID and Client Secret
#
# How to create Google OAuth 2.0 credentials:
#   1. Go to https://console.cloud.google.com/apis/credentials
#   2. Create OAuth 2.0 Client ID (Web application type)
#   3. Add authorized redirect URI: https://auth.demo.example.com/ui/login/login/externalidp/callback
#   4. Copy Client ID and Client Secret
#
# =============================================================================

set -euo pipefail

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
# Validate required environment variables
# ---------------------------------------------------------------------------
REQUIRED_VARS=(
    "ZITADEL_DOMAIN"
    "ZITADEL_PAT"
    "GITHUB_CLIENT_ID"
    "GITHUB_CLIENT_SECRET"
    "GOOGLE_CLIENT_ID"
    "GOOGLE_CLIENT_SECRET"
)

MISSING=0
for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var:-}" ]; then
        error "Required environment variable ${var} is not set."
        MISSING=1
    fi
done

if [ "${MISSING}" -eq 1 ]; then
    echo ""
    error "Set the missing variables and re-run the script. See usage instructions above."
    exit 1
fi

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
ZITADEL_API="https://${ZITADEL_DOMAIN}"
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
        curl -s -X "${method}" "${url}" \
            -H "${AUTH_HEADER}" \
            -H "${CONTENT_TYPE}" \
            -d "${data}"
    else
        curl -s -X "${method}" "${url}" \
            -H "${AUTH_HEADER}" \
            -H "${CONTENT_TYPE}"
    fi
}

# ---------------------------------------------------------------------------
# Step 1: Create GitHub Identity Provider
# ---------------------------------------------------------------------------
# GitHub IdP allows users to authenticate with their GitHub accounts.
# Zitadel acts as a broker: users click "Login with GitHub", authenticate
# at GitHub, and Zitadel creates/links a local account.
# ---------------------------------------------------------------------------
section "Creating GitHub Identity Provider..."

GITHUB_IDP_RESPONSE=$(zitadel_api POST "/management/v1/idps/github" "{
    \"name\": \"GitHub\",
    \"clientId\": \"${GITHUB_CLIENT_ID}\",
    \"clientSecret\": \"${GITHUB_CLIENT_SECRET}\",
    \"scopes\": [\"openid\", \"profile\", \"email\"],
    \"providerOptions\": {
        \"isLinkingAllowed\": true,
        \"isCreationAllowed\": true,
        \"isAutoCreation\": true,
        \"isAutoUpdate\": true,
        \"autoLinking\": \"AUTO_LINKING_OPTION_EMAIL\"
    }
}")

GITHUB_IDP_ID=$(echo "${GITHUB_IDP_RESPONSE}" | jq -r '.id // empty')
if [ -n "${GITHUB_IDP_ID}" ]; then
    info "GitHub IdP created with ID: ${GITHUB_IDP_ID}"
else
    warn "GitHub IdP creation response: ${GITHUB_IDP_RESPONSE}"
    warn "IdP may already exist. Continuing..."
fi

# ---------------------------------------------------------------------------
# Step 2: Create Google Identity Provider
# ---------------------------------------------------------------------------
# Google IdP allows users to authenticate with their Google accounts.
# Same brokering pattern as GitHub above.
# ---------------------------------------------------------------------------
section "Creating Google Identity Provider..."

GOOGLE_IDP_RESPONSE=$(zitadel_api POST "/management/v1/idps/google" "{
    \"name\": \"Google\",
    \"clientId\": \"${GOOGLE_CLIENT_ID}\",
    \"clientSecret\": \"${GOOGLE_CLIENT_SECRET}\",
    \"scopes\": [\"openid\", \"profile\", \"email\"],
    \"providerOptions\": {
        \"isLinkingAllowed\": true,
        \"isCreationAllowed\": true,
        \"isAutoCreation\": true,
        \"isAutoUpdate\": true,
        \"autoLinking\": \"AUTO_LINKING_OPTION_EMAIL\"
    }
}")

GOOGLE_IDP_ID=$(echo "${GOOGLE_IDP_RESPONSE}" | jq -r '.id // empty')
if [ -n "${GOOGLE_IDP_ID}" ]; then
    info "Google IdP created with ID: ${GOOGLE_IDP_ID}"
else
    warn "Google IdP creation response: ${GOOGLE_IDP_RESPONSE}"
    warn "IdP may already exist. Continuing..."
fi

# ---------------------------------------------------------------------------
# Step 3: Create OIDC Application for KCP Web Console
# ---------------------------------------------------------------------------
# This OIDC application is used by the KCP web console and any browser-based
# clients. It uses the Authorization Code flow with PKCE, which is the
# recommended flow for web applications.
#
# Key settings:
#   - responseTypes: CODE (authorization code flow)
#   - grantTypes: AUTHORIZATION_CODE, REFRESH_TOKEN
#   - authMethodType: NONE (public client with PKCE, no client secret)
#   - redirectUris: Where the browser is redirected after authentication
#   - postLogoutRedirectUris: Where the browser goes after logout
# ---------------------------------------------------------------------------
section "Creating OIDC Application for KCP Web Console..."

# First, we need the project. Create one if it doesn't exist.
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
    warn "Project creation response: ${PROJECT_RESPONSE}"
    warn "Project may already exist. Attempting to find it..."
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
    info "Found existing project with ID: ${PROJECT_ID}"
fi

# Create the Web OIDC Application (Authorization Code flow)
KCP_WEB_APP_RESPONSE=$(zitadel_api POST "/management/v1/projects/${PROJECT_ID}/apps/oidc" "{
    \"name\": \"KCP Web Console\",
    \"redirectUris\": [
        \"https://kcp.demo.example.com/callback\",
        \"https://console.demo.example.com/callback\"
    ],
    \"responseTypes\": [\"OIDC_RESPONSE_TYPE_CODE\"],
    \"grantTypes\": [
        \"OIDC_GRANT_TYPE_AUTHORIZATION_CODE\",
        \"OIDC_GRANT_TYPE_REFRESH_TOKEN\"
    ],
    \"appType\": \"OIDC_APP_TYPE_WEB\",
    \"authMethodType\": \"OIDC_AUTH_METHOD_TYPE_NONE\",
    \"postLogoutRedirectUris\": [
        \"https://kcp.demo.example.com\",
        \"https://console.demo.example.com\"
    ],
    \"devMode\": false,
    \"accessTokenType\": \"OIDC_TOKEN_TYPE_JWT\",
    \"idTokenRoleAssertion\": true,
    \"idTokenUserinfoAssertion\": true
}")

KCP_WEB_CLIENT_ID=$(echo "${KCP_WEB_APP_RESPONSE}" | jq -r '.clientId // empty')
if [ -n "${KCP_WEB_CLIENT_ID}" ]; then
    info "KCP Web Console OIDC app created."
    info "  Client ID: ${KCP_WEB_CLIENT_ID}"
else
    warn "Web app creation response: ${KCP_WEB_APP_RESPONSE}"
    warn "App may already exist. Continuing..."
fi

# ---------------------------------------------------------------------------
# Step 4: Create OIDC Application for KCP CLI
# ---------------------------------------------------------------------------
# This OIDC application is used by the KCP CLI (kubectl ws) and other
# non-browser clients. It uses the Device Authorization flow, which allows
# users to authenticate on a separate device (e.g., open a browser URL
# from a terminal prompt).
#
# Key settings:
#   - appType: NATIVE (no client secret, suitable for CLI tools)
#   - grantTypes: DEVICE_CODE (device authorization flow)
#   - responseTypes: CODE (still needed for the underlying OIDC flow)
# ---------------------------------------------------------------------------
section "Creating OIDC Application for KCP CLI..."

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
    \"devMode\": false,
    \"accessTokenType\": \"OIDC_TOKEN_TYPE_JWT\",
    \"idTokenRoleAssertion\": true,
    \"idTokenUserinfoAssertion\": true
}")

KCP_CLI_CLIENT_ID=$(echo "${KCP_CLI_APP_RESPONSE}" | jq -r '.clientId // empty')
if [ -n "${KCP_CLI_CLIENT_ID}" ]; then
    info "KCP CLI OIDC app created."
    info "  Client ID: ${KCP_CLI_CLIENT_ID}"
else
    warn "CLI app creation response: ${KCP_CLI_APP_RESPONSE}"
    warn "App may already exist. Continuing..."
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
section "Setup Complete!"
echo ""
info "Identity Providers:"
info "  GitHub IdP ID:     ${GITHUB_IDP_ID:-<already existed>}"
info "  Google IdP ID:     ${GOOGLE_IDP_ID:-<already existed>}"
echo ""
info "OIDC Applications:"
info "  KCP Web Client ID: ${KCP_WEB_CLIENT_ID:-<already existed>}"
info "  KCP CLI Client ID: ${KCP_CLI_CLIENT_ID:-<already existed>}"
echo ""
info "Next steps:"
info "  1. Update deploy/kcp/kcp-installation.yaml with the KCP Web Client ID"
info "     in the oidc.clientID field."
info "  2. Configure the KCP CLI plugin with the CLI Client ID:"
info "     kubectl kcp login --oidc-issuer=https://${ZITADEL_DOMAIN} --oidc-client-id=<CLI_CLIENT_ID>"
info "  3. Verify login works:"
info "     kubectl ws tree"
