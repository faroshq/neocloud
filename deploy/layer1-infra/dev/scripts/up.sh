#!/bin/bash
set -euo pipefail

# Layer 1 Dev: Create 3-node cluster with Lima (mgmt + cpu-worker + gpu-worker)
#
# Workers connect to mgmt via Lima's host gateway IP (192.168.5.2) on the
# forwarded port 16443. No socket_vmnet or shared networks required.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIMA_DIR="${SCRIPT_DIR}/../lima"
DEV_DIR="${SCRIPT_DIR}/.."
KUBEVIRT_VERSION="${KUBEVIRT_VERSION:-v1.8.1}"

MGMT_VM="neo-mgmt"
CPU_VM="neo-cpu"
GPU_VM="neo-gpu"

# Lima host gateway IP (accessible from inside any Lima VM)
HOST_GW="192.168.5.2"
HOST_K3S_PORT="16443"

info() { echo "==> $*"; }

# --- Helper: create and start a Lima VM ---
ensure_vm() {
  local name="$1" config="$2"
  if limactl list -q 2>/dev/null | grep -q "^${name}$"; then
    info "VM '${name}' already exists, skipping creation."
  else
    info "Creating VM '${name}'..."
    limactl create --name="${name}" "${config}"
  fi
  if ! limactl list 2>/dev/null | grep "${name}" | grep -q Running; then
    info "Starting VM '${name}'..."
    limactl start "${name}"
  fi
}

# --- Helper: join a worker to the mgmt k3s ---
join_worker() {
  local name="$1" token="$2"
  info "Joining '${name}' to k3s cluster via ${HOST_GW}:${HOST_K3S_PORT}..."
  limactl shell "${name}" sudo bash -c "
    if systemctl is-active --quiet k3s-agent 2>/dev/null; then
      echo 'k3s-agent already running, skipping.'
      exit 0
    fi
    curl -sfL https://get.k3s.io | K3S_URL='https://${HOST_GW}:${HOST_K3S_PORT}' K3S_TOKEN='${token}' sh -
    echo 'Waiting for k3s-agent...'
    for i in \$(seq 1 60); do
      systemctl is-active --quiet k3s-agent && break
      sleep 3
    done
    echo 'k3s-agent is running.'
  "
}

# --- Step 1: Management node ---
ensure_vm "${MGMT_VM}" "${LIMA_DIR}/mgmt.yaml"

info "Waiting for k3s server on ${MGMT_VM}..."
for i in $(seq 1 120); do
  if limactl shell "${MGMT_VM}" sudo /usr/local/bin/kubectl get nodes 2>/dev/null | grep -q " Ready"; then
    break
  fi
  sleep 5
done

# --- Step 2: Extract join token ---
K3S_TOKEN="$(limactl shell "${MGMT_VM}" sudo cat /root/node-token)"
info "Got join token."

# --- Step 3: Create and join workers ---
ensure_vm "${CPU_VM}" "${LIMA_DIR}/workload-cpu.yaml"
ensure_vm "${GPU_VM}" "${LIMA_DIR}/workload-gpu.yaml"

join_worker "${CPU_VM}" "${K3S_TOKEN}" &
join_worker "${GPU_VM}" "${K3S_TOKEN}" &
wait

# --- Step 4: Wait for all nodes ---
info "Waiting for all 3 nodes to be Ready..."
for i in $(seq 1 60); do
  READY_COUNT=$(limactl shell "${MGMT_VM}" sudo /usr/local/bin/kubectl get nodes --no-headers 2>/dev/null | grep -c " Ready" || true)
  if [ "${READY_COUNT}" -ge 3 ]; then
    info "All 3 nodes are Ready."
    break
  fi
  sleep 5
done

# --- Step 5: Install KubeVirt ---
info "Installing KubeVirt ${KUBEVIRT_VERSION}..."
limactl shell "${MGMT_VM}" sudo /usr/local/bin/kubectl create namespace kubevirt --dry-run=client -o yaml | \
  limactl shell "${MGMT_VM}" sudo /usr/local/bin/kubectl apply -f -
limactl shell "${MGMT_VM}" sudo /usr/local/bin/kubectl apply -f \
  "https://github.com/kubevirt/kubevirt/releases/download/${KUBEVIRT_VERSION}/kubevirt-operator.yaml"

info "Waiting for virt-operator..."
limactl shell "${MGMT_VM}" sudo /usr/local/bin/kubectl -n kubevirt rollout status deployment/virt-operator --timeout=900s

info "Applying KubeVirt CR (software emulation)..."
cat "${DEV_DIR}/kubevirt-cr-dev.yaml" | limactl shell "${MGMT_VM}" sudo /usr/local/bin/kubectl apply -f -

info "Waiting for KubeVirt..."
limactl shell "${MGMT_VM}" sudo /usr/local/bin/kubectl -n kubevirt wait --for=condition=Available kubevirt/kubevirt --timeout=900s

# --- Step 6: Label nodes ---
info "Labeling worker nodes..."
# Find worker node names (not the mgmt/server node)
MGMT_HOSTNAME="$(limactl shell "${MGMT_VM}" hostname)"
ALL_NODES=$(limactl shell "${MGMT_VM}" sudo /usr/local/bin/kubectl get nodes --no-headers -o custom-columns=":metadata.name")

for node in ${ALL_NODES}; do
  if [ "${node}" = "${MGMT_HOSTNAME}" ]; then
    continue
  fi
  # Label first non-mgmt worker as cpu, second as gpu
  if [ -z "${CPU_LABELED:-}" ]; then
    limactl shell "${MGMT_VM}" sudo /usr/local/bin/kubectl label node "${node}" workload-type=cpu --overwrite
    CPU_LABELED=1
    info "  ${node} → workload-type=cpu"
  else
    limactl shell "${MGMT_VM}" sudo /usr/local/bin/kubectl label node "${node}" workload-type=gpu gpu=true --overwrite
    info "  ${node} → workload-type=gpu, gpu=true"
  fi
done

# --- Step 7: Install virtctl ---
info "Installing virtctl on mgmt node..."
limactl shell "${MGMT_VM}" sudo bash -c "
  curl -sL -o /usr/local/bin/virtctl \
    'https://github.com/kubevirt/kubevirt/releases/download/${KUBEVIRT_VERSION}/virtctl-${KUBEVIRT_VERSION}-linux-amd64'
  chmod +x /usr/local/bin/virtctl
"

# --- Step 8: Extract kubeconfig ---
"${SCRIPT_DIR}/kubeconfig.sh"

info ""
info "Layer 1 dev environment is ready!"
info "  3 nodes: ${MGMT_VM} (mgmt), ${CPU_VM} (cpu), ${GPU_VM} (gpu)"
info "  Kubeconfig: .platform-data/workload-kubeconfig"
info "  Run 'make layer1-dev-status' to check status."
