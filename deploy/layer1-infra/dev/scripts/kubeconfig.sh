#!/bin/bash
set -euo pipefail

# Layer 1 Dev: Extract kubeconfig from management VM
# Requires Linux host with libvirt.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="${SCRIPT_DIR}/../../../.."
KUBECONFIG_PATH="${REPO_ROOT}/.platform-data/workload-kubeconfig"
VIRSH="virsh --connect qemu:///system"

echo "==> Extracting kubeconfig from neo-mgmt..."
mkdir -p "$(dirname "${KUBECONFIG_PATH}")"

# Get mgmt VM IP on the baremetal network
MGMT_IP=$(${VIRSH} domifaddr neo-mgmt --source agent 2>/dev/null | grep -oE '172\.16\.30\.[0-9]+' | head -1)

if [ -z "${MGMT_IP}" ]; then
  # Fallback: use the default network IP
  MGMT_IP=$(${VIRSH} domifaddr neo-mgmt 2>/dev/null | grep -oE '192\.168\.[0-9]+\.[0-9]+' | head -1)
fi

if [ -z "${MGMT_IP}" ]; then
  echo "ERROR: Could not determine neo-mgmt IP. Is the VM running?"
  exit 1
fi

SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

# Retry — kubeconfig may not exist yet if cloud-init is still running
for i in $(seq 1 30); do
  if sshpass -p neo ssh ${SSH_OPTS} "neo@${MGMT_IP}" "sudo test -f /root/kubeconfig-external" 2>/dev/null; then
    sshpass -p neo ssh ${SSH_OPTS} "neo@${MGMT_IP}" "sudo cat /root/kubeconfig-external" > "${KUBECONFIG_PATH}" 2>/dev/null
    echo "==> Kubeconfig written to ${KUBECONFIG_PATH}"
    echo "    This is the Layer 1 output — use it for Layer 2+ on any machine."
    exit 0
  fi
  if [ $((i % 6)) -eq 0 ]; then
    echo "==>   Waiting for kubeconfig (${i}/30)... cloud-init may still be running."
  fi
  sleep 5
done

echo "ERROR: Timed out waiting for kubeconfig. Check: virsh console neo-mgmt"
exit 1
