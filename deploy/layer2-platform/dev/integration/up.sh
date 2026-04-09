#!/usr/bin/env bash
# =============================================================================
# Layer 2 Integration Dev — Deploy prod-like platform onto Layer 1 cluster
# =============================================================================
#
# Deploys KCP, Zitadel (Helm), operators, and platform APIs onto the workload
# cluster provisioned by Layer 1 (libvirt + Metal3). Uses the same manifests
# as production with dev-appropriate overrides (single replicas, dev domain,
# generated secrets).
#
# Prerequisites:
#   - Layer 1 cluster is up:  make layer1-dev-up
#   - Workload kubeconfig exists at .platform-data/workload-kubeconfig
#   - helm is installed locally
#   - kubectl is installed locally
#
# Usage:
#   make dev-integration-up
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../../../.." && pwd)"
PROD_DIR="${REPO_ROOT}/deploy/layer2-platform/prod"
WORKLOAD_KUBECONFIG="${WORKLOAD_KUBECONFIG:-.platform-data/libvirt/workload-kubeconfig}"

# Dev domain — uses nip.io with the workload cluster VIP for DNS resolution
# without /etc/hosts. Override with DEV_DOMAIN env var.
DEV_DOMAIN="${DEV_DOMAIN:-dev.local}"
DEV_KCP_DOMAIN="kcp.${DEV_DOMAIN}"
DEV_AUTH_DOMAIN="auth.${DEV_DOMAIN}"
DEV_CONSOLE_DOMAIN="console.${DEV_DOMAIN}"

# Dev passwords (deterministic for easy re-use)
DEV_POSTGRES_PASSWORD="${DEV_POSTGRES_PASSWORD:-dev-zitadel-password}"
DEV_ZITADEL_MASTERKEY="${DEV_ZITADEL_MASTERKEY:-$(openssl rand -hex 16 2>/dev/null || echo 'dev-masterkey-32bytes-exactly!!')}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ---- Pre-flight checks -----------------------------------------------------

if [ ! -f "${WORKLOAD_KUBECONFIG}" ]; then
  error "Workload kubeconfig not found at ${WORKLOAD_KUBECONFIG}"
  error "Run 'make layer1-dev-up' first, or set WORKLOAD_KUBECONFIG."
  exit 1
fi

if ! KUBECONFIG="${WORKLOAD_KUBECONFIG}" kubectl cluster-info &>/dev/null; then
  error "Cannot reach workload cluster. Is Layer 1 running?"
  exit 1
fi

export KUBECONFIG="${WORKLOAD_KUBECONFIG}"
info "Connected to workload cluster."

# ---- Step 1: Namespaces ----------------------------------------------------

info "Step 1/6: Creating namespaces..."
kubectl apply -f "${PROD_DIR}/zitadel/namespace.yaml"
kubectl apply -f "${PROD_DIR}/operators/namespace.yaml"
kubectl apply -f "${PROD_DIR}/console/namespace.yaml" 2>/dev/null || true

# ---- Step 2: PostgreSQL + Zitadel ------------------------------------------

info "Step 2/6: Deploying PostgreSQL..."

# Create postgres credentials secret (dev values)
kubectl apply -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: postgres-credentials
  namespace: zitadel
type: Opaque
stringData:
  POSTGRES_USER: "zitadel"
  POSTGRES_PASSWORD: "${DEV_POSTGRES_PASSWORD}"
  POSTGRES_DB: "zitadel"
EOF

kubectl apply -f "${PROD_DIR}/zitadel/postgres.yaml"

info "Waiting for PostgreSQL to be ready..."
kubectl -n zitadel rollout status statefulset/postgres --timeout=120s

# ---- Step 3: Zitadel (Helm) ------------------------------------------------

info "Step 3/6: Deploying Zitadel via Helm..."

# Create masterkey secret
kubectl create secret generic zitadel-masterkey \
  --namespace=zitadel \
  --from-literal=masterkey="${DEV_ZITADEL_MASTERKEY}" \
  --dry-run=client -o yaml | kubectl apply -f -

# Add Helm repo
helm repo add zitadel https://charts.zitadel.com 2>/dev/null || true
helm repo update zitadel

# Install with prod values + dev overrides
helm upgrade --install zitadel zitadel/zitadel \
  --namespace zitadel \
  --values "${PROD_DIR}/zitadel/helm-values.yaml" \
  --set replicaCount=1 \
  --set pdb.enabled=false \
  --set zitadel.configmapConfig.ExternalDomain="${DEV_AUTH_DOMAIN}" \
  --set zitadel.secretConfig.Database.Postgres.User.Password="${DEV_POSTGRES_PASSWORD}" \
  --set zitadel.secretConfig.Database.Postgres.Admin.Password="${DEV_POSTGRES_PASSWORD}" \
  --wait --timeout 300s

info "Zitadel deployed at ${DEV_AUTH_DOMAIN}"

# ---- Step 4: kcp-operator + KCP installation -------------------------------

info "Step 4/6: Deploying KCP..."

# Check if kcp-operator CRDs exist
if ! kubectl get crd rootshards.operator.kcp.io &>/dev/null; then
  warn "kcp-operator CRDs not found. Installing kcp-operator..."
  # The operator needs to be installed first. This is typically done via Helm
  # or direct manifest apply. For now, check if the user has it ready.
  if helm repo list 2>/dev/null | grep -q kcp; then
    helm upgrade --install kcp-operator kcp/kcp-operator \
      --namespace kcp-system --create-namespace \
      --wait --timeout 300s
  else
    warn "kcp Helm repo not configured. Trying to add it..."
    helm repo add kcp https://kcp-dev.github.io/helm-charts 2>/dev/null || true
    helm repo update kcp
    helm upgrade --install kcp-operator kcp/kcp-operator \
      --namespace kcp-system --create-namespace \
      --wait --timeout 300s
  fi
fi

# Apply KCP installation with dev overrides via sed
sed \
  -e "s|kcp.demo.example.com|${DEV_KCP_DOMAIN}|g" \
  -e "s|auth.demo.example.com|${DEV_AUTH_DOMAIN}|g" \
  -e "s|replicas: 2|replicas: 1|g" \
  "${PROD_DIR}/kcp/kcp-installation.yaml" | kubectl apply -f -

info "Waiting for KCP RootShard to become ready..."
for i in $(seq 1 60); do
  if kubectl get rootshard root -n kcp-system -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null | grep -q True; then
    info "KCP RootShard is ready."
    break
  fi
  if [ "$i" -eq 60 ]; then
    warn "Timed out waiting for KCP RootShard. Check: kubectl get rootshard root -n kcp-system -o yaml"
  fi
  sleep 10
done

# ---- Step 5: Platform workspace + APIs -------------------------------------

info "Step 5/6: Setting up platform workspace and APIs..."

# Extract KCP admin kubeconfig
KCP_KUBECONFIG=""
for i in $(seq 1 30); do
  if kubectl -n kcp-system get secret kcp-admin-kubeconfig -o jsonpath='{.data.kubeconfig}' 2>/dev/null | base64 -d > /tmp/kcp-admin.kubeconfig 2>/dev/null; then
    if [ -s /tmp/kcp-admin.kubeconfig ]; then
      KCP_KUBECONFIG="/tmp/kcp-admin.kubeconfig"
      break
    fi
  fi
  sleep 5
done

if [ -n "${KCP_KUBECONFIG}" ]; then
  info "KCP admin kubeconfig extracted."

  # Create platform workspace
  KUBECONFIG="${KCP_KUBECONFIG}" bash "${PROD_DIR}/kcp/setup-platform-workspace.sh" || true

  # Apply platform API schemas
  KUBECONFIG="${KCP_KUBECONFIG}" kubectl apply -k "${PROD_DIR}/platform-apis/" || true
else
  warn "Could not extract KCP admin kubeconfig. Skipping workspace/API setup."
  warn "Run manually once KCP is ready: make dev-integration-up"
fi

# ---- Step 6: Operators (optional — skip if images not built) ----------------

info "Step 6/6: Deploying operators..."

# Check if operator images are available before applying
if kubectl apply -k "${PROD_DIR}/operators/" --dry-run=client &>/dev/null 2>&1; then
  kubectl apply -k "${PROD_DIR}/operators/" || warn "Some operators failed to apply (images may not be available yet)."
else
  warn "Skipping operators — kustomize dry-run failed. Build and push operator images first."
fi

# ---- Summary ---------------------------------------------------------------

echo ""
info "============================================="
info "Layer 2 Integration Dev — Deployment Complete"
info "============================================="
info ""
info "  KCP API:     https://${DEV_KCP_DOMAIN}"
info "  Zitadel:     https://${DEV_AUTH_DOMAIN}"
info "  Console:     https://${DEV_CONSOLE_DOMAIN}"
info ""
info "  KCP admin kubeconfig:"
info "    kubectl get secret kcp-admin-kubeconfig -o jsonpath='{.data.kubeconfig}' | base64 -d"
info ""
info "  Zitadel OIDC setup (run once):"
info "    ZITADEL_DOMAIN=${DEV_AUTH_DOMAIN} bash ${PROD_DIR}/zitadel/setup-oidc.sh"
info ""
info "  To customize the dev domain:  DEV_DOMAIN=my.dev make dev-integration-up"
info "============================================="
