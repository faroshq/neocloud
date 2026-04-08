# Sovereign Small Cloud — Demo Guide

## Practical Setup for the Reference Architecture

**Version:** 0.1.0-draft
**Date:** 2026-03-26
**Status:** Working Draft

---

## Table of Contents

1. [Overview](#1-overview)
2. [Demo vs Production](#2-demo-vs-production)
3. [Environment Options](#3-environment-options)
4. [Recommended Demo Environment](#4-recommended-demo-environment)
5. [Prerequisites](#5-prerequisites)
6. [Phase 1: Infrastructure Bootstrap](#6-phase-1-infrastructure-bootstrap)
7. [Phase 2: Platform Core](#7-phase-2-platform-core)
8. [Phase 3: Identity and Access](#8-phase-3-identity-and-access)
9. [Phase 4: Service Operators](#9-phase-4-service-operators)
10. [Phase 5: Metering and Billing](#10-phase-5-metering-and-billing)
11. [Phase 6: Web Console and CLI](#11-phase-6-web-console-and-cli)
12. [Phase 7: End-to-End Demo Flow](#12-phase-7-end-to-end-demo-flow)
13. [Demo Scenarios](#13-demo-scenarios)
14. [Troubleshooting](#14-troubleshooting)
15. [Appendix: Environment Cost Comparison](#15-appendix-environment-cost-comparison)

---

## 1. Overview

This document provides a practical, step-by-step guide to deploying the sovereign small cloud reference architecture in a demo environment. The demo proves the full tenant lifecycle end-to-end:

1. User signs in via OIDC (Google/GitHub)
2. Workspace auto-provisioned with free tier quotas
3. User creates workloads (compute, notebooks, VMs) via console/CLI
4. Usage metered and displayed in real time
5. Billing integration generates invoices
6. Quotas enforced — exceeding limits produces clear errors

### What the demo includes

| Component | Demo | Production (whitepaper) |
|-----------|------|------------------------|
| kcp (control plane) | Yes | Yes |
| Zitadel (identity) | Yes | Yes |
| OpenMeter (billing) | Yes | Yes |
| Kubernetes (workloads) | kubeadm (manual) | Metal3 + Ubuntu + CAPI |
| GPU workloads | Simulated (or real if available) | NVIDIA GPU Operator |
| KubeVirt (VMs) | Optional | Yes |
| Rook-Ceph (storage) | No (local storage) | Yes |
| Metal3 (bare metal) | No (pre-provisioned) | Yes |
| Kube-OVN | Yes | Yes |
| Prometheus + Grafana | Yes | Yes |
| Web console | Basic | Full |
| Custom CLI | Basic | Full |

### What the demo skips

- Metal3 bare metal provisioning (machines pre-provisioned)
- Rook-Ceph storage (uses local disk / hostPath)
- GPU sharing (whole GPU or simulated)
- Multi-node GPU training
- Production HA (single-replica everything)
- Advanced network topologies (overlay only)

---

## 2. Demo vs Production

```
                      DEMO                          PRODUCTION
                      ────                          ──────────
Bare metal            Pre-provisioned servers       Metal3 + Ubuntu + CAPI
                      Ubuntu manually               PXE boot, automated lifecycle
                      installed

Kubernetes            kubeadm (manual bootstrap)    kubeadm via CAPI
                                                    (declarative, automated)

Cluster topology      1 management + 2 workload     1 management + N workload
                      (or all-in-one for minimal)   (separate failure domains)

Storage               hostPath / local-path          Rook-Ceph (block + object)
                      provisioner

GPU                   Real GPU if available,         NVIDIA GPU Operator
                      or simulated via resource      MIG/whole GPU allocation
                      spoofing

HA                    Single replica                 Multi-replica, anti-affinity
                      (kcp, Zitadel, OpenMeter)      Sharded kcp if needed

TLS                   Self-signed or Let's Encrypt   Let's Encrypt + cert-manager
                      (if public DNS available)

DNS                   nip.io / manual /etc/hosts     External-DNS + real domain
```

---

## 3. Environment Options

### Option A: Cherry Servers — Full Bare Metal (Recommended)

Best for demonstrating the full story including IPMI/BMC capabilities.

```
Servers:  3x Cherry Servers CPU-only
          E3-1240V5, 32GB RAM, 2×SSD, IPMI
          Location: Lithuania (EU)

Layout:   1x management cluster
          2x workload cluster nodes

Cost:     3 × €59 = €177/mo (~$195/mo)

Add GPU:  +2x servers with Tesla P4 GPU (~$480/mo extra)
          Total with GPU: ~$675/mo
```

**Pros:** Real bare metal, IPMI for Metal3 experimentation, EU-based, affordable
**Cons:** Setup time, need to manage hardware

### Option B: Hetzner — Beefier CPU Servers

```
Servers:  3x Hetzner AX42
          Ryzen 7 PRO 8700GE, 64GB DDR5, 2×512GB NVMe
          Location: Germany (EU)

Layout:   1x management cluster
          2x workload cluster nodes

Cost:     3 × €46 = €138/mo (~$150/mo) + €117 setup

Add GPU:  +2x GEX44 with RTX 4000 SFF Ada 20GB (~€368/mo extra)
```

**Pros:** Better hardware specs, German datacenter
**Cons:** IPMI access needs verification for Metal3

### Option C: Cloud VMs (Cheapest)

```
VMs:      5x Hetzner Cloud CPX31
          4 vCPU, 8GB RAM, 160GB SSD

Layout:   1x management + 4x workload (or 3 total)

Cost:     5 × €15 = €75/mo (~$82/mo)
          3-node: 3 × €15 = €45/mo (~$50/mo)
```

**Pros:** Cheapest, fastest to set up, no hardware concerns
**Cons:** No bare metal, no IPMI, no GPU, can't demo Metal3

### Option D: Local Development

```
Setup:    kind / k3d clusters on a workstation
          3+ clusters (1 management, 2 workload)

Cost:     $0

Requirements: 16GB+ RAM, 8+ CPU cores
```

**Pros:** Free, fast iteration, works offline
**Cons:** Not representative, no real networking, no GPU

### Option E: Hybrid (Recommended for Development)

```
Development:  Local (Option D) for fast iteration
Demo:         Cherry Servers (Option A) for presentations
```

---

## 4. Recommended Demo Environment

For a compelling live demo, we recommend **Option A (Cherry Servers)** with 3 CPU-only servers initially. GPU servers added when needed.

### Server Layout

```
┌──────────────────────────────────────────────────────────────┐
│  Server 1: MANAGEMENT CLUSTER                                 │
│  Cherry Servers E3-1240V5, 32GB, 2×SSD                       │
│                                                               │
│  Components:                                                  │
│  ├── Kubernetes control plane (kubeadm)                      │
│  ├── kcp (server + front-proxy)                              │
│  ├── Zitadel                                                 │
│  ├── OpenMeter (+ Kafka/Redpanda + ClickHouse + PostgreSQL)  │
│  ├── Prometheus + VictoriaMetrics + Grafana                  │
│  ├── Platform operators (compute, vm, notebook, etc.)        │
│  ├── cert-manager                                            │
│  └── Kube-OVN                                                │
│                                                               │
│  Estimated resource usage: ~20GB RAM, 6 CPU cores            │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  Server 2: WORKLOAD CLUSTER — Node 1                         │
│  Cherry Servers E3-1240V5, 32GB, 2×SSD                       │
│                                                               │
│  Components:                                                  │
│  ├── Kubernetes control plane (kubeadm, single-node CP)      │
│  ├── Kube-OVN                                                │
│  ├── OpenMeter K8s collector                                 │
│  ├── local-path-provisioner (storage)                        │
│  └── Tenant workloads (pods, services)                       │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  Server 3: WORKLOAD CLUSTER — Node 2                         │
│  Cherry Servers E3-1240V5, 32GB, 2×SSD                       │
│                                                               │
│  Components:                                                  │
│  ├── Kubernetes worker node                                  │
│  ├── Kube-OVN                                                │
│  ├── OpenMeter K8s collector                                 │
│  ├── local-path-provisioner (storage)                        │
│  └── Tenant workloads (pods, services)                       │
└──────────────────────────────────────────────────────────────┘
```

### Network Setup

```
All servers on same Cherry Servers VLAN (flat L2)

Management cluster:  10.0.1.0/24
Workload cluster:    10.0.2.0/24
Pod CIDR:            10.16.0.0/16 (Kube-OVN overlay)
Service CIDR:        10.96.0.0/12

DNS: *.demo.example.com → management server public IP
     (or use nip.io for zero DNS config)
```

---

## 5. Prerequisites

### Tools (on your workstation)

```bash
# Required
kubectl           # v1.30+
helm              # v3.14+
ssh               # for server access

# Recommended
k9s               # terminal UI for Kubernetes
jq                # JSON processing
yq                # YAML processing
```

### Accounts

| Service | Purpose | Required |
|---------|---------|----------|
| Cherry Servers | Demo infrastructure | For Option A |
| GitHub | OIDC provider for demo tenants | Yes |
| Google Cloud | OIDC provider (optional second provider) | Optional |
| Stripe (test mode) | Payment processing demo | Optional |
| Domain + DNS | Real domain for TLS | Optional (can use nip.io) |

### Server Preparation

Each Cherry Server needs:

```bash
# 1. Install OS (Ubuntu 22.04 LTS or newer)
#    Cherry Servers provides OS install via control panel

# 2. Update and install basics
apt update && apt upgrade -y
apt install -y curl wget git apt-transport-https ca-certificates

# 3. Install container runtime (containerd)
apt install -y containerd
mkdir -p /etc/containerd
containerd config default > /etc/containerd/config.toml
# Enable SystemdCgroup
sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
systemctl restart containerd

# 4. Install kubeadm, kubelet, kubectl
# (follow official Kubernetes docs for current version)

# 5. Disable swap
swapoff -a
sed -i '/swap/d' /etc/fstab

# 6. Load kernel modules
cat <<EOF | tee /etc/modules-load.d/k8s.conf
overlay
br_netfilter
EOF
modprobe overlay && modprobe br_netfilter

# 7. Sysctl settings
cat <<EOF | tee /etc/sysctl.d/k8s.conf
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF
sysctl --system
```

---

## 6. Phase 1: Infrastructure Bootstrap

### Management Cluster

```bash
# On Server 1: Initialize management cluster
kubeadm init \
  --pod-network-cidr=10.16.0.0/16

# Save kubeconfig
mkdir -p ~/.kube
cp /etc/kubernetes/admin.conf ~/.kube/config

# Allow scheduling on control plane (single-node management)
kubectl taint nodes --all node-role.kubernetes.io/control-plane-

# Install Kube-OVN
helm repo add kube-ovn https://kubeovn.github.io/kube-ovn
helm install kube-ovn kube-ovn/kube-ovn \
  --namespace kube-system \
  --set IFACE=eth0 \
  --set POD_CIDR=10.16.0.0/16 \
  --set SVC_CIDR=10.96.0.0/12
```

### Workload Cluster

```bash
# On Server 2: Initialize workload cluster control plane
kubeadm init \
  --pod-network-cidr=10.16.0.0/16

# Save kubeconfig (copy to management server as workload.kubeconfig)

# Allow scheduling on control plane
kubectl taint nodes --all node-role.kubernetes.io/control-plane-

# Install Kube-OVN
helm install kube-ovn kube-ovn/kube-ovn \
  --namespace kube-system \
  --set IFACE=eth0 \
  --set POD_CIDR=10.16.0.0/16 \
  --set SVC_CIDR=10.96.0.0/12

# On Server 3: Join workload cluster
kubeadm join <server-2-ip>:6443 --token <token> --discovery-token-ca-cert-hash <hash>
```

### Storage (Demo)

```bash
# On workload cluster: Install local-path-provisioner
kubectl apply -f https://raw.githubusercontent.com/rancher/local-path-provisioner/master/deploy/local-path-storage.yaml

# Set as default StorageClass
kubectl patch storageclass local-path \
  -p '{"metadata": {"annotations":{"storageclass.kubernetes.io/is-default-class":"true"}}}'
```

### Verify

```bash
# Management cluster
kubectl get nodes  # 1 node, Ready
kubectl get pods -A  # Kube-OVN running

# Workload cluster (using workload.kubeconfig)
kubectl --kubeconfig=workload.kubeconfig get nodes  # 2 nodes, Ready
kubectl --kubeconfig=workload.kubeconfig get pods -A  # Kube-OVN running
```

---

## 7. Phase 2: Platform Core

### Install kcp

```bash
# On management cluster

# Option 1: Helm chart (if available)
helm repo add kcp https://kcp-dev.github.io/helm-charts
helm install kcp kcp/kcp \
  --namespace kcp-system \
  --create-namespace \
  --set oidc.issuerURL=https://auth.demo.example.com \
  --set oidc.clientID=kcp

# Option 2: Binary (for development)
# Download kcp binary from https://github.com/kcp-dev/kcp/releases
# Run as a deployment or directly on the management node
```

### Verify kcp

```bash
# Get admin kubeconfig
kubectl -n kcp-system get secret kcp-admin-kubeconfig -o jsonpath='{.data.kubeconfig}' | base64 -d > kcp-admin.kubeconfig

# Test workspace creation
export KUBECONFIG=kcp-admin.kubeconfig
kubectl ws tree
# Should show: root
```

### Install cert-manager

```bash
# On management cluster
helm repo add jetstack https://charts.jetstack.io
helm install cert-manager jetstack/cert-manager \
  --namespace cert-manager \
  --create-namespace \
  --set crds.enabled=true
```

---

## 8. Phase 3: Identity and Access

### Deploy Zitadel

```bash
# On management cluster
helm repo add zitadel https://charts.zitadel.com

# Create PostgreSQL for Zitadel (or use an existing one)
helm repo add bitnami https://charts.bitnami.com/bitnami
helm install zitadel-db bitnami/postgresql \
  --namespace zitadel \
  --create-namespace \
  --set auth.postgresPassword=changeme \
  --set auth.database=zitadel

# Install Zitadel
helm install zitadel zitadel/zitadel \
  --namespace zitadel \
  --set zitadel.masterkey="$(openssl rand -hex 16)" \
  --set zitadel.configmapConfig.ExternalDomain=auth.demo.example.com \
  --set zitadel.configmapConfig.ExternalPort=443 \
  --set zitadel.configmapConfig.ExternalSecure=true \
  --set zitadel.configmapConfig.Database.Postgres.Host=zitadel-db-postgresql \
  --set zitadel.configmapConfig.Database.Postgres.Port=5432 \
  --set zitadel.configmapConfig.Database.Postgres.Database=zitadel \
  --set zitadel.configmapConfig.Database.Postgres.User.Username=postgres \
  --set zitadel.configmapConfig.Database.Postgres.User.Password=changeme
```

### Configure OIDC Providers

```bash
# Access Zitadel admin console
# https://auth.demo.example.com/ui/console

# 1. Create a project for the cloud platform
# 2. Configure GitHub as identity provider:
#    - Type: GitHub
#    - Client ID: <from GitHub OAuth app>
#    - Client Secret: <from GitHub OAuth app>
# 3. Configure Google as identity provider:
#    - Type: Google
#    - Client ID: <from Google Cloud Console>
#    - Client Secret: <from Google Cloud Console>
# 4. Create an OIDC application for kcp:
#    - Name: kcp
#    - Type: Web Application
#    - Redirect URIs: (as needed for console)
# 5. Create an OIDC application for CLI:
#    - Name: cloud-cli
#    - Type: Native Application
#    - Auth Method: Device Authorization
```

### Connect kcp to Zitadel

```bash
# Update kcp configuration to trust Zitadel as OIDC issuer
# This is typically done via kcp's --oidc-issuer-url flag or Helm values:
#   oidc:
#     issuerURL: https://auth.demo.example.com
#     clientID: kcp
#     groupsClaim: groups
#     usernameClaim: email
```

---

## 9. Phase 4: Service Operators

### Platform Workspace Setup

```bash
# Create the platform workspace in kcp
export KUBECONFIG=kcp-admin.kubeconfig

# Create platform workspace for APIExports
kubectl ws create platform --type=universal --enter

# Define APIResourceSchemas for platform services
# (These are the high-level APIs tenants will consume)
```

### Example: Compute APIResourceSchema

```yaml
# compute-schema.yaml
apiVersion: apis.kcp.io/v1alpha2
kind: APIResourceSchema
metadata:
  name: computes.compute.cloud.example
spec:
  group: compute.cloud.example
  names:
    kind: Compute
    listKind: ComputeList
    plural: computes
    singular: compute
  scope: Namespaced
  versions:
    - name: v1
      served: true
      storage: true
      schema:
        openAPIV3Schema:
          type: object
          properties:
            spec:
              type: object
              properties:
                image:
                  type: string
                replicas:
                  type: integer
                  default: 1
                resources:
                  type: object
                  properties:
                    cpu:
                      type: string
                    memory:
                      type: string
                ports:
                  type: array
                  items:
                    type: object
                    properties:
                      port:
                        type: integer
                      public:
                        type: boolean
            status:
              type: object
              properties:
                phase:
                  type: string
                url:
                  type: string
                replicas:
                  type: integer
```

### Example: APIExport

```yaml
# compute-export.yaml
apiVersion: apis.kcp.io/v1alpha2
kind: APIExport
metadata:
  name: compute
spec:
  latestResourceSchemas:
    - computes.compute.cloud.example
```

### Onboarding Controller

The onboarding controller watches for new users (via kcp home workspaces or a custom mechanism) and:

1. Creates a workspace for the new tenant
2. Binds platform APIExports (compute, storage, network, ai)
3. Sets default ResourceQuota (free tier)
4. Creates OpenMeter subject

```bash
# Deploy onboarding controller
kubectl apply -f deploy/onboarding-controller.yaml
```

### Compute Operator

The compute operator watches the compute APIExport's virtual workspace and reconciles tenant `Compute` resources into pods on the workload cluster:

```bash
# Deploy compute operator (needs workload cluster kubeconfig)
kubectl create secret generic workload-kubeconfig \
  --from-file=kubeconfig=workload.kubeconfig \
  -n platform-operators

kubectl apply -f deploy/compute-operator.yaml
```

---

## 10. Phase 5: Metering and Billing

### Deploy OpenMeter

```bash
# On management cluster
helm repo add openmeter https://openmeter.github.io/helm-charts

helm install openmeter openmeter/openmeter \
  --namespace openmeter \
  --create-namespace \
  --values - <<EOF
# OpenMeter configuration
config:
  ingest:
    kafka:
      broker: openmeter-kafka:9092
  aggregation:
    clickhouse:
      address: openmeter-clickhouse:9000
  meters:
    - slug: cpu_seconds
      description: CPU usage in seconds
      eventType: compute.usage
      aggregation: SUM
      valueProperty: $.cpu_seconds
      groupBy:
        tenant: $.tenant_id
        namespace: $.namespace
    - slug: memory_gb_seconds
      description: Memory usage in GB-seconds
      eventType: compute.usage
      aggregation: SUM
      valueProperty: $.memory_gb_seconds
      groupBy:
        tenant: $.tenant_id
        namespace: $.namespace
    - slug: gpu_seconds
      description: GPU usage in seconds
      eventType: compute.usage
      aggregation: SUM
      valueProperty: $.gpu_seconds
      groupBy:
        tenant: $.tenant_id
EOF
```

### Deploy OpenMeter K8s Collector

```bash
# On workload cluster
kubectl --kubeconfig=workload.kubeconfig apply -f deploy/layer3-production/prod/openmeter/collector-daemonset.yaml
```

### Configure Stripe (Test Mode)

```bash
# Create Stripe test account at https://dashboard.stripe.com/test
# Get test API keys

kubectl create secret generic stripe-credentials \
  --from-literal=api-key=sk_test_... \
  -n openmeter
```

### Quota Controller

```bash
# Deploy kcp admission webhook that checks OpenMeter entitlements
kubectl apply -f deploy/layer3-production/prod/quota/quota-controller.yaml
```

---

## 11. Phase 6: Web Console and CLI

### Web Console

```bash
# Build and deploy the web console
# The console is a static SPA that talks to kcp + Zitadel + OpenMeter APIs

kubectl apply -f deploy/web-console.yaml

# Configure ingress
kubectl apply -f - <<EOF
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: console
  namespace: platform
spec:
  parentRefs:
    - name: platform-gateway
  hostnames:
    - console.demo.example.com
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /
      backendRefs:
        - name: web-console
          port: 80
EOF
```

### Custom CLI

```bash
# Build the CLI
cd cmd/cloud-cli
go build -o cloud .

# Install
cp cloud /usr/local/bin/

# Test
cloud login  # Opens browser for device auth via Zitadel
cloud workspace list
```

---

## 12. Phase 7: End-to-End Demo Flow

### The Demo Script

This is the sequence to show in a live demo:

#### 1. Login

```bash
# Via CLI
$ cloud login
Open this URL in your browser: https://auth.demo.example.com/device
Enter code: ABCD-1234
Waiting for authorization... done.
Logged in as demo-user@gmail.com (workspace: tenant-demo-user)

# Or via Web Console
# Navigate to https://console.demo.example.com
# Click "Sign in with GitHub" or "Sign in with Google"
```

#### 2. Explore Workspace

```bash
$ cloud workspace list
NAME              TIER   STATUS
tenant-demo-user  free   Ready

$ kubectl get apiresources
NAME        SHORTNAMES  APIVERSION                    NAMESPACED
computes    co          compute.cloud.example/v1      true
notebooks   nb          ai.cloud.example/v1           true

$ kubectl get resourcequota
NAME        AGE   REQUEST                           LIMIT
free-tier   1m    cpu: 0/1, memory: 0/2Gi, gpu: 0/0
```

#### 3. Create a Workload

```bash
$ cat <<EOF | kubectl apply -f -
apiVersion: compute.cloud.example/v1
kind: Compute
metadata:
  name: my-app
spec:
  image: nginx:latest
  replicas: 1
  resources:
    cpu: "250m"
    memory: "256Mi"
  ports:
    - port: 80
      public: true
EOF

$ kubectl get computes
NAME     STATUS  URL                                    AGE
my-app   Ready   https://my-app.tenant-demo.example.com 30s
```

#### 4. Show Metering

```bash
$ cloud status
Workspace: tenant-demo-user
Tier: free

Current Period Usage:
  CPU:    0.25 CPU-hours (limit: 100)
  Memory: 0.125 GB-hours (limit: 200)
  GPU:    0 GPU-hours (limit: 0)
```

#### 5. Hit Quota Limit

```bash
$ cat <<EOF | kubectl apply -f -
apiVersion: compute.cloud.example/v1
kind: Compute
metadata:
  name: big-app
spec:
  image: nginx:latest
  replicas: 4
  resources:
    cpu: "500m"
    memory: "1Gi"
EOF

Error: admission webhook denied: CPU quota exceeded.
Free tier allows 1 CPU total. Upgrade to pay-as-you-go at
https://console.demo.example.com/billing
```

#### 6. Upgrade Tier (Console)

```
In the web console:
1. Navigate to Billing → Upgrade
2. Select "Pay-as-you-go"
3. Enter Stripe test card: 4242 4242 4242 4242
4. Quotas lifted immediately
```

#### 7. Show Billing Dashboard

```
In the web console or Grafana:
- Current period usage chart (CPU, memory over time)
- Cost accumulation
- Invoice preview
```

---

## 13. Demo Scenarios

### Scenario A: Platform Overview (5 min)

Quick overview for stakeholders.

1. Show web console login (OIDC)
2. Create a simple compute workload
3. Show it running, access the URL
4. Show metering dashboard
5. Show multi-tenant isolation (two browser tabs, two tenants)

### Scenario B: Developer Experience (10 min)

Focus on the tenant developer workflow.

1. CLI login (`cloud login`)
2. List available APIs (`kubectl api-resources`)
3. Create a Jupyter notebook
4. Access notebook via URL
5. Create a compute workload
6. Show resource usage (`cloud status`)
7. Hit quota, upgrade tier
8. Show kubectl compatibility

### Scenario C: Operator Experience (10 min)

Focus on the platform operator workflow.

1. Show kcp admin view (workspaces, tenants)
2. Show Grafana dashboards (infrastructure, per-tenant)
3. Show OpenMeter admin (usage, billing, plans)
4. Create a new service type (add a CRD + operator)
5. Show it appearing in tenant workspaces
6. Adjust tenant quotas

### Scenario D: Full Architecture (20 min)

Complete walkthrough for technical audience.

1. Architecture diagram walkthrough
2. kcp workspace creation and APIBinding
3. Operator reconciliation loop (show virtual workspace)
4. Workload appearing on backend cluster
5. Network isolation (show Kube-OVN Vpc isolation)
6. Metering pipeline (collector → OpenMeter → invoice)
7. Billing flow (usage → Stripe test invoice)
8. Quota enforcement
9. CLI SSH tunnel to a workload

---

## 14. Troubleshooting

### Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| kcp workspace not ready | APIBinding not resolved | Check APIExport exists in platform workspace |
| OIDC login fails | Zitadel misconfigured | Verify `--oidc-issuer-url` matches Zitadel's external URL |
| Workload not created on backend | Operator not running or no workload kubeconfig | Check operator logs, verify secret exists |
| Metering shows zero usage | OpenMeter collector not deployed on workload cluster | Deploy collector DaemonSet |
| Quota not enforced | Admission webhook not registered | Check `ValidatingWebhookConfiguration` exists |
| Kube-OVN pods crashlooping | Kernel version too old or OVS issue | Ensure kernel 5.4+ on all nodes, check OVS logs |
| Gateway API not working | Ingress controller not deployed | Deploy Envoy Gateway or Nginx Gateway Fabric |

### Debug Commands

```bash
# kcp
kubectl ws tree                          # Workspace hierarchy
kubectl get apiexports -A                # All API exports
kubectl get apibindings -A               # All bindings

# Workload cluster
kubectl --kubeconfig=workload.kubeconfig get pods -A  # All workloads
kubectl --kubeconfig=workload.kubeconfig get vpcs,subnets -A

# OpenMeter
curl -s http://openmeter:8888/api/v1/meters | jq  # List meters
curl -s http://openmeter:8888/api/v1/events | jq   # Recent events

# Zitadel
curl -s https://auth.demo.example.com/.well-known/openid-configuration | jq
```

---

## 15. Appendix: Environment Cost Comparison

```
Option                          Servers   Monthly Cost   GPU    Metal3   Best For
────────────────────────────────────────────────────────────────────────────────────
A. Cherry Servers (CPU)         3         ~$195          No     IPMI ✅   Demo + Metal3
A+ Cherry Servers (CPU+GPU)     5         ~$675          P4     IPMI ✅   Full demo
B. Hetzner Dedicated (CPU)      3         ~$150          No     ⚠️        Budget demo
B+ Hetzner Dedicated (CPU+GPU)  5         ~$550          4000   ⚠️        Budget + GPU
C. Hetzner Cloud VMs            3-5       ~$50-82        No     ❌        Cheapest
D. Local (kind/k3d)             0         $0             No     ❌        Development
E. Hybrid (local + Cherry)      3         ~$195          No     ✅        Dev + Demo

✅ = confirmed    ⚠️ = needs verification    ❌ = not available
```

### Cost for Running the Full Demo Stack (1 Month)

Assuming Option A (3x Cherry Servers CPU-only):

```
Infrastructure:           €177/mo (~$195)
Domain (optional):        ~$12/year
Stripe:                   $0 (test mode)
GitHub/Google OIDC:       $0 (free tier)
─────────────────────────────────────────
Total:                    ~$195/month
```

---

*This document will be expanded with actual deployment scripts, Helm values, and operator code as the implementation progresses.*
