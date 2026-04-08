#!/bin/bash
set -euo pipefail

# Layer 1 Dev: Report status of all 3 Lima VMs and cluster state

MGMT_VM="neo-mgmt"

echo "=== Lima VMs ==="
for vm in neo-mgmt neo-cpu neo-gpu; do
  limactl list 2>/dev/null | grep "${vm}" || echo "${vm}: not found"
done

echo ""
echo "=== Kubernetes Nodes ==="
limactl shell "${MGMT_VM}" sudo /usr/local/bin/kubectl get nodes -o wide 2>/dev/null || echo "(k3s not ready)"

echo ""
echo "=== KubeVirt Status ==="
limactl shell "${MGMT_VM}" sudo /usr/local/bin/kubectl -n kubevirt get kubevirt 2>/dev/null || echo "(KubeVirt not installed)"

echo ""
echo "=== Pods ==="
limactl shell "${MGMT_VM}" sudo /usr/local/bin/kubectl get pods -A 2>/dev/null || echo "(k3s not ready)"
