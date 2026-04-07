# Layer 1: From Bare Metal to Compute-Ready Kubernetes

## Infrastructure Foundation for Sovereign Small Cloud

**Version:** 0.1.0-draft
**Date:** 2026-03-26
**Status:** Working Draft

> This document covers Layer 1 — infrastructure. For the multi-tenant platform layer, see [02-platform.md](02-platform.md).

---

## Table of Contents

1. [Overview](#1-overview)
2. [Hardware Requirements](#2-hardware-requirements)
3. [Bare Metal Provisioning — Metal3 + Flatcar](#3-bare-metal-provisioning--metal3--flatcar)
4. [Kubernetes Layer](#4-kubernetes-layer)
5. [Networking — Kube-OVN](#5-networking--kube-ovn)
6. [Storage — Rook-Ceph](#6-storage--rook-ceph)
7. [GPU Management — NVIDIA GPU Operator](#7-gpu-management--nvidia-gpu-operator)
8. [VM Infrastructure — KubeVirt](#8-vm-infrastructure--kubevirt)
9. [Runtime Sandboxing — gVisor](#9-runtime-sandboxing--gvisor)
10. [Security Hardening](#10-security-hardening)
11. [Component Summary](#11-component-summary)
12. [What's Next](#12-whats-next)

---

## 1. Overview

Layer 1 answers a single question: **how do I go from physical servers in a rack to a Kubernetes cluster that is ready to be sliced into multi-tenant compute?**

This layer takes bare metal hardware — commodity servers with CPUs, GPUs, disks, and network interfaces — and produces a fully operational Kubernetes cluster with:

- **Automated bare metal provisioning** via Metal3 and Flatcar Container Linux
- **Container networking and tenant virtual networks** via Kube-OVN (CNI, NetworkPolicy, Vpc/Subnet isolation)
- **Unified storage** via Rook-Ceph (block volumes and S3-compatible object storage)
- **GPU acceleration** via the NVIDIA GPU Operator
- **VM support** via KubeVirt for workloads that need full virtual machines
- **Runtime sandboxing** via gVisor for additional workload isolation
- **Security hardening** across the OS, network, and runtime layers

The output of Layer 1 is a compute-ready Kubernetes cluster. It does not define tenants, platform APIs, identity, billing, or self-service workflows. Those concerns belong to Layer 2 ([02-platform.md](02-platform.md)), which takes this infrastructure and turns it into a multi-tenant cloud platform.

```
Layer 1 (this document)           Layer 2 (02-platform.md)
─────────────────────────         ─────────────────────────
Bare metal servers                Multi-tenant control plane
  → Flatcar OS                      → Tenant workspaces
  → Kubernetes cluster              → Platform APIs
  → Kube-OVN networking               → Identity and access
  → Rook-Ceph storage               → Self-service onboarding
  → GPU Operator                    → Billing and metering
  → KubeVirt VMs
  → gVisor sandboxing
  → Security hardening

Output: compute-ready cluster     Output: cloud platform
```

### Design Principles

Layer 1 follows the same principles as the overall architecture:

| # | Principle | Application to Layer 1 |
|---|-----------|----------------------|
| 1 | **Minimal moving parts** | Kube-OVN serves as CNI, NetworkPolicy enforcer, and provides tenant virtual network isolation via Vpc/Subnet CRDs. Rook-Ceph replaces separate block and object storage systems. |
| 2 | **Open source, CNCF-aligned** | Every component is open source with an OSI-approved license. Prefer CNCF projects. |
| 3 | **Interface-based** | Bare metal provisioning, storage, and networking are behind swappable interfaces. Alternatives are documented. |
| 4 | **Sovereign by default** | All infrastructure runs on the provider's hardware. No external dependencies. |

---

## 2. Hardware Requirements

### Minimum Deployment

A minimal Layer 1 deployment requires 3 servers. A production deployment targets 2-3 racks.

| Resource | Minimum (3-node) | Production (2-3 racks) |
|----------|------------------|----------------------|
| CPU nodes | 3 (combined mgmt + workload) | 3 management + 6-20 workload |
| GPU nodes | 0 (optional) | 1-8 per rack |
| RAM per node | 64 GB | 128-512 GB |
| OS disk | 1x 256 GB SSD | 1x 512 GB NVMe |
| Storage disks | 1x 1 TB per node (Ceph OSD) | 2-4x NVMe/SSD per node |
| Network | 1x 10 GbE | 2x 25 GbE (bonded) |
| BMC | IPMI or Redfish | Redfish preferred |

### Server BMC Requirements

Metal3 manages servers through their Baseboard Management Controller (BMC). Supported protocols:

- **IPMI** — widely available, basic power management
- **Redfish** — modern REST-based API, preferred for new hardware
- **Vendor-specific** — iDRAC (Dell), iLO (HPE), supported via Ironic drivers

Every server must have its BMC accessible on a management network.

### Network Layout

The infrastructure requires three logical network segments. These can be separate physical networks or VLANs on a shared fabric.

```
┌──────────────────────────────────────────────────────┐
│                  NETWORK SEGMENTS                      │
│                                                        │
│  1. BMC Network (out-of-band management)              │
│     ├── IPMI/Redfish access to all server BMCs        │
│     └── Isolated from workload traffic                │
│                                                        │
│  2. Provisioning Network (PXE boot)                   │
│     ├── DHCP/TFTP managed by Ironic                   │
│     ├── Used during initial server provisioning       │
│     └── Isolated L2 segment                           │
│                                                        │
│  3. Cluster Network (Kubernetes + workloads)          │
│     ├── Node-to-node communication                    │
│     ├── Pod overlay (Geneve/VXLAN) or native routing   │
│     ├── Service load balancing                        │
│     └── External access (ingress, load balancer IPs) │
└──────────────────────────────────────────────────────┘
```

### Rack Layout (Production)

```
Rack 1                    Rack 2                    Rack 3
┌──────────────┐         ┌──────────────┐         ┌──────────────┐
│ ToR Switch   │         │ ToR Switch   │         │ ToR Switch   │
│ (25GbE)      │         │ (25GbE)      │         │ (25GbE)      │
├──────────────┤         ├──────────────┤         ├──────────────┤
│ mgmt-1 (CPU) │         │ work-3 (CPU) │         │ work-6 (CPU) │
│ mgmt-2 (CPU) │         │ work-4 (GPU) │         │ work-7 (GPU) │
│ mgmt-3 (CPU) │         │ work-5 (GPU) │         │ work-8 (GPU) │
│ work-1 (CPU) │         │              │         │              │
│ work-2 (CPU) │         │              │         │              │
├──────────────┤         ├──────────────┤         ├──────────────┤
│ PDU          │         │ PDU          │         │ PDU          │
└──────────────┘         └──────────────┘         └──────────────┘
```

Management nodes run the management cluster (Metal3, Cluster API, platform control plane). Workload nodes run tenant workloads (containers, VMs, GPU jobs).

---

## 3. Bare Metal Provisioning — Metal3 + Flatcar

### Role

Metal3 manages the lifecycle of bare metal servers — from powered-off hardware to running Kubernetes nodes. Flatcar Container Linux is the immutable operating system installed on each machine.

### Why Metal3

Metal3 is the Kubernetes-native bare metal provisioning system:

- **CNCF Incubating** — governed by the CNCF, not a single vendor
- **Apache 2.0** — fully open source, no commercial components
- **57 contributing organizations** — co-maintained by Red Hat and Ericsson (Sweden/EU)
- **Cluster API integration** — declarative cluster lifecycle management
- **Ironic-based** — battle-tested provisioning engine from OpenStack, runs standalone

| Project | CNCF | License | Vendor Neutral | Status |
|---------|------|---------|---------------|--------|
| **Metal3** | Incubating | Apache 2.0 | Yes (57 orgs) | **Selected** |
| Tinkerbell | Sandbox | Apache 2.0 | Yes | Viable alternative |
| Sidero Metal | None | MPL-2.0 | No (deprecated) | Not recommended |
| MAAS | None | AGPL-3.0 | No (Canonical) | Ubuntu-centric |

Sidero Metal was deprecated in favor of Sidero Omni, a BSL-licensed (not open source) commercial product. This ruled it out.

### Why Flatcar

Flatcar Container Linux is an immutable, container-optimized OS:

- **CNCF Incubating** — donated by Microsoft after acquiring Kinvolk (Berlin, Germany/EU)
- **Apache 2.0** — fully open source, no commercial gating
- **Immutable** — read-only root filesystem, atomic updates, minimal attack surface
- **Metal3 compatible** — publishes Metal3-ready images
- **Container-native** — ships with containerd, designed for running Kubernetes

### How It Works

The provisioning flow starts from a seed node — a single machine (or VM) that bootstraps the management cluster. From there, Metal3 takes over.

```
┌──────────────────────────────────────────────────────────────┐
│                  MANAGEMENT CLUSTER                           │
│                                                               │
│  Metal3 Stack:                                                │
│  ├── Ironic (provisioning engine)                            │
│  │   ├── DHCP/TFTP for PXE boot                             │
│  │   ├── IPA (Ironic Python Agent) for disk imaging          │
│  │   └── BMC drivers (IPMI, Redfish, iDRAC, iLO)            │
│  ├── Baremetal Operator (BMO)                                │
│  │   └── Manages BareMetalHost CRs                          │
│  └── CAPM3 (Cluster API Provider Metal3)                     │
│      └── Integrates with Cluster API for cluster lifecycle   │
└──────────────────────────┬───────────────────────────────────┘
                           │
     Register hardware     │     Provision clusters
     ┌─────────────────────┼─────────────────────────┐
     ▼                     ▼                         ▼
BareMetalHost         Cluster (CAPI)          Machine (CAPI)
  name: node-1          name: workload-1        ├── Flatcar image
  bmc:                  infrastructure:         ├── kubeadm bootstrap
    address: ipmi://    Metal3Cluster           └── Join cluster
    credentialsName:
    ...
```

### Provisioning Lifecycle

1. **Seed** — Bootstrap a management cluster on a single node (or VM). Install Metal3, Ironic, and Cluster API.
2. **Register** — Create `BareMetalHost` resources with BMC credentials for each physical server.
3. **Inspect** — Metal3/Ironic introspects hardware via BMC (CPU count, RAM, disk sizes, NIC MACs).
4. **Provision** — Apply Cluster API `Cluster` + `Machine` manifests. Metal3 PXE-boots machines, writes Flatcar to disk.
5. **Bootstrap** — kubeadm initializes Kubernetes on the newly provisioned nodes.
6. **Scale** — Add or remove `Machine` resources. Metal3 provisions or deprovisions automatically.
7. **Update** — Rolling OS updates via Flatcar's atomic update mechanism.

### BareMetalHost Example

```yaml
apiVersion: metal3.io/v1alpha1
kind: BareMetalHost
metadata:
  name: worker-01
  namespace: metal3
spec:
  online: true
  bootMACAddress: "aa:bb:cc:dd:ee:01"
  bmc:
    address: "redfish://192.168.1.101/redfish/v1/Systems/1"
    credentialsName: worker-01-bmc-credentials
  rootDeviceHints:
    deviceName: /dev/sda
```

### Network Requirements

Metal3/Ironic requires control over a provisioning network for PXE boot:

- **Provisioning network** — isolated L2 segment where DHCP/TFTP runs (managed by Ironic)
- **BMC network** — connectivity to server BMC interfaces (IPMI/Redfish)
- **Cluster network** — standard Kubernetes networking (overlay or native)

These can be the same physical network with VLANs, or separate interfaces.

### Alternatives

The bare metal provisioning layer is interface-based. The platform can work with any provisioning system that produces Kubernetes nodes:

- **Tinkerbell** — CNCF Sandbox, lighter than Metal3, good for simpler deployments
- **Manual / cloud-init** — for hosted machines without BMC access (demo path)
- **PXE + Ansible** — traditional approach, works but not declarative

> See `deploy/metal3/` for Metal3 deployment manifests.

---

## 4. Kubernetes Layer

### Distribution

The reference architecture uses **kubeadm** for Kubernetes cluster bootstrap:

- Default Cluster API bootstrap provider — first-class Metal3 integration
- Vanilla upstream Kubernetes — no vendor-specific patches
- Most documented path for Metal3 + CAPI deployments

**k3s** is documented as a lightweight alternative for simpler setups or demo environments where Cluster API is not used.

| Distribution | Cluster API Support | Metal3 Integration | Best For |
|-------------|--------------------|--------------------|----------|
| **kubeadm** | Native (default provider) | First-class | **Production (default)** |
| k3s | Via k3s bootstrap provider | Manual | Demo, edge, simple setups |
| k0s | Via k0s bootstrap provider | Manual | Alternative lightweight |

### Cluster Topology

The platform operates two logical cluster tiers:

```
┌─────────────────────────────┐     ┌─────────────────────────────┐
│    MANAGEMENT CLUSTER        │     │    WORKLOAD CLUSTER(s)       │
│                              │     │                              │
│  Platform control plane      │     │  Tenant workloads            │
│  Metal3 + Cluster API        │     │  (pods, VMs, GPU jobs)       │
│  Prometheus + Grafana        │     │                              │
│  Platform operators          │     │  Kube-OVN (CNI + VirtualNet) │
│  cert-manager                │     │  NVIDIA GPU Operator         │
│                              │     │  KubeVirt (VMs)              │
│  Runs on CPU-only nodes      │     │  Rook-Ceph (storage)         │
│  (3 nodes minimum)           │     │                              │
│                              │     │  Runs on GPU + CPU nodes     │
└─────────────────────────────┘     └─────────────────────────────┘
```

### Why Separate Clusters

- **Fault isolation** — management plane failure does not kill tenant workloads (and vice versa)
- **Security boundary** — tenants have zero access to management infrastructure
- **Independent scaling** — scale workload cluster(s) without touching management
- **Upgrade flexibility** — management and workload clusters can be at different Kubernetes versions

In production, the workload tier can be multiple clusters (e.g., per-rack, per-GPU-type, per-region). The management cluster treats them all the same via operators.

### Cluster API for Lifecycle Management

Cluster API (CAPI) provides declarative cluster lifecycle management. Combined with the Metal3 provider (CAPM3), it manages the full lifecycle:

```
Cluster API Resources:
├── Cluster            → defines the target cluster
├── Metal3Cluster      → Metal3-specific cluster config
├── KubeadmControlPlane → control plane nodes (3 for HA)
├── MachineDeployment  → worker node groups
├── Metal3Machine      → maps to BareMetalHost
└── KubeadmConfigTemplate → node bootstrap configuration
```

Scaling is declarative — change the replica count on a `MachineDeployment` and CAPI provisions or deprovisions nodes automatically via Metal3.

### Workload Cluster Bootstrap

A workload cluster is created by applying CAPI manifests to the management cluster:

```yaml
apiVersion: cluster.x-k8s.io/v1beta1
kind: Cluster
metadata:
  name: workload-1
  namespace: metal3
spec:
  clusterNetwork:
    pods:
      cidrBlocks: ["10.244.0.0/16"]
    services:
      cidrBlocks: ["10.96.0.0/12"]
  controlPlaneRef:
    apiVersion: controlplane.cluster.x-k8s.io/v1beta1
    kind: KubeadmControlPlane
    name: workload-1-control-plane
  infrastructureRef:
    apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
    kind: Metal3Cluster
    name: workload-1
```

> See `deploy/management-cluster/` and `deploy/workload-cluster/` for full manifests.

---

## 5. Networking — Kube-OVN

### Role

Kube-OVN (Apache 2.0, CNCF Sandbox) serves as both the cluster CNI and the foundation for tenant virtual network isolation. It provides:

```
Role                    Kube-OVN Feature                     Replaces
──────────────────────────────────────────────────────────────────────────
Container networking    OVN/OVS dataplane                    kube-proxy + flannel/calico
Tenant virtual networks Vpc + Subnet CRDs                   Multus + secondary CNI
Tenant isolation        Vpc-level dataplane isolation         NetworkPolicy-only isolation
NetworkPolicy           Standard K8s NetworkPolicy support   Calico NetworkPolicy
Overlay networking      Geneve/VXLAN encapsulation           Separate overlay CNI
Load balancing          OVN load balancing                   MetalLB (partial)
```

Kube-OVN is the sole CNI for the platform. It handles both default cluster pod networking (for platform system pods) and isolated tenant virtual networks (for KubeVirt VMs), eliminating the need for Multus or a secondary CNI.

### Why Kube-OVN

- **Apache 2.0** — no commercial gating
- **CNCF Sandbox** — active community, production deployments at scale
- **Vpc/Subnet CRDs** — native multi-tenant virtual network isolation with overlapping CIDRs
- **OVN-based** — proven networking backend (same foundation as OpenShift networking)
- **Single CNI** — handles both platform pod networking and tenant VM networks
- **KubeVirt compatible** — first-class support for VM networking via OVN logical switches

### Tenant Virtual Networks

The key architectural decision: tenant KubeVirt VMs connect **only** to their tenant's virtual network, not the default pod network. This provides true dataplane isolation — not just policy-based filtering.

Kube-OVN's `Vpc` CRD creates an independent OVN logical router with its own routing table. Each `Subnet` within a Vpc is an OVN logical switch. VMs on different Vpcs are isolated at the OVN dataplane level — separate Geneve VNIs, separate forwarding tables.

```
Kube-OVN
  ├── default Vpc (built-in)
  │     └── ovn-default subnet 10.16.0.0/16  → platform pods (controllers, operators, system)
  │
  ├── tenant-a Vpc
  │     └── subnet 10.0.0.0/24               → tenant A KubeVirt VMs
  │
  └── tenant-b Vpc
        └── subnet 10.0.0.0/24               → tenant B KubeVirt VMs (overlapping CIDR, no conflict)
```

Overlapping CIDRs across tenants are fully supported — each Vpc is an independent network domain.

### Overlay Mode (Default)

The default networking mode is **Geneve overlay**:

- Works on any network topology (flat L2, L3 routed, across subnets)
- No special switch or router configuration required
- Suitable for hosted bare metal where underlay control is limited
- Each Vpc gets a unique tunnel ID for dataplane isolation

This is the recommended starting point.

### Kube-OVN Installation

```yaml
# Helm values for workload cluster
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: kube-ovn
spec:
  chart:
    spec:
      chart: kube-ovn
      version: "1.13.x"
      sourceRef:
        kind: HelmRepository
        name: kube-ovn
  values:
    replicaCount: 3
    IFACE: "eth0"
    POD_CIDR: "10.16.0.0/16"
    SVC_CIDR: "10.96.0.0/12"
    ENABLE_LB: true
    ENABLE_NP: true
```

### Tenant Network Isolation

Each tenant gets a dedicated Vpc and Subnet. VMs are attached only to their tenant's subnet — no connection to the default pod network.

```yaml
# Platform controller creates this when a tenant requests a VirtualNetwork
apiVersion: kubeovn.io/v1
kind: Vpc
metadata:
  name: tenant-a-vpc
spec:
  namespaces:
    - tenant-a
---
apiVersion: kubeovn.io/v1
kind: Subnet
metadata:
  name: tenant-a-net
spec:
  vpc: tenant-a-vpc
  cidrBlock: 10.0.0.0/24
  protocol: IPv4
  namespaces:
    - tenant-a
```

VMs on `tenant-a-net` can only communicate with other VMs on the same subnet. Cross-tenant traffic is impossible at the dataplane level — there is no route between Vpcs unless explicitly configured.

Standard Kubernetes NetworkPolicies are supported within each Vpc for finer-grained control.

### Load Balancing on Bare Metal

On bare metal there is no cloud load balancer. For exposing services externally, deploy **MetalLB** alongside Kube-OVN:

```yaml
# MetalLB L2 advertisement
apiVersion: metallb.io/v1beta1
kind: L2Advertisement
metadata:
  name: default
  namespace: metallb-system
---
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: public-pool
  namespace: metallb-system
spec:
  addresses:
    - 192.168.10.0/24
```

### HTTP Ingress

Kube-OVN does not include a built-in HTTP ingress controller. Deploy a separate Gateway API implementation (e.g., Envoy Gateway, Nginx Gateway Fabric, or Contour) for tenant HTTP routing:

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: platform-gateway
  namespace: platform-system
spec:
  gatewayClassName: envoy   # or nginx, contour
  listeners:
    - name: https
      protocol: HTTPS
      port: 443
      tls:
        mode: Terminate
        certificateRefs:
          - name: wildcard-cert
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: tenant-a-app
  namespace: tenant-a
spec:
  parentRefs:
    - name: platform-gateway
      namespace: platform-system
  hostnames:
    - "app.tenant-a.cloud.example.com"
  rules:
    - backendRefs:
        - name: app-service
          port: 80
```

Combined with **cert-manager** for automated TLS certificates and **external-dns** for DNS record automation.

> See `deploy/kube-ovn/` for full deployment manifests.

---

## 6. Storage — Rook-Ceph

### Role

Rook-Ceph provides unified storage for the workload cluster — both block storage (persistent volumes for VMs, databases, notebooks) and S3-compatible object storage (datasets, artifacts, backups).

### Why Rook-Ceph

- **Single system** for block + object storage (fewer components to operate)
- **CNCF Graduated** (Rook) — mature, well-governed
- **Apache 2.0** — fully open source
- **Self-healing** — automatic data rebalancing and recovery
- **Per-tenant quotas** — CephBlockPool and CephObjectStoreUser CRDs
- **S3 compatibility** — Rados Gateway (RGW) provides S3 API for object storage

### Architecture

```
┌──────────────────────────────────────────┐
│              Rook-Ceph                    │
│                                           │
│  Block (RBD)    Object (RGW)   FS (CephFS)│
│  ──────────     ───────────    ──────────  │
│  PVs for        S3-compatible  Shared      │
│  VMs, DBs,      buckets for    filesystems │
│  notebooks      datasets,      (optional)  │
│                 artifacts                  │
│                                           │
│  StorageClass:  ObjectBucketClaim:         │
│  ceph-block     via OBC API               │
└──────────────────────────────────────────┘
```

### Block Storage (RBD)

Ceph RBD provides block devices for Kubernetes PersistentVolumes. This is used by:

- KubeVirt VM disks
- Database persistent volumes
- Notebook storage
- Any workload requiring persistent block storage

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ceph-block
provisioner: rook-ceph.rbd.csi.ceph.com
parameters:
  clusterID: rook-ceph
  pool: replicapool
  imageFormat: "2"
  csi.storage.k8s.io/provisioner-secret-name: rook-csi-rbd-provisioner
  csi.storage.k8s.io/provisioner-secret-namespace: rook-ceph
reclaimPolicy: Delete
allowVolumeExpansion: true
```

### Object Storage (RGW)

Ceph Rados Gateway provides S3-compatible object storage. Tenants can store datasets, model artifacts, backups, and other unstructured data.

```yaml
apiVersion: ceph.rook.io/v1
kind: CephObjectStore
metadata:
  name: tenant-store
  namespace: rook-ceph
spec:
  metadataPool:
    replicated:
      size: 3
  dataPool:
    replicated:
      size: 3
  gateway:
    port: 80
    instances: 2
```

### Minimum Requirements

- **3+ nodes** with dedicated storage devices (not shared with OS)
- **Dedicated OSD disks** — HDDs for capacity, SSDs/NVMe for performance
- **10 GbE recommended** for replication traffic
- **Separate OSD network** (optional) — dedicated NIC for Ceph replication to avoid contention with workload traffic

### CephCluster Example

```yaml
apiVersion: ceph.rook.io/v1
kind: CephCluster
metadata:
  name: rook-ceph
  namespace: rook-ceph
spec:
  cephVersion:
    image: quay.io/ceph/ceph:v19
  dataDirHostPath: /var/lib/rook
  mon:
    count: 3
    allowMultiplePerNode: false
  storage:
    useAllNodes: true
    useAllDevices: false
    deviceFilter: "^sd[b-z]"  # use all disks except sda (OS disk)
  resources:
    osd:
      requests:
        cpu: "2"
        memory: "4Gi"
```

### Alternatives

| Project | Type | License | CNCF | Best For |
|---------|------|---------|------|----------|
| **Rook-Ceph** | Block + Object + FS | Apache 2.0 | Graduated | **Reference choice** |
| Longhorn | Block only | Apache 2.0 | Incubating | Simpler deployments |
| MinIO | Object only | AGPL-3.0 | None | Dedicated S3 |
| OpenEBS | Block (Mayastor) | Apache 2.0 | Sandbox | NVMe performance |

For simpler deployments: **Longhorn** (block) + **MinIO** (object) is a lighter alternative to Rook-Ceph at the cost of operating two systems instead of one.

> See `deploy/storage/` for Rook-Ceph deployment manifests.

---

## 7. GPU Management — NVIDIA GPU Operator

### Role

The NVIDIA GPU Operator automates the full NVIDIA software stack on Kubernetes nodes, eliminating the need to manually install and manage GPU drivers, device plugins, and monitoring tools.

### What It Automates

```
Component                   Function
─────────────────────────────────────────────────────────
NVIDIA Driver               GPU kernel driver (containerized)
Container Toolkit           Container runtime GPU support
Device Plugin               Exposes nvidia.com/gpu resource
DCGM Exporter               GPU metrics → Prometheus
GPU Feature Discovery       Node labels (GPU model, driver version, MIG mode)
```

All components are deployed as DaemonSets. The operator detects GPU nodes and installs the full stack automatically.

### v1: Whole GPU Allocation

In the initial version, GPUs are allocated as whole units — one GPU per workload:

```
Pod requests:   nvidia.com/gpu: 1
Scheduling:     Standard Kubernetes scheduler
Monitoring:     DCGM Exporter → Prometheus
```

This is the simplest model with the strongest isolation. No GPU sharing means no risk of cross-tenant interference on the GPU.

### GPU Operator Installation

```yaml
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: gpu-operator
  namespace: gpu-operator
spec:
  chart:
    spec:
      chart: gpu-operator
      version: "v24.9.x"
      sourceRef:
        kind: HelmRepository
        name: nvidia
  values:
    operator:
      defaultRuntime: containerd
    driver:
      enabled: true
    dcgmExporter:
      enabled: true
      serviceMonitor:
        enabled: true
```

### GPU Scheduling Flow

```
1. Workload requests nvidia.com/gpu: 1
2. Kubernetes scheduler places pod on a node with available GPU
3. Device Plugin assigns a specific GPU to the container
4. DCGM Exporter reports GPU utilization, temperature, memory to Prometheus
```

### GPU Test Verification

After deploying the GPU Operator, verify GPU access:

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: gpu-test
spec:
  restartPolicy: Never
  containers:
    - name: cuda-test
      image: nvcr.io/nvidia/k8s/cuda-sample:vectoradd-cuda12.5.0
      resources:
        limits:
          nvidia.com/gpu: 1
```

Expected output: `Test PASSED`

### Future: GPU Sharing

GPU sharing is documented but not implemented in v1. Options for future versions:

| Method | How It Works | Isolation | GPU Support |
|--------|-------------|-----------|-------------|
| **MIG** | Hardware-partitioned slices | Strong (HW-isolated) | A100, H100, B100+ |
| **MPS** | CUDA multi-process service | Medium | Any NVIDIA |
| **Time-slicing** | Software time-multiplexing | Weak | Any NVIDIA |
| **HAMi** | CUDA interception, memory limits | Medium | Multi-vendor (CNCF Sandbox) |

**Recommended upgrade path:** MIG on supported GPUs (A100+), HAMi (CNCF Sandbox, Apache 2.0) for older or multi-vendor GPUs.

> See `deploy/gpu/` for GPU Operator deployment manifests.

---

## 8. VM Infrastructure — KubeVirt

### Role

KubeVirt (Apache 2.0, CNCF Incubating) extends Kubernetes with the ability to run virtual machines alongside containers. This enables workloads that require a full OS environment — legacy applications, GPU-accelerated VMs, custom kernel requirements.

### What KubeVirt Provides

- **VM lifecycle management** — create, start, stop, migrate VMs as Kubernetes resources
- **GPU passthrough** — PCI passthrough of whole GPUs to VMs
- **Live migration** — move running VMs between nodes for maintenance
- **Persistent disks** — backed by Rook-Ceph PersistentVolumes
- **Cloud-init** — standard VM initialization (users, SSH keys, networking)
- **VNC/console access** — browser-based console access via virtctl

### KubeVirt Installation

```yaml
apiVersion: hco.kubevirt.io/v1beta1
kind: HyperConverged
metadata:
  name: kubevirt-hyperconverged
  namespace: kubevirt-hyperconverged
spec:
  infra: {}
  workloads: {}
  featureGates:
    withHostPassthroughCPU: true
    enableCommonBootImageImport: true
    GPU: true
```

### VM with GPU Passthrough

```yaml
apiVersion: kubevirt.io/v1
kind: VirtualMachine
metadata:
  name: gpu-vm
spec:
  running: true
  template:
    spec:
      domain:
        cpu:
          cores: 8
        memory:
          guest: "32Gi"
        devices:
          gpus:
            - name: gpu1
              deviceName: nvidia.com/gpu
          disks:
            - name: rootdisk
              disk:
                bus: virtio
      volumes:
        - name: rootdisk
          dataVolume:
            name: gpu-vm-rootdisk
```

### Containerized Data Importer (CDI)

CDI automates importing disk images into PersistentVolumes for use as VM root disks:

```yaml
apiVersion: cdi.kubevirt.io/v1beta1
kind: DataVolume
metadata:
  name: gpu-vm-rootdisk
spec:
  source:
    http:
      url: "https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img"
  pvc:
    accessModes:
      - ReadWriteOnce
    resources:
      requests:
        storage: 100Gi
    storageClassName: ceph-block
```

CDI downloads the image, converts it to raw format, and stores it in a Ceph-backed PV. The VM boots from this disk.

> See `deploy/kubevirt/` for KubeVirt deployment manifests.

---

## 9. Runtime Sandboxing — gVisor

### Role

gVisor provides an additional layer of isolation for container workloads by intercepting system calls in a user-space kernel. This reduces the kernel attack surface without requiring full VM overhead.

### RuntimeClass Configuration

gVisor is configured as a Kubernetes `RuntimeClass`. Workloads opt in by specifying the RuntimeClass in their pod spec.

```yaml
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor
handler: runsc
scheduling:
  nodeSelector:
    gvisor.io/enabled: "true"
```

### Usage

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: sandboxed-workload
spec:
  runtimeClassName: gvisor
  containers:
    - name: app
      image: my-app:latest
```

### Limitations

- **No GPU support** — gVisor does not support GPU passthrough. GPU workloads must use the standard runc runtime.
- **Performance overhead** — system call interception adds latency. Not suitable for performance-sensitive workloads.
- **Syscall coverage** — not all Linux system calls are implemented. Some applications may not work.

gVisor is best suited for untrusted, non-GPU tenant workloads where the additional isolation is worth the performance trade-off.

> See `deploy/kubevirt/gvisor-runtimeclass.yaml` for the RuntimeClass manifest.

---

## 10. Security Hardening

Layer 1 applies defense-in-depth across the OS, network, and runtime layers.

### Flatcar Immutable OS

Flatcar's immutable design provides the first security boundary:

- **Read-only root filesystem** — the OS cannot be tampered with at runtime
- **Atomic updates** — OS updates are applied as a whole image, not package-by-package. Rollback is automatic if the update fails.
- **Minimal attack surface** — no package manager, no SSH by default (configurable), no unnecessary services
- **Auto-update** — Flatcar checks for updates and applies them in a rolling fashion across the cluster

### WireGuard Encryption

All node-to-node traffic can be encrypted using WireGuard at the OS level or via a dedicated WireGuard mesh (e.g., Netmaker, wg-quick systemd units on Flatcar). This provides transparent encryption for all pod-to-pod communication across nodes without application changes.

Kube-OVN's Geneve tunnels can also be configured to run over encrypted WireGuard interfaces for defense-in-depth.

### etcd Encryption at Rest

Kubernetes secrets and sensitive data in etcd are encrypted at rest:

```yaml
apiVersion: apiserver.config.k8s.io/v1
kind: EncryptionConfiguration
resources:
  - resources:
      - secrets
    providers:
      - aescbc:
          keys:
            - name: key1
              secret: <base64-encoded-key>
      - identity: {}
```

This is configured during kubeadm cluster bootstrap.

### Pod Security Standards

Kubernetes Pod Security Standards (PSS) are enforced at the namespace level:

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: tenant-a
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/warn: restricted
```

The `restricted` profile prevents:
- Running as root
- Privilege escalation
- Host namespace access
- Privileged containers
- Dangerous volume types

GPU and KubeVirt workloads run in namespaces with adjusted policies to allow device access.

### Network Security

- **Vpc-level dataplane isolation** — each tenant gets a dedicated Kube-OVN Vpc with its own OVN logical router
- **Standard NetworkPolicy** — Kubernetes NetworkPolicy supported within each Vpc for fine-grained control
- **No inter-tenant traffic** — VMs on different Vpcs are isolated at the OVN dataplane level, not just policy

### Summary of Security Layers

```
Layer           Mechanism                       Protects Against
──────────────────────────────────────────────────────────────────────
OS              Flatcar immutable root          Host compromise, tampering
Network         WireGuard encryption            Traffic interception
Network         Kube-OVN Vpc isolation          Lateral movement
Data            etcd encryption at rest         Data theft from disk
Runtime         Pod Security Standards          Container breakout
Runtime         gVisor (optional)               Kernel exploits
Secrets         etcd encryption + RBAC          Secret exposure
```

> See `deploy/security/` for security hardening manifests.

---

## 11. Component Summary

### All Layer 1 Components

| Component | Role | License | CNCF Status |
|-----------|------|---------|-------------|
| **Metal3** | Bare metal provisioning | Apache 2.0 | Incubating |
| **Flatcar Container Linux** | Immutable OS | Apache 2.0 | Incubating |
| **Kubernetes** (kubeadm) | Container orchestration | Apache 2.0 | Graduated |
| **Cluster API** | Cluster lifecycle management | Apache 2.0 | — |
| **Kube-OVN** | CNI + Vpc/Subnet tenant isolation + NetworkPolicy | Apache 2.0 | Sandbox |
| **Rook-Ceph** | Block + object storage | Apache 2.0 | Graduated |
| **NVIDIA GPU Operator** | GPU driver + device plugin + monitoring | Apache 2.0 | — |
| **KubeVirt** | VM management on Kubernetes | Apache 2.0 | Incubating |
| **gVisor** | Runtime sandboxing | Apache 2.0 | — |
| **cert-manager** | TLS certificate automation | Apache 2.0 | — |

### License Summary

Every Layer 1 component uses the **Apache 2.0** license. There are no AGPL, BSL, SSPL, or proprietary licenses in the infrastructure layer.

### EU Alignment

Several Layer 1 components have EU origins:

| Component | Origin |
|-----------|--------|
| **Metal3** | Co-maintained by Ericsson (Sweden) |
| **Flatcar** | Created by Kinvolk (Berlin, Germany) |

### Deployment References

| Component | Deploy Path |
|-----------|------------|
| Metal3 | `deploy/metal3/` |
| Management cluster | `deploy/management-cluster/` |
| Workload cluster | `deploy/workload-cluster/` |
| Kube-OVN | `deploy/kube-ovn/` |
| Rook-Ceph | `deploy/storage/` |
| GPU Operator | `deploy/gpu/` |
| KubeVirt | `deploy/kubevirt/` |
| gVisor | `deploy/kubevirt/gvisor-runtimeclass.yaml` |
| Security | `deploy/security/` |

---

## 12. What's Next

Layer 1 produces a **compute-ready Kubernetes cluster** — bare metal servers running Flatcar, orchestrated by Kubernetes, with networking, storage, GPU support, VM capability, and security hardening in place.

This cluster can run workloads, but it is not yet a multi-tenant cloud platform. It has no concept of tenants, no self-service APIs, no identity management, and no billing.

**Layer 2** ([02-platform.md](02-platform.md)) takes this infrastructure and adds:

- **Multi-tenant control plane** — tenant workspaces with API isolation
- **Platform APIs** — high-level Compute, VM, GPU, and Storage APIs for tenants
- **Identity and access** — OIDC authentication, RBAC, workspace provisioning
- **Self-service onboarding** — automatic workspace creation on first login
- **Billing and metering** — usage tracking, quotas, and payment integration
- **CLI and web console** — tenant-facing interfaces
- **Observability** — monitoring, dashboards, and alerting

The boundary between Layer 1 and Layer 2 is clean: Layer 1 owns everything below the Kubernetes API. Layer 2 owns everything above it.

---

*This document is part of the Sovereign Small Cloud Reference Architecture. It will be updated as implementation experience refines the infrastructure layer.*
