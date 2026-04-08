# Layer 1: Infrastructure

From bare metal (or Lima VMs) to a compute-ready Kubernetes cluster with KubeVirt.

## Dev Mode

3 Lima VMs simulating a real cluster topology:

| VM | Role | Resources |
|----|------|-----------|
| neo-mgmt | k3s server (control plane) | 2 CPU, 4 GiB |
| neo-cpu | k3s agent (CPU workload) | 2 CPU, 4 GiB |
| neo-gpu | k3s agent (simulated GPU) | 2 CPU, 4 GiB |

```bash
make layer1-dev-up          # Create 3 VMs, join cluster, install KubeVirt
make layer1-dev-status      # Check node and KubeVirt status
make layer1-dev-kubeconfig  # Extract kubeconfig to .platform-data/
make layer1-dev-down        # Tear down
```

KubeVirt runs in software emulation mode. The GPU node advertises a fake `nvidia.com/gpu` resource for scheduling tests.

## Prod Mode

Production uses bare metal provisioning and real hardware:

| Component | Directory | Purpose |
|-----------|-----------|---------|
| Metal3 | [prod/metal3/](prod/metal3/) | BareMetalHost templates, Ironic config |
| Management cluster | [prod/management-cluster/](prod/management-cluster/) | Cluster API + kubeadm (3 CP replicas) |
| Workload cluster | [prod/workload-cluster/](prod/workload-cluster/) | CPU + GPU worker MachineDeployments |
| KubeVirt | [prod/kubevirt/](prod/kubevirt/) | Production CR with KVM + VFIO GPU passthrough |
| Kube-OVN | [prod/kube-ovn/](prod/kube-ovn/) | CNI + tenant virtual network isolation |
| GPU | [prod/gpu/](prod/gpu/) | NVIDIA GPU Operator + Kueue quotas |
| Storage | [prod/storage/](prod/storage/) | Rook-Ceph (block + object) |
| Security | [prod/security/](prod/security/) | NetworkPolicy, encryption, PSS |
| TLS | [prod/tls/](prod/tls/) | cert-manager, Let's Encrypt issuers |

## Dev vs Prod Parity

| Concern | Dev (Lima) | Prod (Bare Metal) |
|---------|-----------|-------------------|
| OS provisioning | cloud-init | Metal3 + Flatcar |
| Kubernetes | k3s | kubeadm via Cluster API |
| Networking | k3s default CNI | Kube-OVN |
| Storage | local-path | Rook-Ceph |
| KubeVirt | software emulation | KVM + VFIO GPU passthrough |
| GPU | fake extended resource | NVIDIA GPU Operator |
