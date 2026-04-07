# Sovereign Small Cloud — Deployment Guide

## Deep Dive: Production Deployment of the Reference Architecture

**Version:** 0.1.0-draft
**Date:** 2026-03-26
**Status:** Working Draft

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Deployment Overview](#2-deployment-overview)
3. [Hardware Requirements](#3-hardware-requirements)
4. [Network Architecture](#4-network-architecture)
5. [Phase 1: Bare Metal Provisioning (Metal3 + Flatcar)](#5-phase-1-bare-metal-provisioning-metal3--flatcar)
6. [Phase 2: Management Cluster Bootstrap](#6-phase-2-management-cluster-bootstrap)
7. [Phase 3: Workload Cluster Provisioning (Cluster API)](#7-phase-3-workload-cluster-provisioning-cluster-api)
8. [Phase 4: kcp Control Plane](#8-phase-4-kcp-control-plane)
9. [Phase 5: Identity — Zitadel](#9-phase-5-identity--zitadel)
10. [Phase 6: Networking — Kube-OVN](#10-phase-6-networking--kube-ovn)
11. [Phase 7: Storage — Rook-Ceph](#11-phase-7-storage--rook-ceph)
12. [Phase 8: GPU Stack — NVIDIA GPU Operator + Kueue](#12-phase-8-gpu-stack--nvidia-gpu-operator--kueue)
13. [Phase 9: VM Support — KubeVirt](#13-phase-9-vm-support--kubevirt)
14. [Phase 10: Observability — Prometheus + VictoriaMetrics + Grafana](#14-phase-10-observability--prometheus--victoriametrics--grafana)
15. [Phase 11: Metering and Billing — OpenMeter](#15-phase-11-metering-and-billing--openmeter)
16. [Phase 12: Platform APIs and Operators](#16-phase-12-platform-apis-and-operators)
17. [Phase 13: Tenant Onboarding Controller](#17-phase-13-tenant-onboarding-controller)
18. [Phase 14: Quota and Admission Control](#18-phase-14-quota-and-admission-control)
19. [Phase 15: Web Console](#19-phase-15-web-console)
20. [Phase 16: Custom CLI](#20-phase-16-custom-cli)
21. [Phase 17: TLS and DNS](#21-phase-17-tls-and-dns)
22. [Phase 18: Security Hardening](#22-phase-18-security-hardening)
23. [Phase 19: Backup and Disaster Recovery](#23-phase-19-backup-and-disaster-recovery)
24. [Phase 20: Day-2 Operations](#24-phase-20-day-2-operations)
25. [Appendix A: Configuration Reference](#appendix-a-configuration-reference)
26. [Appendix B: Port Matrix](#appendix-b-port-matrix)
27. [Appendix C: Certificate Architecture](#appendix-c-certificate-architecture)

---

## 1. Introduction

This document provides production-grade deployment instructions for the sovereign small cloud reference architecture described in `whitepaper.md`. It assumes familiarity with:

- Kubernetes administration (kubeadm, Helm, kubectl)
- Linux system administration
- Networking fundamentals (VLANs, BGP concepts, DNS)
- Bare metal server management (IPMI/BMC)

**This is NOT the demo guide.** For a quick demo setup, see `demo.md`. This document covers the full production deployment path including Metal3, Flatcar, Rook-Ceph, HA considerations, and security hardening.

### Deployment Personas

| Persona | Responsibilities |
|---------|-----------------|
| **Infrastructure Operator** | Rack hardware, network switches, BMC setup, Metal3 |
| **Platform Operator** | kcp, Zitadel, OpenMeter, operators, day-2 operations |
| **Service Developer** | New platform APIs (CRDs), service operators |

### Time Estimates

| Phase | Duration | Dependencies |
|-------|----------|-------------|
| Hardware racking + network | 1-2 days | Physical access |
| Metal3 + Flatcar setup | 1 day | Hardware ready |
| Management cluster | 2-4 hours | Metal3 or manual OS |
| Workload cluster (CAPI) | 1-2 hours | Management cluster |
| kcp | 2-4 hours | Management cluster |
| Zitadel | 1-2 hours | kcp, DNS |
| Kube-OVN | 1 hour | Both clusters |
| Rook-Ceph | 2-4 hours | Workload cluster, dedicated disks |
| GPU Operator + Kueue | 1-2 hours | Workload cluster, GPU hardware |
| KubeVirt | 1-2 hours | Workload cluster |
| Observability | 1-2 hours | Both clusters |
| OpenMeter | 2-4 hours | Management cluster, Kafka, ClickHouse |
| Platform APIs + operators | 2-4 hours | kcp, workload cluster |
| Console + CLI | 1-2 hours | kcp, Zitadel |
| TLS + DNS | 1-2 hours | cert-manager, domain |
| Security hardening | 2-4 hours | Everything deployed |
| **Total** | **3-5 days** | |

---

## 2. Deployment Overview

### Deployment Order

```
                           +-------------------+
                           |  1. HARDWARE      |
                           |  Rack, cable,     |
                           |  BMC setup        |
                           +---------+---------+
                                     |
                           +---------v---------+
                           |  2. SEED NODE     |
                           |  Manual OS        |
                           |  install on 1     |
                           |  server           |
                           +---------+---------+
                                     |
                           +---------v---------+
                           |  3. METAL3        |
                           |  Deploy Ironic,   |
                           |  BMO, CAPI on     |
                           |  seed node        |
                           +---------+---------+
                                     |
                     +---------------+---------------+
                     |               |               |
              +------v------+ +-----v-----+  +------v------+
              | 4. MGMT     | | 5. WL     |  | 5. WL       |
              | CLUSTER     | | CLUSTER   |  | CLUSTER     |
              | (Metal3     | | NODE 1    |  | NODE N      |
              | provisions) | |           |  |             |
              +------+------+ +-----+-----+  +------+------+
                     |               |               |
                     |         +-----v---------------v-----+
                     |         |  6. WORKLOAD CLUSTER       |
                     |         |  (kubeadm via CAPI)        |
                     |         +----------------------------+
                     |
        +------------+------------------------+
        |            |            |           |
   +----v---+  +----v---+  +----v---+  +---v----+
   | 7. kcp |  | 8. ID  |  | 9. OBS |  |10.BILL|
   |        |  |Zitadel |  |Prom+VM |  |OpenMtr |
   +----+---+  +--------+  +--------+  +--------+
        |
   +----v------------------------------+
   | 11. PLATFORM APIs + OPERATORS      |
   | 12. ONBOARDING CONTROLLER          |
   | 13. QUOTA CONTROLLER               |
   | 14. CONSOLE + CLI                  |
   +------------------------------------+
```

### Cluster Ownership

```
MANAGEMENT CLUSTER owns:                WORKLOAD CLUSTER owns:
---------------------                   ----------------------
kcp (server + front-proxy)              Tenant workload pods
Zitadel (identity)                      KubeVirt VMs
OpenMeter (server + deps)               GPU jobs
Prometheus (federation)                 Kube-OVN (CNI + VirtualNet)
VictoriaMetrics (storage)               NVIDIA GPU Operator
Grafana (dashboards)                    Kueue (scheduler)
Platform operators                      Rook-Ceph (storage)
Metal3 (Ironic, BMO, CAPI)             OpenMeter K8s collector
cert-manager                           Prometheus (local)
Onboarding controller                  DCGM Exporter
Quota controller                       gVisor (RuntimeClass)
Web console
```

---

## 3. Hardware Requirements

### Minimum Production Deployment (2 Racks)

```
RACK 1: MANAGEMENT + CONTROL
-------------------------------------------------------------
Qty  Role                  CPU         RAM    Storage         GPU
---  ----                  ---         ---    -------         ---
3x   Management cluster    8+ cores    64GB   2x500GB NVMe    None
     (HA control plane)                       (OS + etcd)

1x   Network switch        -           -      -               -
     (ToR, 10GbE+)

RACK 2: WORKLOAD + STORAGE
-------------------------------------------------------------
Qty  Role                  CPU         RAM    Storage         GPU
---  ----                  ---         ---    -------         ---
3x   Compute + Storage     16+ cores   128GB  2x500GB NVMe    Optional
     (converged)                              (OS)
                                              4x2TB SSD/NVMe
                                              (Ceph OSD)

2-4x GPU compute           16+ cores   128GB  2x500GB NVMe    2-8x NVIDIA
                                              (OS)            (H100/A100/
                                                               L40S)

1x   Network switch        -           -      -               -
     (ToR, 10GbE+, optional 100GbE for GPU)
```

### BMC Requirements

Every server must have a Baseboard Management Controller accessible over the network:

| Protocol | Versions | Notes |
|----------|----------|-------|
| IPMI | 2.0 | Most common, supported by all server vendors |
| Redfish | 1.0+ | Modern REST API, preferred over IPMI |
| iDRAC | 8+ | Dell servers |
| iLO | 4+ | HPE servers |

Metal3/Ironic supports all of the above via pluggable drivers.

### Network Requirements

| Network | Purpose | Speed | VLAN |
|---------|---------|-------|------|
| BMC/Management | IPMI/Redfish + SSH | 1GbE | VLAN 10 |
| Provisioning | PXE boot + Ironic IPA | 1GbE+ | VLAN 20 |
| Cluster | K8s node-to-node + pod traffic | 10GbE+ | VLAN 30 |
| Storage | Ceph replication | 10GbE+ (dedicated NIC recommended) | VLAN 40 |
| GPU (optional) | InfiniBand/RoCE for RDMA | 100GbE+ / IB HDR | Separate fabric |
| Public | External access | 1GbE+ | VLAN 50 |

Minimum viable: **3 VLANs** (BMC, cluster, public). Storage can share the cluster network for small deployments. Provisioning can share the BMC network if DHCP is carefully scoped.

---

## 4. Network Architecture

### Production Layout

```
                          +----------------+
                          |   Internet     |
                          +-------+--------+
                                  |
                          +-------v--------+
                          |   Firewall/    |
                          |   Router       |
                          |   (BGP peer)   |
                          +-------+--------+
                                  | Public VLAN (50)
                     +------------+------------+
                     |                         |
              +------v------+          +-------v-----+
              |  ToR Switch |          |  ToR Switch  |
              |  Rack 1     |          |  Rack 2      |
              +------+------+          +-------+------+
                     |                         |
          +----------+----------+   +----------+----------+
          |    |    |    |      |   |    |    |    |      |
         Mgmt Mgmt Mgmt       |  Wrk  Wrk  GPU  GPU    |
         1    2    3           |  1    2    1    2      |
                               |                        |
                          Spine / Inter-rack link
                          (10GbE+ LAG or 100GbE)
```

### IP Addressing Plan

```
Network              CIDR              Gateway         DHCP
--------------------------------------------------------------
BMC                  172.16.10.0/24    172.16.10.1     Static
Provisioning         172.16.20.0/24    172.16.20.1     Ironic-managed
Cluster              172.16.30.0/24    172.16.30.1     Static
Storage (Ceph)       172.16.40.0/24    172.16.40.1     Static
Public               203.0.113.0/24    203.0.113.1     Static
K8s Pod CIDR         10.16.0.0/16      -               Kube-OVN
K8s Service CIDR     10.96.0.0/12      -               kube-apiserver
```

### Kube-OVN Configuration

#### Default (Geneve Overlay)

Recommended for initial deployment and environments where underlay routing is not controlled:

```yaml
# kube-ovn-values.yaml
replicaCount: 3
IFACE: "eth0"
POD_CIDR: "10.16.0.0/16"
SVC_CIDR: "10.96.0.0/12"
ENABLE_LB: true
ENABLE_NP: true
```

#### Tenant Virtual Network Example

Each tenant gets a dedicated Vpc and Subnet:

```yaml
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

### Load Balancing (Bare Metal)

Deploy MetalLB alongside Kube-OVN for bare metal LoadBalancer services:

```yaml
# MetalLB L2 advertisement
apiVersion: metallb.io/v1beta1
kind: L2Advertisement
metadata:
  name: default
  namespace: metallb-system
---
# IP pool for LoadBalancer services
apiVersion: metallb.io/v1beta1
kind: IPAddressPool
metadata:
  name: public-pool
  namespace: metallb-system
spec:
  addresses:
    - 203.0.113.128/25  # Allocatable public IPs
```

---

## 5. Phase 1: Bare Metal Provisioning (Metal3 + Flatcar)

### 5.1 Seed Node Preparation

One server must be manually provisioned as the seed node. All other servers are provisioned via Metal3 from this node.

```bash
# Install Flatcar on seed node manually (via ISO or PXE from hosting provider)
# Or install Ubuntu 22.04 as a temporary bootstrap OS

# If using Ubuntu as seed:
apt update && apt upgrade -y

# Install container runtime
apt install -y containerd
mkdir -p /etc/containerd
containerd config default > /etc/containerd/config.toml
sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
systemctl restart containerd && systemctl enable containerd

# Install kubeadm
apt install -y apt-transport-https ca-certificates curl
curl -fsSL https://pkgs.k8s.io/core:/stable:/v1.31/deb/Release.key | \
  gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
echo 'deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] https://pkgs.k8s.io/core:/stable:/v1.31/deb/ /' | \
  tee /etc/apt/sources.list.d/kubernetes.list
apt update && apt install -y kubelet kubeadm kubectl
apt-mark hold kubelet kubeadm kubectl

# Kernel prerequisites
cat <<EOF | tee /etc/modules-load.d/k8s.conf
overlay
br_netfilter
EOF
modprobe overlay && modprobe br_netfilter

cat <<EOF | tee /etc/sysctl.d/k8s.conf
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF
sysctl --system

swapoff -a && sed -i '/swap/d' /etc/fstab

# Bootstrap single-node management cluster
kubeadm init \
  --pod-network-cidr=10.16.0.0/16

mkdir -p ~/.kube && cp /etc/kubernetes/admin.conf ~/.kube/config
kubectl taint nodes --all node-role.kubernetes.io/control-plane-

# Install Kube-OVN
helm repo add kube-ovn https://kubeovn.github.io/kube-ovn
helm install kube-ovn kube-ovn/kube-ovn \
  --namespace kube-system \
  --set IFACE=eth0 \
  --set POD_CIDR=10.16.0.0/16 \
  --set SVC_CIDR=10.96.0.0/12
```

### 5.2 Deploy Metal3

```bash
# Install clusterctl (Cluster API CLI)
curl -L https://github.com/kubernetes-sigs/cluster-api/releases/latest/download/clusterctl-linux-amd64 \
  -o /usr/local/bin/clusterctl
chmod +x /usr/local/bin/clusterctl

# Initialize Cluster API with Metal3 provider
export IRONIC_HOST=172.16.20.10
export IRONIC_HOST_IP=172.16.20.10
export DEPLOY_KERNEL_URL=http://${IRONIC_HOST}:6180/images/ironic-python-agent.kernel
export DEPLOY_RAMDISK_URL=http://${IRONIC_HOST}:6180/images/ironic-python-agent.initramfs

clusterctl init \
  --infrastructure metal3 \
  --bootstrap kubeadm \
  --control-plane kubeadm
```

### 5.3 Configure Ironic

```yaml
# ironic-config.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: ironic-config
  namespace: baremetal-operator-system
data:
  IRONIC_IP: "172.16.20.10"
  DHCP_RANGE: "172.16.20.100,172.16.20.200"
  PROVISIONING_INTERFACE: "eth1"
  IRONIC_INSPECTOR_VLAN_INTERFACES: ""
  IRONIC_KERNEL_PARAMS: "console=ttyS0"
```

### 5.4 Register Bare Metal Hosts

Create a `BareMetalHost` resource for each physical server:

```yaml
# bmh-mgmt-1.yaml
apiVersion: metal3.io/v1alpha1
kind: BareMetalHost
metadata:
  name: mgmt-1
  namespace: metal3
spec:
  online: true
  bootMACAddress: "aa:bb:cc:dd:ee:01"
  bmc:
    address: ipmi://172.16.10.11
    credentialsName: mgmt-1-bmc-secret
  rootDeviceHints:
    deviceName: /dev/sda
---
apiVersion: v1
kind: Secret
metadata:
  name: mgmt-1-bmc-secret
  namespace: metal3
type: Opaque
data:
  username: YWRtaW4=
  password: cGFzc3dvcmQ=
```

Register all hosts:

```bash
for i in $(seq 1 8); do
  kubectl apply -f bmh-node-${i}.yaml
done

# Watch provisioning status
kubectl -n metal3 get baremetalhosts
```

### 5.5 Prepare Flatcar Image

```bash
FLATCAR_VERSION="3815.2.0"
wget https://stable.release.flatcar-linux.net/amd64-usr/${FLATCAR_VERSION}/flatcar_production_openstack_image.img.gz
gunzip flatcar_production_openstack_image.img.gz
cp flatcar_production_openstack_image.img /var/lib/ironic/images/
md5sum /var/lib/ironic/images/flatcar_production_openstack_image.img
```

---

## 6. Phase 2: Management Cluster Bootstrap

### 6.1 Define Management Cluster via CAPI

```yaml
# mgmt-cluster.yaml
apiVersion: cluster.x-k8s.io/v1beta1
kind: Cluster
metadata:
  name: management
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
    name: management-cp
  infrastructureRef:
    apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
    kind: Metal3Cluster
    name: management
---
apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
kind: Metal3Cluster
metadata:
  name: management
  namespace: metal3
spec:
  controlPlaneEndpoint:
    host: 172.16.30.10
    port: 6443
  noCloudProvider: true
---
apiVersion: controlplane.cluster.x-k8s.io/v1beta1
kind: KubeadmControlPlane
metadata:
  name: management-cp
  namespace: metal3
spec:
  replicas: 3
  version: v1.31.0
  machineTemplate:
    infrastructureRef:
      apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
      kind: Metal3MachineTemplate
      name: management-cp
  kubeadmConfigSpec:
    initConfiguration:
      nodeRegistration:
        kubeletExtraArgs:
          node-labels: "role=management"
    joinConfiguration:
      nodeRegistration:
        kubeletExtraArgs:
          node-labels: "role=management"
    preKubeadmCommands:
      - systemctl enable --now containerd
    postKubeadmCommands:
      - echo "Management node ready"
---
apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
kind: Metal3MachineTemplate
metadata:
  name: management-cp
  namespace: metal3
spec:
  template:
    spec:
      image:
        url: http://172.16.20.10:6180/images/flatcar_production_openstack_image.img
        checksum: http://172.16.20.10:6180/images/flatcar_production_openstack_image.img.md5sum
        checksumType: md5
        format: raw
      hostSelector:
        matchLabels:
          role: management
```

### 6.2 Apply and Wait

```bash
kubectl apply -f mgmt-cluster.yaml

# Watch provisioning (typically 15-30 minutes)
watch kubectl -n metal3 get baremetalhosts,machines,clusters

# Get management cluster kubeconfig
clusterctl get kubeconfig management -n metal3 > management.kubeconfig
```

### 6.3 Pivot (Move CAPI to Management Cluster)

Once the management cluster is running, move the Metal3/CAPI controllers from the seed node:

```bash
# Initialize CAPI on the management cluster
clusterctl init \
  --kubeconfig=management.kubeconfig \
  --infrastructure metal3 \
  --bootstrap kubeadm \
  --control-plane kubeadm

# Move all CAPI resources from seed to management
clusterctl move \
  --to-kubeconfig=management.kubeconfig \
  --namespace metal3

# The seed node can now be repurposed or decommissioned
```

---

## 7. Phase 3: Workload Cluster Provisioning (Cluster API)

### 7.1 Define Workload Cluster

```yaml
# workload-cluster.yaml
apiVersion: cluster.x-k8s.io/v1beta1
kind: Cluster
metadata:
  name: workload-1
  namespace: metal3
spec:
  clusterNetwork:
    pods:
      cidrBlocks: ["10.245.0.0/16"]
    services:
      cidrBlocks: ["10.97.0.0/16"]
  controlPlaneRef:
    apiVersion: controlplane.cluster.x-k8s.io/v1beta1
    kind: KubeadmControlPlane
    name: workload-1-cp
  infrastructureRef:
    apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
    kind: Metal3Cluster
    name: workload-1
---
apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
kind: Metal3Cluster
metadata:
  name: workload-1
  namespace: metal3
spec:
  controlPlaneEndpoint:
    host: 172.16.30.20
    port: 6443
  noCloudProvider: true
---
apiVersion: controlplane.cluster.x-k8s.io/v1beta1
kind: KubeadmControlPlane
metadata:
  name: workload-1-cp
  namespace: metal3
spec:
  replicas: 1
  version: v1.31.0
  machineTemplate:
    infrastructureRef:
      apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
      kind: Metal3MachineTemplate
      name: workload-1-cp
  kubeadmConfigSpec:
    initConfiguration:
      nodeRegistration:
        kubeletExtraArgs:
          node-labels: "role=workload"
    preKubeadmCommands:
      - systemctl enable --now containerd
```

### 7.2 GPU Worker Nodes

```yaml
# workload-gpu-workers.yaml
apiVersion: cluster.x-k8s.io/v1beta1
kind: MachineDeployment
metadata:
  name: workload-1-gpu
  namespace: metal3
spec:
  clusterName: workload-1
  replicas: 2
  selector:
    matchLabels:
      nodepool: gpu
  template:
    metadata:
      labels:
        nodepool: gpu
    spec:
      clusterName: workload-1
      version: v1.31.0
      bootstrap:
        configRef:
          apiVersion: bootstrap.cluster.x-k8s.io/v1beta1
          kind: KubeadmConfigTemplate
          name: workload-1-gpu
      infrastructureRef:
        apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
        kind: Metal3MachineTemplate
        name: workload-1-gpu
---
apiVersion: infrastructure.cluster.x-k8s.io/v1beta1
kind: Metal3MachineTemplate
metadata:
  name: workload-1-gpu
  namespace: metal3
spec:
  template:
    spec:
      image:
        url: http://172.16.20.10:6180/images/flatcar_production_openstack_image.img
        checksum: http://172.16.20.10:6180/images/flatcar_production_openstack_image.img.md5sum
        checksumType: md5
        format: raw
      hostSelector:
        matchLabels:
          feature: gpu
---
apiVersion: bootstrap.cluster.x-k8s.io/v1beta1
kind: KubeadmConfigTemplate
metadata:
  name: workload-1-gpu
  namespace: metal3
spec:
  template:
    spec:
      joinConfiguration:
        nodeRegistration:
          kubeletExtraArgs:
            node-labels: "gpu=true,nodepool=gpu"
      preKubeadmCommands:
        - systemctl enable --now containerd
```

### 7.3 Apply and Verify

```bash
export KUBECONFIG=management.kubeconfig

kubectl apply -f workload-cluster.yaml
kubectl apply -f workload-gpu-workers.yaml

watch kubectl -n metal3 get clusters,machines,baremetalhosts

clusterctl get kubeconfig workload-1 -n metal3 > workload-1.kubeconfig

kubectl --kubeconfig=workload-1.kubeconfig get nodes
```

---

## 8. Phase 4: kcp Control Plane

### 8.1 Deploy kcp via kcp-operator

```bash
export KUBECONFIG=management.kubeconfig

kubectl create namespace kcp-system

helm repo add kcp https://kcp-dev.github.io/helm-charts
helm install kcp-operator kcp/kcp-operator \
  --namespace kcp-system
```

### 8.2 Create kcp Installation

```yaml
# kcp-installation.yaml
apiVersion: operator.kcp.io/v1alpha1
kind: RootShard
metadata:
  name: root
  namespace: kcp-system
spec:
  external:
    hostname: kcp.demo.example.com
    port: 443
  etcd:
    embedded: true
  oidc:
    issuerURL: https://auth.demo.example.com
    clientID: kcp
    groupsClaim: "urn:zitadel:iam:org:project:roles"
    usernameClaim: email
---
apiVersion: operator.kcp.io/v1alpha1
kind: FrontProxy
metadata:
  name: front-proxy
  namespace: kcp-system
spec:
  rootShard:
    name: root
  external:
    hostname: kcp.demo.example.com
    port: 443
  replicas: 2
---
apiVersion: operator.kcp.io/v1alpha1
kind: Kubeconfig
metadata:
  name: admin
  namespace: kcp-system
spec:
  target:
    name: front-proxy
    kind: FrontProxy
```

### 8.3 Apply and Verify

```bash
kubectl apply -f kcp-installation.yaml
kubectl -n kcp-system get pods -w

kubectl -n kcp-system get secret admin-kubeconfig \
  -o jsonpath='{.data.kubeconfig}' | base64 -d > kcp-admin.kubeconfig

KUBECONFIG=kcp-admin.kubeconfig kubectl ws tree
```

### 8.4 Create Platform Workspace

```bash
export KUBECONFIG=kcp-admin.kubeconfig
kubectl ws create platform --type=universal --enter
```

---

## 9. Phase 5: Identity -- Zitadel

### 9.1 Deploy PostgreSQL

```bash
export KUBECONFIG=management.kubeconfig
kubectl create namespace zitadel

kubectl -n zitadel create secret generic postgres-credentials \
  --from-literal=password="$(openssl rand -base64 24)"

helm repo add bitnami https://charts.bitnami.com/bitnami
helm install zitadel-db bitnami/postgresql \
  --namespace zitadel \
  --set auth.existingSecret=postgres-credentials \
  --set auth.database=zitadel \
  --set primary.persistence.size=10Gi
```

### 9.2 Deploy Zitadel

```bash
helm repo add zitadel https://charts.zitadel.com

helm install zitadel zitadel/zitadel \
  --namespace zitadel \
  --set zitadel.masterkey="$(openssl rand -hex 16)" \
  --set zitadel.configmapConfig.ExternalDomain=auth.demo.example.com \
  --set zitadel.configmapConfig.ExternalPort=443 \
  --set zitadel.configmapConfig.ExternalSecure=true \
  --set zitadel.configmapConfig.Database.Postgres.Host=zitadel-db-postgresql \
  --set zitadel.configmapConfig.Database.Postgres.Port=5432 \
  --set zitadel.configmapConfig.Database.Postgres.Database=zitadel \
  --set replicaCount=2
```

### 9.3 Configure OIDC Providers

After Zitadel is running, configure via admin console at `https://auth.demo.example.com/ui/console`:

1. Create GitHub Identity Provider (Client ID + Secret from GitHub OAuth app)
2. Create Google Identity Provider (Client ID + Secret from Google Cloud Console)
3. Create OIDC Application for kcp (Web type, authorization code flow)
4. Create OIDC Application for CLI (Native type, device authorization grant)

---

## 10. Phase 6: Networking -- Kube-OVN

### 10.1 Install on Workload Cluster

```bash
export KUBECONFIG=workload-1.kubeconfig

helm repo add kube-ovn https://kubeovn.github.io/kube-ovn
helm install kube-ovn kube-ovn/kube-ovn \
  --namespace kube-system \
  --set IFACE=eth0 \
  --set POD_CIDR=10.16.0.0/16 \
  --set SVC_CIDR=10.96.0.0/12 \
  --set ENABLE_LB=true \
  --set ENABLE_NP=true
```

### 10.2 Configure Gateway API

Deploy a separate Gateway API implementation (e.g., Envoy Gateway):

```yaml
# platform-gateway.yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: platform
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
          - name: platform-tls
      allowedRoutes:
        namespaces:
          from: All
    - name: http
      protocol: HTTP
      port: 80
      allowedRoutes:
        namespaces:
          from: All
```

### 10.3 Tenant Virtual Network Setup

The platform controller creates a Kube-OVN Vpc and Subnet per tenant. Tenant KubeVirt VMs connect only to their Vpc — no access to the default pod network.

```yaml
# Created by onboarding controller for each tenant
apiVersion: kubeovn.io/v1
kind: Vpc
metadata:
  name: "TENANT_NAMESPACE-vpc"
spec:
  namespaces:
    - "TENANT_NAMESPACE"
---
apiVersion: kubeovn.io/v1
kind: Subnet
metadata:
  name: "TENANT_NAMESPACE-net"
spec:
  vpc: "TENANT_NAMESPACE-vpc"
  cidrBlock: 10.0.0.0/24    # Managed by platform, can overlap across tenants
  protocol: IPv4
  namespaces:
    - "TENANT_NAMESPACE"
```

---

## 11. Phase 7: Storage -- Rook-Ceph

### 11.1 Deploy Rook Operator

```bash
export KUBECONFIG=workload-1.kubeconfig

helm repo add rook-release https://charts.rook.io/release

helm install rook-ceph rook-release/rook-ceph \
  --namespace rook-ceph \
  --create-namespace \
  --set csi.enableRbdDriver=true \
  --set csi.enableCephfsDriver=true
```

### 11.2 Create Ceph Cluster

```yaml
# ceph-cluster.yaml
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
  mgr:
    count: 2
  dashboard:
    enabled: true
  storage:
    useAllNodes: false
    useAllDevices: false
    nodes:
      - name: "cpu-node-1"
        devices:
          - name: "sdb"
          - name: "sdc"
      - name: "cpu-node-2"
        devices:
          - name: "sdb"
          - name: "sdc"
      - name: "cpu-node-3"
        devices:
          - name: "sdb"
          - name: "sdc"
```

### 11.3 Create Storage Classes

```yaml
# Block storage
apiVersion: ceph.rook.io/v1
kind: CephBlockPool
metadata:
  name: replicated-pool
  namespace: rook-ceph
spec:
  failureDomain: host
  replicated:
    size: 3
---
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: ceph-block
  annotations:
    storageclass.kubernetes.io/is-default-class: "true"
provisioner: rook-ceph.rbd.csi.ceph.com
parameters:
  clusterID: rook-ceph
  pool: replicated-pool
  imageFormat: "2"
  imageFeatures: layering
  csi.storage.k8s.io/provisioner-secret-name: rook-csi-rbd-provisioner
  csi.storage.k8s.io/provisioner-secret-namespace: rook-ceph
  csi.storage.k8s.io/node-stage-secret-name: rook-csi-rbd-node
  csi.storage.k8s.io/node-stage-secret-namespace: rook-ceph
reclaimPolicy: Delete
allowVolumeExpansion: true
```

### 11.4 Object Storage (S3)

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

---

## 12. Phase 8: GPU Stack -- NVIDIA GPU Operator + Kueue

### 12.1 NVIDIA GPU Operator

```bash
export KUBECONFIG=workload-1.kubeconfig

helm repo add nvidia https://helm.ngc.nvidia.com/nvidia

helm install gpu-operator nvidia/gpu-operator \
  --namespace gpu-operator \
  --create-namespace \
  --set driver.enabled=true \
  --set toolkit.enabled=true \
  --set devicePlugin.enabled=true \
  --set dcgmExporter.enabled=true \
  --set gfd.enabled=true \
  --set mig.strategy=none
```

### 12.2 Verify GPU Detection

```bash
kubectl -n gpu-operator get pods -w

kubectl get nodes -o json | \
  jq '.items[] | {name: .metadata.name, gpus: .status.capacity["nvidia.com/gpu"]}'
```

### 12.3 Kueue

```bash
kubectl apply --server-side \
  -f https://github.com/kubernetes-sigs/kueue/releases/latest/download/manifests.yaml
```

### 12.4 Configure Kueue Resources

```yaml
apiVersion: kueue.x-k8s.io/v1beta1
kind: ResourceFlavor
metadata:
  name: gpu-nodes
spec:
  nodeLabels:
    gpu: "true"
---
apiVersion: kueue.x-k8s.io/v1beta1
kind: ClusterQueue
metadata:
  name: platform-queue
spec:
  namespaceSelector: {}
  resourceGroups:
    - coveredResources: ["cpu", "memory"]
      flavors:
        - name: cpu-nodes
          resources:
            - name: cpu
              nominalQuota: 100
            - name: memory
              nominalQuota: 500Gi
    - coveredResources: ["nvidia.com/gpu"]
      flavors:
        - name: gpu-nodes
          resources:
            - name: nvidia.com/gpu
              nominalQuota: 4
```

---

## 13. Phase 9: VM Support -- KubeVirt

### 13.1 Install KubeVirt

```bash
export KUBECONFIG=workload-1.kubeconfig

export KUBEVIRT_VERSION=$(curl -s https://api.github.com/repos/kubevirt/kubevirt/releases/latest | jq -r .tag_name)

kubectl apply -f https://github.com/kubevirt/kubevirt/releases/download/${KUBEVIRT_VERSION}/kubevirt-operator.yaml

kubectl apply -f - <<EOF
apiVersion: kubevirt.io/v1
kind: KubeVirt
metadata:
  name: kubevirt
  namespace: kubevirt
spec:
  configuration:
    developerConfiguration:
      featureGates:
        - GPU
        - HostDevices
    permittedHostDevices:
      pciHostDevices:
        - pciVendorSelector: "10DE:*"
          resourceName: nvidia.com/gpu
EOF

# Install CDI for VM disk images
export CDI_VERSION=$(curl -s https://api.github.com/repos/kubevirt/containerized-data-importer/releases/latest | jq -r .tag_name)
kubectl apply -f https://github.com/kubevirt/containerized-data-importer/releases/download/${CDI_VERSION}/cdi-operator.yaml
kubectl apply -f https://github.com/kubevirt/containerized-data-importer/releases/download/${CDI_VERSION}/cdi-cr.yaml
```

### 13.2 gVisor RuntimeClass

```yaml
apiVersion: node.k8s.io/v1
kind: RuntimeClass
metadata:
  name: gvisor
handler: runsc
scheduling:
  nodeSelector:
    nodepool: cpu
```

---

## 14. Phase 10: Observability -- Prometheus + VictoriaMetrics + Grafana

### 14.1 Workload Cluster: Prometheus

```bash
export KUBECONFIG=workload-1.kubeconfig

helm repo add prometheus-community https://prometheus-community.github.io/helm-charts

helm install prometheus prometheus-community/kube-prometheus-stack \
  --namespace monitoring \
  --create-namespace \
  --set prometheus.prometheusSpec.retention=24h \
  --set prometheus.prometheusSpec.remoteWrite[0].url=http://victoria-metrics.management:8428/api/v1/write \
  --set grafana.enabled=false \
  --set alertmanager.enabled=false
```

### 14.2 Management Cluster: VictoriaMetrics + Grafana

```bash
export KUBECONFIG=management.kubeconfig

helm repo add vm https://victoriametrics.github.io/helm-charts/
helm install victoria-metrics vm/victoria-metrics-single \
  --namespace monitoring \
  --create-namespace \
  --set server.persistentVolume.size=100Gi \
  --set server.retentionPeriod=90d

helm repo add grafana https://grafana.github.io/helm-charts
helm install grafana grafana/grafana \
  --namespace monitoring \
  --set persistence.enabled=true \
  --set persistence.size=5Gi
```

---

## 15. Phase 11: Metering and Billing -- OpenMeter

### 15.1 Deploy Dependencies

```bash
export KUBECONFIG=management.kubeconfig
kubectl create namespace openmeter

# Redpanda (Kafka-compatible)
helm repo add redpanda https://charts.redpanda.com
helm install redpanda redpanda/redpanda \
  --namespace openmeter \
  --set statefulset.replicas=1 \
  --set storage.persistentVolume.size=20Gi

# ClickHouse
helm repo add clickhouse https://charts.clickhouse.com
helm install clickhouse clickhouse/clickhouse \
  --namespace openmeter \
  --set shards=1 \
  --set replicas=1 \
  --set persistence.size=50Gi

# PostgreSQL
helm install openmeter-db bitnami/postgresql \
  --namespace openmeter \
  --set auth.database=openmeter \
  --set primary.persistence.size=10Gi
```

### 15.2 Deploy OpenMeter

```bash
helm repo add openmeter https://openmeter.github.io/helm-charts

helm install openmeter openmeter/openmeter \
  --namespace openmeter \
  --values openmeter-values.yaml
```

Configure meters for CPU, memory, and GPU usage. Deploy the K8s collector DaemonSet on the workload cluster. Configure billing plans (free, pay-as-you-go, prepaid, enterprise) via the OpenMeter API.

See `whitepaper.md` Section 14 for meter definitions and billing plan configuration details.

---

## 16. Phase 12: Platform APIs and Operators

### 16.1 Define APIs in kcp

Create APIResourceSchemas and APIExports in the platform workspace for:
- `Compute` (container workloads)
- `VirtualMachine` (KubeVirt VMs)
- `Notebook` (Jupyter notebooks)
- `Volume` (block storage)
- `ObjectBucket` (S3 buckets)

See `whitepaper.md` Section 10 for full API schemas.

### 16.2 Deploy Service Operators

Each operator runs on the management cluster with:
- kcp kubeconfig (virtual workspace access)
- Workload cluster kubeconfig
- OpenMeter credentials (for usage event emission)

Operator reconciliation pattern:
1. Watch virtual workspace for tenant resource changes
2. Create/update workloads in tenant namespace on workload cluster
3. Update resource status back in kcp
4. Emit usage events to OpenMeter

---

## 17. Phase 13: Tenant Onboarding Controller

Watches for new kcp users and provisions:
1. kcp workspace with APIBindings
2. RBAC (user = workspace admin)
3. Default ResourceQuota (free tier)
4. OpenMeter customer + subscription
5. Kueue LocalQueue on workload cluster
6. Kube-OVN Vpc + Subnet in tenant namespace

---

## 18. Phase 14: Quota and Admission Control

kcp validating webhook that checks OpenMeter entitlements before allowing resource creation. Denies requests with clear error messages when quotas are exceeded, directing users to upgrade their plan.

---

## 19. Phase 15: Web Console

Single-page application talking to kcp (resource CRUD), Zitadel (auth), and OpenMeter (billing). Deployed as a static site on the management cluster.

---

## 20. Phase 16: Custom CLI

Go binary providing: `cloud login`, `cloud ssh`, `cloud status`, `cloud kubeconfig`, and resource management commands. Uses Zitadel device authorization grant for authentication and gRPC tunneling for SSH access.

---

## 21. Phase 17: TLS and DNS

### 21.1 cert-manager + Let's Encrypt

```bash
export KUBECONFIG=management.kubeconfig

helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --set crds.enabled=true

kubectl apply -f - <<EOF
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@demo.example.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            ingressClassName: envoy
EOF
```

### 21.2 Required DNS Records

```
kcp.demo.example.com           A    <management-public-ip>
auth.demo.example.com          A    <management-public-ip>
console.demo.example.com       A    <management-public-ip>
grafana.demo.example.com       A    <management-public-ip>
tunnel.demo.example.com        A    <management-public-ip>
*.tenant.demo.example.com      A    <workload-public-ip>
```

---

## 22. Phase 18: Security Hardening

### Checklist

- [ ] WireGuard encryption enabled (inter-node traffic)
- [ ] etcd encryption at rest (kcp + workload cluster)
- [ ] RBAC audit logging on kcp
- [ ] Pod Security Standards enforced (restricted baseline)
- [ ] Default-deny NetworkPolicies on all namespaces
- [ ] Secrets encrypted with external KMS or sealed-secrets
- [ ] Container images from trusted registries only
- [ ] Flatcar auto-updates configured
- [ ] BMC credentials rotated and stored securely
- [ ] All default passwords changed
- [ ] Default ServiceAccount tokens disabled
- [ ] Resource limits set on all platform components

---

## 23. Phase 19: Backup and Disaster Recovery

### What to Back Up

| Component | Method | Frequency |
|-----------|--------|-----------|
| kcp etcd | etcd snapshot | Hourly |
| Zitadel PostgreSQL | pg_dump | Every 6 hours |
| OpenMeter PostgreSQL | pg_dump | Every 6 hours |
| OpenMeter ClickHouse | ClickHouse backup | Daily |
| Rook-Ceph | Ceph snapshots + Velero | Continuous |
| Workload cluster etcd | etcd snapshot | Hourly |
| Grafana dashboards | GitOps (provisioning) | On change |

### Velero

```bash
helm install velero vmware-tanzu/velero \
  --namespace velero \
  --create-namespace \
  --set configuration.backupStorageLocation[0].provider=aws \
  --set configuration.backupStorageLocation[0].bucket=backups \
  --set configuration.backupStorageLocation[0].config.s3Url=http://rook-ceph-rgw.rook-ceph:80
```

---

## 24. Phase 20: Day-2 Operations

### Adding New Nodes

```bash
# Scale GPU pool
kubectl --kubeconfig=management.kubeconfig \
  -n metal3 patch machinedeployment workload-1-gpu \
  --type=merge -p '{"spec":{"replicas":4}}'
```

### Kubernetes Upgrades

```bash
# Rolling upgrade via CAPI
kubectl --kubeconfig=management.kubeconfig \
  -n metal3 patch kubeadmcontrolplane workload-1-cp \
  --type=merge -p '{"spec":{"version":"v1.32.0"}}'
```

### Adding a New Service Type

1. Define new APIResourceSchema + APIExport in kcp platform workspace
2. Deploy operator on management cluster
3. Update onboarding controller to auto-bind new API for new tenants

### Key Alerts

- kcp control plane down
- GPU node not ready
- Ceph health degraded
- Tenant quota at 90%
- OpenMeter event ingestion stopped

---

## Appendix A: Configuration Reference

### Helm Chart Versions (Tested)

| Chart | Version | Repository |
|-------|---------|-----------|
| kube-ovn | 1.13.x | kubeovn.github.io/kube-ovn |
| kcp-operator | 0.x.x | kcp-dev.github.io/helm-charts |
| zitadel | 8.x.x | charts.zitadel.com |
| rook-ceph | 1.15.x | charts.rook.io/release |
| gpu-operator | 24.x.x | helm.ngc.nvidia.com/nvidia |
| openmeter | 0.x.x | openmeter.github.io/helm-charts |
| victoria-metrics-single | 0.x.x | victoriametrics.github.io/helm-charts |
| grafana | 8.x.x | grafana.github.io/helm-charts |
| kube-prometheus-stack | 65.x.x | prometheus-community.github.io/helm-charts |

---

## Appendix B: Port Matrix

### Management Cluster

| Port | Protocol | Component | Purpose |
|------|----------|-----------|---------|
| 6443 | TCP | kube-apiserver | K8s API |
| 443 | TCP | kcp front-proxy | Tenant API access |
| 443 | TCP | Zitadel | OIDC endpoints |
| 443 | TCP | Web console | UI |
| 443 | TCP | Grafana | Dashboards |
| 8443 | TCP | Tunnel service | CLI SSH tunnels |
| 8888 | TCP | OpenMeter | Metering API (internal) |

### Workload Cluster

| Port | Protocol | Component | Purpose |
|------|----------|-----------|---------|
| 6443 | TCP | kube-apiserver | K8s API (internal) |
| 443 | TCP | Ingress Gateway | Tenant HTTPS workloads |
| 9090 | TCP | Prometheus | Metrics (internal) |
| 9400 | TCP | DCGM Exporter | GPU metrics (internal) |

### Infrastructure

| Port | Protocol | Component | Purpose |
|------|----------|-----------|---------|
| 623 | UDP | IPMI | BMC management |
| 443 | TCP | Redfish | BMC management |
| 69 | UDP | TFTP | PXE boot |
| 6180 | TCP | Ironic | Image server |

---

## Appendix C: Certificate Architecture

```
Root CA (kcp)
+-- kcp server certificate
+-- kcp front-proxy client certificate
+-- kcp service account signing key
+-- Kubeconfig client certificates

Let's Encrypt (public-facing)
+-- kcp.demo.example.com
+-- auth.demo.example.com
+-- console.demo.example.com
+-- grafana.demo.example.com
+-- *.tenant.demo.example.com
+-- tunnel.demo.example.com

Kubernetes CAs (per cluster)
+-- Management cluster CA
|   +-- kube-apiserver serving cert
|   +-- kubelet client certs
|   +-- etcd peer/client certs
+-- Workload cluster CA
    +-- kube-apiserver serving cert
    +-- kubelet client certs
    +-- etcd peer/client certs

Ceph (internal)
+-- Ceph monitor certificates
+-- RGW (S3) TLS certificate
```

cert-manager manages all Let's Encrypt certificates with automatic renewal. Kubernetes and kcp CAs are generated during cluster bootstrap. Ceph certificates are managed by Rook.

---

*This document will be updated with tested configurations, exact Helm values, and operator source code as implementation progresses.*
