#!/usr/bin/env bash
# =============================================================================
# Setup Platform Workspace in KCP
# =============================================================================
#
# This script creates the platform workspace hierarchy in a running KCP
# instance. It is idempotent -- running it multiple times is safe.
#
# Prerequisites:
#   1. KCP is deployed and healthy (see deploy/kcp/kcp-installation.yaml)
#   2. The `kubectl ws` plugin is installed:
#        go install github.com/kcp-dev/kcp/cli/cmd/kubectl-ws@latest
#   3. KUBECONFIG is set to the KCP admin kubeconfig:
#        export KUBECONFIG=/path/to/kcp-admin.kubeconfig
#
# Usage:
#   ./deploy/kcp/setup-platform-workspace.sh
#
# What it does:
#   1. Navigates to the root workspace
#   2. Creates the "platform" workspace with type "universal"
#   3. Enters the platform workspace and prints confirmation
#
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Color output helpers
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ---------------------------------------------------------------------------
# Pre-flight checks
# ---------------------------------------------------------------------------
if ! command -v kubectl &>/dev/null; then
    error "kubectl is not installed or not in PATH."
    exit 1
fi

if ! kubectl ws --help &>/dev/null 2>&1; then
    error "kubectl-ws plugin is not installed."
    error "Install it with: go install github.com/kcp-dev/kcp/cli/cmd/kubectl-ws@latest"
    exit 1
fi

if [ -z "${KUBECONFIG:-}" ]; then
    warn "KUBECONFIG is not set. Using default kubeconfig location."
fi

# ---------------------------------------------------------------------------
# Step 1: Navigate to root workspace
# ---------------------------------------------------------------------------
info "Navigating to root workspace..."
kubectl ws root

# ---------------------------------------------------------------------------
# Step 2: Create the platform workspace
# ---------------------------------------------------------------------------
# The "platform" workspace is the top-level organizational workspace for all
# platform resources. Type "universal" provides:
#   - Ability to host APIExports (API provider capabilities)
#   - Ability to create child workspaces (for tenants, teams, etc.)
#   - Full RBAC and quota support
#
# --ignore-existing ensures idempotency: if the workspace already exists,
# the command succeeds without error.
# ---------------------------------------------------------------------------
info "Creating platform workspace (type: universal)..."
if kubectl ws create platform --type=universal --ignore-existing; then
    info "Platform workspace created successfully (or already exists)."
else
    error "Failed to create platform workspace."
    exit 1
fi

# ---------------------------------------------------------------------------
# Step 3: Enter the platform workspace and verify
# ---------------------------------------------------------------------------
info "Entering platform workspace..."
kubectl ws use platform

info "Current workspace:"
kubectl ws current

info ""
info "Platform workspace is ready."
info "You can now deploy platform-level resources (APIExports, operators, etc.)"
info ""
info "Next steps:"
info "  1. Deploy platform APIs:    kubectl apply -f deploy/platform-apis/"
info "  2. Configure quotas:        kubectl apply -f deploy/quota/"
info "  3. Set up onboarding:       kubectl apply -f deploy/onboarding/"
