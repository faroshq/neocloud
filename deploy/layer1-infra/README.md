# Layer 1: Infrastructure

From bare metal (or libvirt VMs) to a compute-ready Kubernetes cluster with KubeVirt.

**Layer 1 requires a Linux host with KVM.** The output is a kubeconfig — the boundary between Layer 1 and Layer 2+.

For macOS development, skip Layer 1 and use `make lima-up` (Layer 2 dev) which provides a local workload cluster via Lima.

## Dev Mode

Uses libvirt + Metal3 + Ironic — the same provisioning pipeline as production. Workers PXE boot from Ironic and get Ubuntu 24.04.

### Prerequisites (Linux)

```bash
sudo apt install libvirt-daemon-system qemu-kvm virtinst genisoimage pipx
pipx install sushy-tools
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
├── neo-worker-cpu (PXE booted → Ubuntu 24.04)
└── neo-worker-gpu (PXE booted → Ubuntu 24.04)
```

### Usage

```bash
make layer1-dev-up          # Create VMs, install Metal3, provision workers
make layer1-dev-status      # Check VM, BareMetalHost, and node status
make layer1-dev-kubeconfig  # Extract kubeconfig
make layer1-dev-down        # Tear down everything
```

### Debugging

#### Host (libvirt / sushy-tools)

```bash
# List all VMs and their state
virsh list --all

# VM details
virsh dominfo neo-mgmt

# Open serial console to a VM (Ctrl+] to exit)
# Login: neo / neo
virsh console neo-mgmt

# Check VM network interfaces and IPs
virsh domifaddr neo-mgmt --source agent

# List libvirt networks
virsh net-list --all

# View cloud-init logs (inside mgmt VM)
virsh console neo-mgmt
# then: journalctl -u cloud-init --no-pager

# Check k3s status (inside mgmt VM)
ssh neo@<mgmt-ip> kubectl get nodes

# Tail VM serial output (useful for PXE boot debugging)
virsh console neo-worker-cpu

# Check worker VM domain XML (boot order, UEFI firmware)
virsh dumpxml neo-worker-cpu | head -25
```

#### sushy-tools (virtual Redfish BMC)

```bash
# Check if sushy-emulator is running
pgrep -fa sushy-emulator

# List systems via Redfish API
curl http://172.16.20.1:8000/redfish/v1/Systems

# Check specific worker system
curl http://172.16.20.1:8000/redfish/v1/Systems/neo-worker-cpu

# Check power state
curl http://172.16.20.1:8000/redfish/v1/Systems/neo-worker-cpu | jq .PowerState
```

#### Management cluster (k3s on neo-mgmt)

```bash
# SSH to mgmt VM (password: neo)
sshpass -p neo ssh -o StrictHostKeyChecking=no neo@172.16.30.10

# BareMetalHost status
kubectl get bmh -n metal3
kubectl get bmh -n metal3 -o yaml  # full status with error messages

# BMO controller logs (watches BMH CRs, talks to Ironic)
kubectl logs -n baremetal-operator-system deployment/baremetal-operator-controller-manager --tail=30

# Ironic pod status (dnsmasq, ironic API, httpd)
kubectl get pods -n baremetal-operator-system
kubectl logs -n baremetal-operator-system deployment/baremetal-operator-ironic -c ironic --tail=20
kubectl logs -n baremetal-operator-system deployment/baremetal-operator-ironic -c ironic-dnsmasq --tail=20
kubectl logs -n baremetal-operator-system deployment/baremetal-operator-ironic -c ironic-httpd --tail=20

# Check Ironic readiness probe
kubectl exec -n baremetal-operator-system deployment/baremetal-operator-ironic -c ironic -- /bin/ironic-readiness

# Verify Ironic configmaps (check IRONIC_ENDPOINT points to 172.16.20.10)
kubectl get configmap -n baremetal-operator-system ironic -o yaml
kubectl get configmap -n baremetal-operator-system -l app=ironic -o yaml

# Verify worker image is served by Ironic httpd
curl -I http://172.16.20.10:6180/images/ubuntu-worker.img

# List images inside Ironic httpd container
kubectl exec -n baremetal-operator-system deployment/baremetal-operator-ironic -c ironic-httpd -- ls /shared/html/images/

# CAPI cluster and machine status
kubectl get clusters,machines -A
kubectl get metal3machines -A

# Check CAPI controller logs
kubectl logs -n capm3-system deployment/capm3-controller-manager --tail=30
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

## Layer Boundary

Layer 1 produces a **kubeconfig** for a Kubernetes cluster with KubeVirt installed. This is the only interface between Layer 1 and Layer 2. Layer 2+ can run on any machine that has access to this kubeconfig.

## Dev vs Prod Parity

| Concern | Dev (libvirt) | Prod (Bare Metal) |
|---------|--------------|-------------------|
| BMC | sushy-tools (virtual Redfish) | Real IPMI/Redfish |
| Provisioning | Ironic (same) | Ironic (same) |
| OS | Ubuntu 24.04 | Ubuntu 24.04 (prod) |
| Cluster API | CAPI + Metal3 (same) | CAPI + Metal3 (same) |
| BareMetalHost | Same CRs | Same CRs |
| KubeVirt | Software emulation | KVM + VFIO |
| Networking | Kube-OVN (single replica) | Kube-OVN (HA) |
