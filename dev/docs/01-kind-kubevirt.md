# Phase 1: Kind + KubeVirt (Workload Cluster)

The workload cluster runs tenant VMs via KubeVirt. For local dev, this is a Kind cluster with the KubeVirt operator installed.

### Apple Silicon (aarch64) limitation

KubeVirt on ARM64 **requires** `host-passthrough` CPU mode, which needs KVM. Kind on macOS does not provide `/dev/kvm`, so **VMs cannot actually boot on Apple Silicon Kind clusters**. The KubeVirt operator and CRDs still install and work — only VM execution fails.

Options for running real VMs:
- **x86_64 Linux machine** — Kind with `useEmulation: true` works (software emulation, ~10x slower)
- **Remote workload cluster** — point `WORKLOAD_KUBECONFIG` at a real x86_64 cluster with KVM
- **Docker Desktop with Rosetta** — experimental; create an x86 Kind cluster via `docker run --platform linux/amd64`

On Apple Silicon, `make kind-kubevirt` is still useful: it sets up the KubeVirt CRDs so the platform operator can reconcile `VirtualMachine` resources — the VMs just won't reach `Running` state.

## Quick Setup

```bash
make kind-kubevirt
```

This creates a Kind cluster and installs KubeVirt with software emulation enabled.

## Run a Demo VM

```bash
make demo-vm
```

This creates a lightweight Alpine VM using a `containerDisk` (no CDI or persistent storage needed). The VM boots in ~30-60 seconds.

Access the VM:

```bash
# Serial console (login: root / demo)
KUBECONFIG=.platform-data/workload-kubeconfig virtctl console demo-vm

# Or SSH (if virtctl is installed)
KUBECONFIG=.platform-data/workload-kubeconfig virtctl ssh root@demo-vm
```

Install `virtctl`:

```bash
# macOS
brew install kubevirt/kubevirt/virtctl

# Or download from KubeVirt releases
export VERSION=v1.8.1
curl -L -o virtctl https://github.com/kubevirt/kubevirt/releases/download/${VERSION}/virtctl-${VERSION}-$(uname -s | tr '[:upper:]' '[:lower:]')-$(uname -m | sed 's/x86_64/amd64/')
chmod +x virtctl && sudo mv virtctl /usr/local/bin/
```

Clean up:

```bash
make demo-vm-clean
```

## What Happens

1. **Kind cluster** created with name `neocloud-workload` using config at `deploy/kind/kind-config.yaml`
2. **Kubeconfig** saved to `.platform-data/workload-kubeconfig`
3. **KubeVirt operator** installed from upstream release
4. **KubeVirt CR** applied from `deploy/layer1-infra/prod/kubevirt/kubevirt-cr-kind.yaml` — enables software emulation + GPU/HostDevices feature gates
5. Waits for KubeVirt to report `Available`

## Configuration

| Item | Default | Override |
|------|---------|----------|
| Cluster name | `neocloud-workload` | `KIND_CLUSTER_NAME=myname` |
| Kind config | `deploy/kind/kind-config.yaml` | Edit file directly |
| KubeVirt version | `v1.8.1` | `KUBEVIRT_VERSION=v1.8.1` |
| Kubeconfig output | `.platform-data/workload-kubeconfig` | `WORKLOAD_KUBECONFIG=/path/to/file` |

## Kind Cluster Config

The Kind config (`deploy/kind/kind-config.yaml`) creates:
- 1 control-plane node
- 1 worker node with `/dev` mounted (required for KubeVirt device plugins)

## KubeVirt CRs

Two KubeVirt CR variants exist:

| File | Use case |
|------|----------|
| `kubevirt-cr-kind.yaml` | Kind/dev — `useEmulation: true`, no `/dev/kvm` needed |
| `kubevirt-cr.yaml` | Production bare metal — hardware virtualization, GPU passthrough |

Both enable GPU and HostDevices feature gates. The Kind variant adds `useEmulation: true` so QEMU runs in software mode.

## Demo VM

The demo VM (`deploy/layer1-infra/prod/kubevirt/demo-vm.yaml`) uses:
- **containerDisk** — the VM image is baked into a container image (`quay.io/kubevirt/alpine-container-disk-demo`, ~50MB). No CDI, PVC, or StorageClass needed.
- **cloud-init** — sets hostname and root password (`demo`)
- **256MB RAM, 1 CPU** — minimal resources for Kind

Alternative container disk images:

| Image | Size | OS |
|-------|------|----|
| `quay.io/kubevirt/alpine-container-disk-demo` | ~50MB | Alpine (default) |
| `quay.io/kubevirt/cirros-container-disk-demo` | ~15MB | CirrOS (even smaller) |
| `quay.io/kubevirt/fedora-cloud-container-disk-demo` | ~300MB | Fedora (full OS) |

## Verify

```bash
export KUBECONFIG=.platform-data/workload-kubeconfig

# Cluster nodes
kubectl get nodes

# KubeVirt status
kubectl -n kubevirt get kubevirt
kubectl -n kubevirt get pods

# VMs
kubectl get vm
kubectl get vmi    # running VM instances
```

## Tear Down

```bash
make demo-vm-clean  # delete demo VM
make kind-down      # delete entire cluster
```

## Additional KubeVirt Resources

The `deploy/layer1-infra/prod/kubevirt/` directory contains:

| File | Description |
|------|-------------|
| `kubevirt-cr-kind.yaml` | KubeVirt CR for Kind — software emulation (used by `make kind-kubevirt`) |
| `kubevirt-cr.yaml` | KubeVirt CR for production — hardware virt + GPU passthrough |
| `demo-vm.yaml` | Demo Alpine VM using containerDisk (used by `make demo-vm`) |
| `ubuntu-vm-image.yaml` | CDI DataVolume for Ubuntu 22.04 cloud image (requires CDI + Ceph) |
| `gvisor-runtimeclass.yaml` | RuntimeClass for gVisor sandboxing (CPU-only workloads) |

The Ubuntu image and gVisor RuntimeClass are for production clusters with CDI and proper storage — they are not installed in the Kind dev environment.
