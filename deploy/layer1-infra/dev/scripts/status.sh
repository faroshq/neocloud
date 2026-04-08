#!/bin/bash
set -euo pipefail

# Layer 1 Dev: Report status of libvirt VMs, Metal3, and cluster
# Requires Linux host with libvirt.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="${SCRIPT_DIR}/../../../.."
KUBECONFIG="${REPO_ROOT}/.platform-data/workload-kubeconfig"
VIRSH="virsh --connect qemu:///system"

echo "=== Libvirt VMs ==="
for vm in neo-mgmt neo-worker-cpu neo-worker-gpu; do
  STATE=$(${VIRSH} domstate "${vm}" 2>/dev/null || echo "not defined")
  echo "  ${vm}: ${STATE}"
done

echo ""
echo "=== Libvirt Networks ==="
for net in default neo-provisioning neo-baremetal; do
  ACTIVE=$(${VIRSH} net-info "${net}" 2>/dev/null | grep Active | awk '{print $2}' || echo "not defined")
  echo "  ${net}: ${ACTIVE}"
done

echo ""
echo "=== sushy-tools ==="
if pgrep -f sushy-emulator &>/dev/null; then
  echo "  Running (PID $(pgrep -f sushy-emulator))"
else
  echo "  Not running"
fi

if [ ! -f "${KUBECONFIG}" ]; then
  echo ""
  echo "=== No kubeconfig found. Run 'make layer1-dev-kubeconfig' ==="
  exit 0
fi

echo ""
echo "=== Management Cluster Nodes ==="
KUBECONFIG="${KUBECONFIG}" kubectl get nodes -o wide 2>/dev/null || echo "  (not reachable)"

echo ""
echo "=== BareMetalHosts ==="
KUBECONFIG="${KUBECONFIG}" kubectl -n metal3 get baremetalhost 2>/dev/null || echo "  (none)"

echo ""
echo "=== CAPI Clusters ==="
KUBECONFIG="${KUBECONFIG}" kubectl -n metal3 get cluster 2>/dev/null || echo "  (none)"

echo ""
echo "=== Machines ==="
KUBECONFIG="${KUBECONFIG}" kubectl -n metal3 get machines 2>/dev/null || echo "  (none)"
