#!/bin/bash
set -euo pipefail

# Layer 1 Dev: Metal3 with libvirt
#
# *** Requires a Linux host with KVM ***
# Layer 1 handles bare metal → Kubernetes provisioning.
# The output is a kubeconfig — the boundary for Layer 2+.
#
# Creates 3 VMs via libvirt:
#   neo-mgmt      — management cluster (k3s + Metal3 + Ironic)
#   neo-worker-cpu — PXE booted by Ironic, provisioned with Flatcar
#   neo-worker-gpu — PXE booted by Ironic, provisioned with Flatcar
#
# Prerequisites (Linux):
#   sudo apt install libvirt-daemon-system qemu-kvm virtinst genisoimage pipx
#   pipx install sushy-tools
#   curl -L https://github.com/kubernetes-sigs/cluster-api/releases/latest/download/clusterctl-linux-amd64 -o /usr/local/bin/clusterctl && chmod +x /usr/local/bin/clusterctl

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DEV_DIR="${SCRIPT_DIR}/.."
REPO_ROOT="${DEV_DIR}/../../.."
NEO_DATADIR="${REPO_ROOT}/.platform-data/libvirt"
KUBEVIRT_VERSION="${KUBEVIRT_VERSION:-v1.8.1}"
BMO_VERSION="${BMO_VERSION:-v0.12.3}"
FLATCAR_CHANNEL="${FLATCAR_CHANNEL:-stable}"
FLATCAR_VERSION="${FLATCAR_VERSION:-current}"

VIRSH="virsh --connect qemu:///system"

info() { echo "==> $*"; }
warn() { echo "==> WARNING: $*"; }

# --- Platform check ---
if [ "$(uname)" != "Linux" ]; then
  echo "ERROR: Layer 1 dev requires a Linux host with KVM."
  echo "       Layer 1 produces a kubeconfig — use it from any OS for Layer 2+."
  exit 1
fi

# --- Preflight checks ---
for cmd in virsh qemu-img genisoimage sushy-emulator clusterctl sshpass; do
  if ! command -v "${cmd}" &>/dev/null; then
    echo "ERROR: '${cmd}' not found. Install prerequisites:"
    echo "  sudo apt install libvirt-daemon-system qemu-kvm virtinst genisoimage pipx sshpass ovmf libvirt-dev pkg-config python3-dev"
    echo "  pipx install sushy-tools && pipx inject sushy-tools libvirt-python"
    echo "  curl -L https://github.com/kubernetes-sigs/cluster-api/releases/latest/download/clusterctl-linux-amd64 -o /usr/local/bin/clusterctl && chmod +x /usr/local/bin/clusterctl"
    exit 1
  fi
done

mkdir -p "${NEO_DATADIR}"

# --- Step 1: Create libvirt networks ---
info "Setting up libvirt networks..."
for net in neo-provisioning neo-baremetal; do
  net_file="${net#neo-}"

  if ! ${VIRSH} net-info "${net}" &>/dev/null; then
    ${VIRSH} net-define "${DEV_DIR}/libvirt/networks/${net_file}.xml"
    info "  Defined network '${net}'."
  fi

  ACTIVE=$(${VIRSH} net-info "${net}" 2>/dev/null | grep "^Active:" | awk '{print $2}')
  if [ "${ACTIVE}" != "yes" ]; then
    ${VIRSH} net-start "${net}"
    info "  Started network '${net}'."
  else
    info "  Network '${net}' already active."
  fi

  ${VIRSH} net-autostart "${net}" 2>/dev/null || true
done

# Ensure default network is active (ships with libvirt on Linux)
ACTIVE=$(${VIRSH} net-info default 2>/dev/null | grep "^Active:" | awk '{print $2}' || echo "no")
if [ "${ACTIVE}" != "yes" ]; then
  ${VIRSH} net-start default 2>/dev/null || true
fi

# --- Step 2: Download images ---
info "Checking images..."

# Ubuntu cloud image for mgmt VM
UBUNTU_IMG="${NEO_DATADIR}/ubuntu-24.04-cloudimg-amd64.img"
if [ ! -f "${UBUNTU_IMG}" ]; then
  info "  Downloading Ubuntu 24.04 cloud image..."
  curl -L -o "${UBUNTU_IMG}" \
    "https://cloud-images.ubuntu.com/releases/24.04/release/ubuntu-24.04-server-cloudimg-amd64.img"
fi

# Flatcar image for workers (served by Ironic)
FLATCAR_IMG="${NEO_DATADIR}/flatcar_production_qemu_image.img"
if [ ! -f "${FLATCAR_IMG}" ]; then
  info "  Downloading Flatcar Container Linux..."
  curl -L -o "${FLATCAR_IMG}.bz2" \
    "https://${FLATCAR_CHANNEL}.release.flatcar-linux.net/amd64-usr/${FLATCAR_VERSION}/flatcar_production_qemu_image.img.bz2"
  bunzip2 "${FLATCAR_IMG}.bz2"
fi

# IPA (Ironic Python Agent) kernel + ramdisk
IPA_KERNEL="${NEO_DATADIR}/ironic-python-agent.kernel"
IPA_RAMDISK="${NEO_DATADIR}/ironic-python-agent.initramfs"
if [ ! -f "${IPA_KERNEL}" ]; then
  info "  Downloading IPA kernel..."
  curl -L -o "${IPA_KERNEL}" \
    "https://tarballs.opendev.org/openstack/ironic-python-agent/dib/files/ipa-centos9-master.kernel"
fi
if [ ! -f "${IPA_RAMDISK}" ]; then
  info "  Downloading IPA ramdisk..."
  curl -L -o "${IPA_RAMDISK}" \
    "https://tarballs.opendev.org/openstack/ironic-python-agent/dib/files/ipa-centos9-master.initramfs"
fi

# --- Step 3: Create management VM ---
info "Creating management VM..."
MGMT_DISK="${NEO_DATADIR}/neo-mgmt.qcow2"
MGMT_CIDATA="${NEO_DATADIR}/neo-mgmt-cidata.iso"

if ${VIRSH} dominfo neo-mgmt &>/dev/null; then
  info "  VM 'neo-mgmt' already exists."
else
  # Create disk from cloud image
  cp "${UBUNTU_IMG}" "${MGMT_DISK}"
  qemu-img resize "${MGMT_DISK}" 40G

  # Create cloud-init ISO
  genisoimage -output "${MGMT_CIDATA}" -volid cidata -joliet -rock \
    "${DEV_DIR}/libvirt/cloud-init/user-data" \
    "${DEV_DIR}/libvirt/cloud-init/meta-data"

  # Update domain XML with actual paths and define
  sed "s|NEO_DATADIR|${NEO_DATADIR}|g" "${DEV_DIR}/libvirt/domains/mgmt.xml" | \
    ${VIRSH} define /dev/stdin
  ${VIRSH} start neo-mgmt
  info "  Management VM created and started."
fi

# Wait for mgmt to be ready
info "Waiting for management VM (cloud-init + k3s)..."
for i in $(seq 1 180); do
  if ${VIRSH} qemu-agent-command neo-mgmt '{"execute":"guest-exec","arguments":{"path":"/bin/test","arg":["-f","/root/.mgmt-ready"],"capture-output":true}}' &>/dev/null; then
    info "  Management VM is ready."
    break
  fi
  if [ "${i}" -eq 180 ]; then
    warn "Timed out waiting for management VM. Check: virsh console neo-mgmt"
    exit 1
  fi
  sleep 5
done

# --- Step 4: Create worker VM disks ---
info "Creating worker VM disks..."
for worker in neo-worker-cpu neo-worker-gpu; do
  WORKER_DISK="${NEO_DATADIR}/${worker}.qcow2"
  if [ ! -f "${WORKER_DISK}" ]; then
    qemu-img create -f qcow2 "${WORKER_DISK}" 20G
    info "  Created ${worker} disk."
  fi
done

# Define worker VMs (but don't start — Metal3 will power them on)
for worker in worker-cpu worker-gpu; do
  if ${VIRSH} dominfo "neo-${worker}" &>/dev/null; then
    info "  VM 'neo-${worker}' already defined."
  else
    sed "s|NEO_DATADIR|${NEO_DATADIR}|g" "${DEV_DIR}/libvirt/domains/${worker}.xml" | \
      ${VIRSH} define /dev/stdin
    info "  Defined VM 'neo-${worker}' (powered off, waiting for Metal3)."
  fi
done

# Ensure OVMF symlinks exist (Ubuntu 24.04 ships 4M variants only)
for f in OVMF_VARS OVMF_CODE; do
  [ -f "/usr/share/OVMF/${f}.fd" ] || ln -sf "/usr/share/OVMF/${f}_4M.fd" "/usr/share/OVMF/${f}.fd"
done
[ -f /usr/share/OVMF/OVMF_CODE.secboot.fd ] || ln -sf /usr/share/OVMF/OVMF_CODE_4M.secboot.fd /usr/share/OVMF/OVMF_CODE.secboot.fd

# --- Step 5: Start sushy-tools ---
info "Starting sushy-tools (virtual Redfish BMC)..."
if pgrep -f sushy-emulator &>/dev/null; then
  info "  sushy-emulator already running."
else
  sushy-emulator --libvirt-uri "qemu:///system" \
    -i 172.16.20.1 -p 8000 &
  SUSHY_PID=$!
  echo "${SUSHY_PID}" > "${NEO_DATADIR}/sushy-emulator.pid"
  info "  sushy-emulator started (PID ${SUSHY_PID}) on 172.16.20.1:8000"
fi

# --- Step 6: Install Metal3 on management cluster ---
info "Getting kubeconfig from management VM..."
"${SCRIPT_DIR}/kubeconfig.sh"
export KUBECONFIG="${REPO_ROOT}/.platform-data/workload-kubeconfig"

info "Installing cert-manager..."
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml
kubectl -n cert-manager wait --for=condition=Available deployment --all --timeout=300s

info "Installing Cluster API + Metal3 provider..."
clusterctl init --infrastructure metal3

info "Installing Bare Metal Operator ${BMO_VERSION}..."
kubectl apply -f "https://github.com/metal3-io/baremetal-operator/releases/download/${BMO_VERSION}/baremetal-operator.yaml"
kubectl -n baremetal-operator-system wait --for=condition=Available deployment --all --timeout=300s

info "Deploying Ironic..."
kubectl apply -k "${DEV_DIR}/metal3/ironic"
kubectl -n baremetal-operator-system wait --for=condition=Available deployment --all --timeout=300s

# Copy images to mgmt VM for Ironic to serve via HTTP
info "Copying Flatcar + IPA images to mgmt VM for Ironic HTTP server..."
MGMT_IP=$(${VIRSH} domifaddr neo-mgmt --source agent 2>/dev/null | grep -oE '172\.16\.30\.[0-9]+' | head -1)
if [ -z "${MGMT_IP}" ]; then
  MGMT_IP=$(${VIRSH} domifaddr neo-mgmt 2>/dev/null | grep -oE '192\.168\.[0-9]+\.[0-9]+' | head -1)
fi

SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"
sshpass -p neo ssh ${SSH_OPTS} "neo@${MGMT_IP}" "sudo mkdir -p /shared/html/images" 2>/dev/null
sshpass -p neo scp ${SSH_OPTS} "${IPA_KERNEL}" "neo@${MGMT_IP}:/tmp/ironic-python-agent.kernel" 2>/dev/null
sshpass -p neo scp ${SSH_OPTS} "${IPA_RAMDISK}" "neo@${MGMT_IP}:/tmp/ironic-python-agent.initramfs" 2>/dev/null
sshpass -p neo scp ${SSH_OPTS} "${FLATCAR_IMG}" "neo@${MGMT_IP}:/tmp/flatcar.img" 2>/dev/null
sshpass -p neo ssh ${SSH_OPTS} "neo@${MGMT_IP}" "sudo mv /tmp/ironic-python-agent.kernel /tmp/ironic-python-agent.initramfs /tmp/flatcar.img /shared/html/images/" 2>/dev/null
info "  Images copied to mgmt VM."

# --- Step 7: Register BareMetalHosts ---
info "Registering BareMetalHosts..."
kubectl apply -f "${DEV_DIR}/metal3/baremetalhost-cpu.yaml"
kubectl apply -f "${DEV_DIR}/metal3/baremetalhost-gpu.yaml"

info "Waiting for BareMetalHosts to be inspected..."
for bmh in worker-cpu worker-gpu; do
  for i in $(seq 1 60); do
    STATE=$(kubectl -n metal3 get bmh "${bmh}" -o jsonpath='{.status.provisioning.state}' 2>/dev/null || echo "unknown")
    if [ "${STATE}" = "available" ] || [ "${STATE}" = "ready" ]; then
      info "  ${bmh}: ${STATE}"
      break
    fi
    sleep 10
  done
done

# --- Step 8: Create workload cluster via CAPI ---
info "Creating workload cluster..."
kubectl apply -f "${DEV_DIR}/capi/workload-cluster.yaml"
kubectl apply -f "${DEV_DIR}/capi/cpu-workers.yaml"
kubectl apply -f "${DEV_DIR}/capi/gpu-workers.yaml"

info "Metal3 is now provisioning workers (PXE → Flatcar)..."
info "This takes several minutes. Run 'make layer1-dev-status' to monitor."
info ""
info "Once workers are ready, the kubeconfig is your Layer 1 output."
info "Run 'make layer1-dev-kubeconfig' to extract it."
info "Use this kubeconfig for Layer 2+ on any machine (including macOS)."
