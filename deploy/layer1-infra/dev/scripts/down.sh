#!/bin/bash
set -euo pipefail

# Layer 1 Dev: Tear down all 3 Lima VMs

info() { echo "==> $*"; }

for vm in neo-mgmt neo-cpu neo-gpu; do
  if limactl list -q 2>/dev/null | grep -q "^${vm}$"; then
    info "Stopping and deleting '${vm}'..."
    limactl stop "${vm}" 2>/dev/null || true
    limactl delete "${vm}" 2>/dev/null || true
  fi
done

rm -f .platform-data/workload-kubeconfig
info "Layer 1 dev environment torn down."
