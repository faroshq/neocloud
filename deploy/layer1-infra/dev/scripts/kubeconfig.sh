#!/bin/bash
set -euo pipefail

# Layer 1 Dev: Extract kubeconfig from management node

MGMT_VM="neo-mgmt"
KUBECONFIG_PATH=".platform-data/workload-kubeconfig"

echo "==> Fetching kubeconfig from ${MGMT_VM}..."
mkdir -p "$(dirname "${KUBECONFIG_PATH}")"
limactl shell "${MGMT_VM}" sudo cat /root/kubeconfig-external > "${KUBECONFIG_PATH}"
echo "==> Kubeconfig written to ${KUBECONFIG_PATH}"
