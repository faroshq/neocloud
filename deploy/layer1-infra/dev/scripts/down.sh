#!/bin/bash
set -euo pipefail

# Layer 1 Dev: Tear down all libvirt VMs and networks
# Requires Linux host.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="${SCRIPT_DIR}/../../../.."
NEO_DATADIR="${REPO_ROOT}/.platform-data/libvirt"
VIRSH="virsh --connect qemu:///system"

info() { echo "==> $*"; }

# Stop sushy-tools
if [ -f "${NEO_DATADIR}/sushy-emulator.pid" ]; then
  PID=$(cat "${NEO_DATADIR}/sushy-emulator.pid")
  kill "${PID}" 2>/dev/null || true
  rm -f "${NEO_DATADIR}/sushy-emulator.pid"
  info "Stopped sushy-emulator."
fi

# Destroy and undefine VMs
for vm in neo-mgmt neo-worker-cpu neo-worker-gpu; do
  if ${VIRSH} dominfo "${vm}" &>/dev/null; then
    ${VIRSH} destroy "${vm}" 2>/dev/null || true
    ${VIRSH} undefine "${vm}" --remove-all-storage 2>/dev/null || true
    info "Removed VM '${vm}'."
  fi
done

# Remove networks
for net in neo-provisioning neo-baremetal; do
  if ${VIRSH} net-info "${net}" &>/dev/null; then
    ${VIRSH} net-destroy "${net}" 2>/dev/null || true
    ${VIRSH} net-undefine "${net}" 2>/dev/null || true
    info "Removed network '${net}'."
  fi
done

# Clean up data directory (keep downloaded images)
rm -f "${NEO_DATADIR}/neo-mgmt.qcow2"
rm -f "${NEO_DATADIR}/neo-mgmt-cidata.iso"
rm -f "${NEO_DATADIR}/neo-worker-cpu.qcow2"
rm -f "${NEO_DATADIR}/neo-worker-gpu.qcow2"
rm -f "${REPO_ROOT}/.platform-data/workload-kubeconfig"

info "Layer 1 dev environment torn down."
info "Downloaded images preserved in ${NEO_DATADIR}/ (run 'rm -rf ${NEO_DATADIR}' to remove)."
