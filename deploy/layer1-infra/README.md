# Layer 1: Infrastructure

From bare metal (or libvirt VMs) to a compute-ready Kubernetes cluster with KubeVirt.

**Layer 1 requires a Linux host with KVM.** The output is a kubeconfig — the boundary between Layer 1 and Layer 2+.

For macOS development, skip Layer 1 and use `make lima-up` (Layer 2 dev) which provides a local workload cluster via Lima.

## Dev Mode

Uses libvirt + Metal3 + Ironic — the same provisioning pipeline as production. Workers PXE boot from Ironic and get Flatcar Container Linux.

### Prerequisites (Linux)

```bash
sudo apt install libvirt-daemon-system qemu-kvm virtinst genisoimage
pip3 install sushy-tools
# Install clusterctl: https://cluster-api.sigs.k8s.io/user/quick-start#install-clusterctl
```

### Architecture

```
Linux host (KVM)
├── libvirt daemon (qemu:///system)
├── sushy-tools (virtual Redfish BMC)
│
├── neo-mgmt (libvirt VM)
│   ├── k3s (management cluster)
│   ├── Metal3 / BMO
│   └── Ironic (PXE + image server)
│
├── neo-worker-cpu (PXE booted → Flatcar)
└── neo-worker-gpu (PXE booted → Flatcar)
```

### Usage

```bash
make layer1-dev-up          # Create VMs, install Metal3, provision workers
make layer1-dev-status      # Check VM, BareMetalHost, and node status
make layer1-dev-kubeconfig  # Extract kubeconfig
make layer1-dev-down        # Tear down everything
```

### Resource Requirements

| VM | CPU | RAM | Disk |
|----|-----|-----|------|
| neo-mgmt | 4 | 8 GiB | 40 GiB |
| neo-worker-cpu | 2 | 4 GiB | 20 GiB |
| neo-worker-gpu | 2 | 4 GiB | 20 GiB |
| **Total** | **8** | **16 GiB** | **80 GiB** |

### Dev Files

| Directory | Contents |
|-----------|----------|
| [dev/libvirt/](dev/libvirt/) | Network XMLs, domain XMLs, cloud-init |
| [dev/metal3/](dev/metal3/) | Ironic config, BareMetalHost CRs |
| [dev/capi/](dev/capi/) | CAPI Cluster + MachineDeployments |
| [dev/scripts/](dev/scripts/) | up.sh, down.sh, status.sh, kubeconfig.sh |

## Prod Mode

Production uses the same Metal3/Ironic stack with real hardware:

| Component | Directory | Purpose |
|-----------|-----------|---------||
| Metal3 | [prod/metal3/](prod/metal3/) | BareMetalHost templates, Ironic config |
| Management cluster | [prod/management-cluster/](prod/management-cluster/) | Cluster API + kubeadm (3 CP replicas) |
| Workload cluster | [prod/workload-cluster/](prod/workload-cluster/) | CPU + GPU worker MachineDeployments |
| KubeVirt | [prod/kubevirt/](prod/kubevirt/) | Production CR with KVM + VFIO GPU passthrough |
| Kube-OVN | [prod/kube-ovn/](prod/kube-ovn/) | CNI + tenant virtual network isolation |
| GPU | [prod/gpu/](prod/gpu/) | NVIDIA GPU Operator + Kueue quotas |
| Storage | [prod/storage/](prod/storage/) | Rook-Ceph (block + object) |
| Security | [prod/security/](prod/security/) | NetworkPolicy, encryption, PSS |
| TLS | [prod/tls/](prod/tls/) | cert-manager, Let's Encrypt issuers |

## Layer Boundary

Layer 1 produces a **kubeconfig** for a Kubernetes cluster with KubeVirt installed. This is the only interface between Layer 1 and Layer 2. Layer 2+ can run on any machine that has access to this kubeconfig.

## Dev vs Prod Parity

| Concern | Dev (libvirt) | Prod (Bare Metal) |
|---------|--------------|-------------------|
| BMC | sushy-tools (virtual Redfish) | Real IPMI/Redfish |
| Provisioning | Ironic (same) | Ironic (same) |
| OS | Flatcar (same) | Flatcar (same) |
| Cluster API | CAPI + Metal3 (same) | CAPI + Metal3 (same) |
| BareMetalHost | Same CRs | Same CRs |
| KubeVirt | Software emulation | KVM + VFIO |
| Networking | Linux bridges | Kube-OVN |
