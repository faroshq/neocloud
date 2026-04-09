#!/usr/bin/env bash
# =============================================================================
# Setup Platform & Provider Workspaces in KCP
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
#   ./deploy/layer2-platform/prod/kcp/setup-platform-workspace.sh
#
# What it does:
#   1. Creates the "providers" workspace under root (for API providers)
#   2. Creates per-provider child workspaces (compute, networking, storage, ai)
#   3. Creates the "platform" workspace under root (for tenant management)
#   4. Creates the "tenants" workspace under platform
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

# Ensure krew bin is in PATH
export PATH="${KREW_ROOT:-$HOME/.krew}/bin:$PATH"

if ! kubectl ws --help &>/dev/null 2>&1; then
    error "kubectl-ws plugin is not installed."
    error "Install it with: kubectl krew install ws"
    exit 1
fi

if [ -z "${KUBECONFIG:-}" ]; then
    warn "KUBECONFIG is not set. Using default kubeconfig location."
fi

# ---------------------------------------------------------------------------
# Step 1: Create the providers workspace hierarchy
# ---------------------------------------------------------------------------
info "Navigating to root workspace..."
kubectl ws root

info "Creating providers workspace (type: universal)..."
if kubectl ws create providers --type=universal --ignore-existing; then
    info "Providers workspace created successfully (or already exists)."
else
    error "Failed to create providers workspace."
    exit 1
fi

# Create per-provider child workspaces
info "Entering providers workspace..."
kubectl ws use providers

PROVIDERS=("compute" "networking" "storage" "ai")
for provider in "${PROVIDERS[@]}"; do
    info "Creating ${provider} workspace (type: universal)..."
    if kubectl ws create "${provider}" --type=universal --ignore-existing; then
        info "  ${provider} workspace created successfully (or already exists)."
    else
        error "Failed to create ${provider} workspace."
        exit 1
    fi
done

# ---------------------------------------------------------------------------
# Step 2: Create the platform workspace hierarchy
# ---------------------------------------------------------------------------
info "Navigating to root workspace..."
kubectl ws root

info "Creating platform workspace (type: universal)..."
if kubectl ws create platform --type=universal --ignore-existing; then
    info "Platform workspace created successfully (or already exists)."
else
    error "Failed to create platform workspace."
    exit 1
fi

info "Entering platform workspace..."
kubectl ws use platform

info "Creating tenants workspace (type: universal)..."
if kubectl ws create tenants --type=universal --ignore-existing; then
    info "Tenants workspace created successfully (or already exists)."
else
    error "Failed to create tenants workspace."
    exit 1
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
info ""
info "Workspace hierarchy is ready:"
info "  root"
info "  ├── providers"
info "  │   ├── compute      (APIExport: compute.cloud.platform)"
info "  │   ├── networking   (APIExport: network.cloud.platform)"
info "  │   ├── storage      (APIExport: storage.cloud.platform)"
info "  │   └── ai           (APIExport: ai.cloud.platform)"
info "  └── platform"
info "      └── tenants      (tenant workspaces)"
info ""
info "Next steps:"
info "  1. Deploy platform controller (handles CRD install, APIExport bootstrap)"
info "  2. Create tenant workspaces (auto-binds all providers)"
