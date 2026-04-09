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
#   neo-worker-cpu — PXE booted by Ironic, provisioned with Ubuntu 24.04
#   neo-worker-gpu — PXE booted by Ironic, provisioned with Ubuntu 24.04
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

# Worker image — reuse Ubuntu cloud image (same as mgmt)
WORKER_IMG="${UBUNTU_IMG}"

# IPA (Ironic Python Agent) images are downloaded by the ipa-downloader
# init container in the Ironic pod — no need to download them here.

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
for worker in neo-worker-cpu neo-worker-cpu2 neo-worker-gpu; do
  WORKER_DISK="${NEO_DATADIR}/${worker}.qcow2"
  if [ ! -f "${WORKER_DISK}" ]; then
    qemu-img create -f qcow2 "${WORKER_DISK}" 20G
    info "  Created ${worker} disk."
  fi
done

# Define worker VMs (but don't start — Metal3 will power them on)
for worker in worker-cpu worker-cpu2 worker-gpu; do
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

# Check if the workload cluster is already running (rerun detection)
WORKLOAD_KUBECONFIG_TMP="${NEO_DATADIR}/workload-kubeconfig"
if kubectl get secret workload-cluster-kubeconfig -n metal3 -o jsonpath='{.data.value}' 2>/dev/null | base64 -d > "${WORKLOAD_KUBECONFIG_TMP}" 2>/dev/null; then
  if KUBECONFIG="${WORKLOAD_KUBECONFIG_TMP}" kubectl get nodes &>/dev/null; then
    info "Workload cluster already running — skipping Metal3/CAPI provisioning."
    SKIP_PROVISIONING=true
  fi
fi

if [ "${SKIP_PROVISIONING:-}" != "true" ]; then
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

  # Patch configmaps with our provisioning network IPs
  kubectl -n baremetal-operator-system patch configmap ironic --type merge -p \
    '{"data":{"IRONIC_ENDPOINT":"http://172.16.20.10:6385/v1/","PROVISIONING_INTERFACE":"ens4","DHCP_RANGE":"172.16.20.100,172.16.20.200","CACHEURL":"http://172.16.20.10:6180/images"}}'
  for cm in $(kubectl -n baremetal-operator-system get configmap -o name | grep ironic-bmo-configmap); do
    kubectl -n baremetal-operator-system patch "${cm}" --type merge -p \
      '{"data":{"IRONIC_IP":"172.16.20.10","IRONIC_BASE_URL":"http://172.16.20.10:6385","PROVISIONING_IP":"172.16.20.10","PROVISIONING_INTERFACE":"ens4","DHCP_RANGE":"172.16.20.100,172.16.20.200","DEPLOY_KERNEL_URL":"http://172.16.20.10:6180/images/ironic-python-agent.kernel","DEPLOY_RAMDISK_URL":"http://172.16.20.10:6180/images/ironic-python-agent.initramfs","IRONIC_ENDPOINT":"http://172.16.20.10:6385/v1/","IRONIC_FAST_TRACK":"true"}}'
  done

  # Restart deployments only if not already running
  IRONIC_READY=$(kubectl -n baremetal-operator-system get deployment baremetal-operator-ironic -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
  if [ "${IRONIC_READY}" = "0" ] || [ -z "${IRONIC_READY}" ]; then
    info "Restarting deployments to pick up configmaps..."
    kubectl -n baremetal-operator-system rollout restart deployment baremetal-operator-controller-manager
    kubectl -n baremetal-operator-system rollout restart deployment baremetal-operator-ironic
  fi
  kubectl -n baremetal-operator-system wait --for=condition=Available deployment --all --timeout=600s

  # Copy worker image into Ironic pod (serves from emptyDir /shared/html/images)
  info "Copying Ubuntu worker image into Ironic pod..."
  IRONIC_NS="baremetal-operator-system"

  info "  Waiting for Ironic pod to be ready (this may take a few minutes for IPA download)..."
  IRONIC_POD=""
  for i in $(seq 1 120); do
    IRONIC_POD=$(kubectl -n "${IRONIC_NS}" get pods -o name 2>/dev/null | grep baremetal-operator-ironic | head -1 | sed 's|pod/||' || true)
    if [ -n "${IRONIC_POD}" ]; then
      READY=$(kubectl -n "${IRONIC_NS}" get pod "${IRONIC_POD}" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)
      if [ "${READY}" = "True" ]; then
        info "  Ironic pod ${IRONIC_POD} is ready."
        break
      fi
    fi
    if [ $((i % 12)) -eq 0 ]; then
      info "  Still waiting... (${i}/120) — Debug: kubectl get pods -n ${IRONIC_NS}"
    fi
    if [ "${i}" -eq 120 ]; then
      warn "Timed out waiting for Ironic pod."
      exit 1
    fi
    sleep 5
  done

  # Only copy if image isn't already in the pod
  IMG_EXISTS=$(kubectl -n "${IRONIC_NS}" exec "${IRONIC_POD}" -c ironic-httpd -- test -f /shared/html/images/ubuntu-worker.img && echo "yes" || true)
  if [ "${IMG_EXISTS}" != "yes" ]; then
    kubectl -n "${IRONIC_NS}" exec "${IRONIC_POD}" -c ironic-httpd -- mkdir -p /shared/html/images
    kubectl cp "${WORKER_IMG}" "${IRONIC_NS}/${IRONIC_POD}:/shared/html/images/ubuntu-worker.img" -c ironic-httpd
    kubectl -n "${IRONIC_NS}" exec "${IRONIC_POD}" -c ironic-httpd -- \
      sh -c 'cd /shared/html/images && sha512sum ubuntu-worker.img > ubuntu-worker.img.sha512sum'
    info "  Ubuntu worker image copied into Ironic pod."
  else
    info "  Ubuntu worker image already in Ironic pod, skipping copy."
  fi

  info "  Verifying image HTTP access..."
  kubectl -n "${IRONIC_NS}" exec "${IRONIC_POD}" -c ironic-httpd -- ls -la /shared/html/images/

  # --- Step 7: Register BareMetalHosts ---
  kubectl create namespace metal3 --dry-run=client -o yaml | kubectl apply -f -
  info "Registering BareMetalHosts..."
  kubectl apply -f "${DEV_DIR}/metal3/baremetalhost-cpu.yaml"
  kubectl apply -f "${DEV_DIR}/metal3/baremetalhost-cpu2.yaml"
  kubectl apply -f "${DEV_DIR}/metal3/baremetalhost-gpu.yaml"

  info "Waiting for BareMetalHosts to be inspected..."
  for bmh in worker-cpu worker-cpu2 worker-gpu; do
    for i in $(seq 1 60); do
      STATE=$(kubectl -n metal3 get bmh "${bmh}" -o jsonpath='{.status.provisioning.state}' 2>/dev/null || echo "unknown")
      ERROR=$(kubectl -n metal3 get bmh "${bmh}" -o jsonpath='{.status.errorMessage}' 2>/dev/null)
      if [ "${STATE}" = "available" ] || [ "${STATE}" = "ready" ]; then
        info "  ${bmh}: ${STATE}"
        break
      fi
      if [ $((i % 6)) -eq 0 ]; then
        info "  ${bmh}: ${STATE} (waiting... ${i}/60)${ERROR:+ error: ${ERROR}}"
      fi
      sleep 10
    done
  done

  # --- Step 8: Create workload cluster via CAPI ---
  info "Creating workload cluster..."
  kubectl apply -f "${DEV_DIR}/capi/workload-cluster.yaml"
  kubectl apply -f "${DEV_DIR}/capi/cpu-workers.yaml"
  kubectl apply -f "${DEV_DIR}/capi/gpu-workers.yaml"
fi

info "Metal3 is now provisioning workers (PXE → Ubuntu)..."
info "Waiting for workload cluster control plane to be ready..."

# Wait for workload cluster kubeconfig secret to exist (means CP apiserver is up)
for i in $(seq 1 120); do
  if kubectl get secret workload-cluster-kubeconfig -n metal3 &>/dev/null; then
    # Verify we can actually reach the workload API
    WORKLOAD_KUBECONFIG_TMP=$(mktemp)
    kubectl get secret workload-cluster-kubeconfig -n metal3 -o jsonpath='{.data.value}' | base64 -d > "${WORKLOAD_KUBECONFIG_TMP}"
    if KUBECONFIG="${WORKLOAD_KUBECONFIG_TMP}" kubectl get nodes &>/dev/null; then
      rm -f "${WORKLOAD_KUBECONFIG_TMP}"
      info "  Control plane is ready and API is reachable."
      break
    fi
    rm -f "${WORKLOAD_KUBECONFIG_TMP}"
  fi
  if [ $((i % 12)) -eq 0 ]; then
    info "  Still waiting for control plane... (${i}/120)"
    kubectl get machines -n metal3 2>/dev/null || true
  fi
  if [ "${i}" -eq 120 ]; then
    warn "Timed out waiting for control plane. Check: kubectl get machines -n metal3"
    exit 1
  fi
  sleep 10
done

# --- Step 9: Install kube-ovn CNI on workload cluster ---
info "Extracting workload cluster kubeconfig..."
WORKLOAD_KUBECONFIG="${NEO_DATADIR}/workload-kubeconfig"
kubectl get secret workload-cluster-kubeconfig -n metal3 -o jsonpath='{.data.value}' | base64 -d > "${WORKLOAD_KUBECONFIG}"

info "Labeling control plane node for kube-ovn..."
KUBECONFIG="${WORKLOAD_KUBECONFIG}" kubectl label node worker-cpu kube-ovn/role=master --overwrite || true

info "Installing kube-ovn CNI on workload cluster..."
helm repo add kube-ovn https://kubeovn.github.io/kube-ovn 2>/dev/null || true
helm repo update kube-ovn
helm upgrade --install kube-ovn kube-ovn/kube-ovn \
  --namespace kube-system \
  --kubeconfig "${WORKLOAD_KUBECONFIG}" \
  --values "${DEV_DIR}/kube-ovn/values.yaml" \
  --wait --timeout 300s

info "Waiting for workload cluster nodes to be Ready..."
for i in $(seq 1 60); do
  NOT_READY=$(KUBECONFIG="${WORKLOAD_KUBECONFIG}" kubectl get nodes --no-headers 2>/dev/null | grep -c "NotReady" || true)
  if [ "${NOT_READY}" = "0" ]; then
    info "  All workload cluster nodes are Ready."
    break
  fi
  if [ $((i % 6)) -eq 0 ]; then
    info "  Waiting for nodes... (${i}/60)"
    KUBECONFIG="${WORKLOAD_KUBECONFIG}" kubectl get nodes 2>/dev/null || true
  fi
  if [ "${i}" -eq 60 ]; then
    warn "Some nodes are still NotReady. Check: KUBECONFIG=${WORKLOAD_KUBECONFIG} kubectl get nodes"
  fi
  sleep 10
done

info ""
info "Layer 1 dev environment is ready!"
info "Workload cluster kubeconfig: ${WORKLOAD_KUBECONFIG}"
info "Use this kubeconfig for Layer 2+ on any machine (including macOS)."
