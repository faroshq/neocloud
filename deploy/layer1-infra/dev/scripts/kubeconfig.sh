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
sshpass -p neo scp ${SSH_OPTS} \
  "neo@${MGMT_IP}:/root/kubeconfig-external" "${KUBECONFIG_PATH}" 2>/dev/null || \
  sshpass -p neo ssh ${SSH_OPTS} \
    "neo@${MGMT_IP}" "sudo cat /root/kubeconfig-external" > "${KUBECONFIG_PATH}"

echo "==> Kubeconfig written to ${KUBECONFIG_PATH}"
echo "    This is the Layer 1 output — use it for Layer 2+ on any machine."
