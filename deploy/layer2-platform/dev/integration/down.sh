#!/usr/bin/env bash
# =============================================================================
# Layer 2 Integration Dev — Tear down platform from Layer 1 cluster
# =============================================================================
#
# Removes all Layer 2 components deployed by up.sh. Does NOT touch Layer 1
# infrastructure (VMs, Metal3, kube-ovn).
#
# Usage:
#   make dev-integration-down
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
PROD_DIR="${REPO_ROOT}/deploy/layer2-platform/prod"
WORKLOAD_KUBECONFIG="${WORKLOAD_KUBECONFIG:-.platform-data/workload-kubeconfig}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }

if [ ! -f "${WORKLOAD_KUBECONFIG}" ]; then
  warn "Workload kubeconfig not found at ${WORKLOAD_KUBECONFIG}. Nothing to tear down."
  exit 0
fi

if ! KUBECONFIG="${WORKLOAD_KUBECONFIG}" kubectl cluster-info &>/dev/null; then
  warn "Cannot reach workload cluster. It may already be down."
  exit 0
fi

export KUBECONFIG="${WORKLOAD_KUBECONFIG}"

info "Tearing down Layer 2 integration components..."

# Operators
info "Removing operators..."
kubectl delete -k "${PROD_DIR}/operators/" --ignore-not-found 2>/dev/null || true

# KCP installation
info "Removing KCP installation..."
kubectl delete -f "${PROD_DIR}/kcp/kcp-installation.yaml" --ignore-not-found 2>/dev/null || true

# kcp-operator
info "Removing kcp-operator..."
helm uninstall kcp-operator --namespace kcp-system 2>/dev/null || true
kubectl delete namespace kcp-system --ignore-not-found 2>/dev/null || true

# Zitadel
info "Removing Zitadel..."
helm uninstall zitadel --namespace zitadel 2>/dev/null || true

# PostgreSQL + secrets
info "Removing PostgreSQL and secrets..."
kubectl delete -f "${PROD_DIR}/zitadel/postgres.yaml" --ignore-not-found 2>/dev/null || true
kubectl delete secret postgres-credentials -n zitadel --ignore-not-found 2>/dev/null || true
kubectl delete secret zitadel-masterkey -n zitadel --ignore-not-found 2>/dev/null || true
# PVCs are not deleted automatically by StatefulSet deletion
kubectl delete pvc -n zitadel -l app.kubernetes.io/name=postgres --ignore-not-found 2>/dev/null || true

# Namespaces (last — waits for resources to drain)
info "Removing namespaces..."
kubectl delete namespace platform-operators --ignore-not-found 2>/dev/null || true
kubectl delete namespace platform --ignore-not-found 2>/dev/null || true
kubectl delete namespace zitadel --ignore-not-found 2>/dev/null || true

# Cleanup temp files
rm -f /tmp/kcp-admin.kubeconfig

info "Layer 2 integration teardown complete."
