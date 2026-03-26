# Sovereign Small Cloud — Architecture Overview

## The Simple Version

**Version:** 0.1.0-draft
**Date:** 2026-03-26

---

## What Is This?

A blueprint for turning a few servers into a multi-tenant cloud platform using open-source tools. Tenants sign in, get an isolated workspace, deploy workloads, and get billed — all through Kubernetes-native APIs.

**KCP** sits at the center as the multi-tenant control plane.

---

## The Core Idea in 30 Seconds

```
Tenant signs in (Google/GitHub)
    |
    v
Gets a KCP workspace (isolated API surface)
    |
    v
Creates workloads via high-level APIs (not raw K8s)
    |
    v
Platform operators translate these into real workloads
on backend Kubernetes clusters the tenant never sees
    |
    v
Usage is metered and billed
```

Tenants see **cloud APIs** (Compute, VM, Notebook, GPU). They never see pods, nodes, or clusters.

---

## Architecture: 3 Layers

```
+-----------------------------------------------------------+
|                    TENANT LAYER                            |
|              (what tenants interact with)                  |
|                                                            |
|   Web Console / CLI / kubectl                              |
|       |                                                    |
|       v                                                    |
|   KCP Workspace  <-- OIDC (Google/GitHub)                  |
|   +- Compute API                                          |
|   +- VM API                                               |
|   +- Notebook API                                         |
|   +- GPU API                                              |
|   +- Storage API                                          |
+----------------------------+------------------------------+
                             |
                             | operators reconcile
                             |
+----------------------------v------------------------------+
|                  PLATFORM LAYER                            |
|           (what the platform operator runs)                |
|                                                            |
|   Management Cluster:                                      |
|   +- KCP server + front-proxy                              |
|   +- Identity provider (Zitadel or Dex)                    |
|   +- Cloud operator (translates tenant APIs -> workloads)|
|   +- Billing (OpenMeter, optional for v1)                  |
|   +- Monitoring (Prometheus + Grafana)                     |
+----------------------------+------------------------------+
                             |
                             | creates workloads
                             |
+----------------------------v------------------------------+
|                 INFRASTRUCTURE LAYER                       |
|              (where workloads actually run)                 |
|                                                            |
|   Workload Cluster(s):                                     |
|   +- Kubernetes (kubeadm/k3s)                              |
|   +- Cilium (networking + isolation)                       |
|   +- NVIDIA GPU Operator (if GPUs present)                 |
|   +- Storage (Rook-Ceph for production, local for demo)    |
|   +- KubeVirt (if VMs needed)                              |
|                                                            |
|   Bare Metal (production):                                 |
|   +- Metal3 + Flatcar (automated provisioning)             |
|   +- Or: pre-provisioned servers (demo/small scale)        |
+-----------------------------------------------------------+
```

---

## Minimal Viable Stack (Day 1)

You can start with just **5 components**:

```
Component         What it does                          Required?
---------         ------------                          ---------
KCP               Multi-tenant control plane            YES - core
Kubernetes        Runs workloads                        YES - core
Cilium            Networking + tenant isolation          YES - core
OIDC provider     Tenant authentication                 YES - core
Cloud operator    Reconciles all platform APIs           YES - core
```

Everything else layers on top when you need it:

```
Component         When to add
---------         -----------
Zitadel           When you need user management, API keys, CLI auth
OpenMeter         When you need billing
Rook-Ceph         When you need persistent storage
GPU Operator      When you have GPU hardware
KubeVirt          When you need VMs
Metal3 + Flatcar  When you manage your own hardware
Kueue             When you need GPU job queuing
Grafana           When you need dashboards
Web console       When you want a UI
```

---

## How It Works: The Flow

### 1. Tenant Onboarding

```
User clicks "Sign in with GitHub"
    |
    v
OIDC provider authenticates, issues JWT
    |
    v
Onboarding controller:
  +- Creates KCP workspace "tenant-jane"
  +- Binds platform APIs (Compute, Storage, etc.)
  +- Sets quotas (free tier: 1 CPU, 2GB RAM)
  +- Creates billing record (if billing enabled)
    |
    v
User gets a kubeconfig pointing to their workspace
```

### 2. Creating a Workload

```yaml
# Tenant applies this to their KCP workspace:
apiVersion: compute.cloud.example/v1
kind: Compute
metadata:
  name: my-app
spec:
  image: nginx:latest
  resources:
    cpu: "500m"
    memory: "512Mi"
  ports:
    - port: 80
      public: true
```

```
Cloud operator sees this (via KCP virtual workspace)
    |
    v
Creates in workload cluster:
  +- Namespace "tenant-jane" (if not exists)
  +- Deployment (nginx, 500m CPU, 512Mi RAM)
  +- Service
  +- HTTPRoute (if public: true)
  +- NetworkPolicy (isolate from other tenants)
    |
    v
Updates status in KCP:
  status:
    phase: Ready
    url: https://my-app.tenant-jane.cloud.example.com
```

### 3. What the Tenant Sees

```
$ kubectl get computes
NAME     STATUS   URL                                          AGE
my-app   Ready    https://my-app.tenant-jane.cloud.example.com 1m

$ kubectl get all
# Only sees their own resources. Cannot see other tenants.
# Cannot see pods, nodes, or cluster internals.
```

---

## KCP: Why It Matters

KCP is not "another Kubernetes cluster". It's a **multi-tenant API server** that looks like Kubernetes but serves a different purpose:

| Kubernetes Cluster | KCP |
|---|---|
| Runs containers | Serves APIs |
| One set of CRDs for everyone | Different CRDs per workspace |
| Tenants share namespaces | Tenants get isolated logical clusters |
| Tenants can see nodes, pods | Tenants see only their APIs |
| Scaling = more nodes | Scaling = more workspaces (near-zero cost) |

**The key insight:** KCP lets you define what APIs each tenant sees. A tenant workspace might have `Compute`, `Notebook`, and `Volume` APIs — but no `Pod`, `Deployment`, or `Node`. The platform operator controls the abstraction.

---

## Tenant Isolation

Two layers, neither visible to the tenant:

```
Layer 1: API Isolation (KCP)
  +- Separate workspace per tenant
  +- Independent RBAC, quotas, secrets
  +- Tenants cannot discover each other

Layer 2: Workload Isolation (Backend K8s)
  +- Separate namespace per tenant
  +- Cilium NetworkPolicy (deny cross-tenant traffic)
  +- ResourceQuota per namespace
```

---

## Adding a New Service

The platform is extensible by design. Adding a new service (e.g., managed PostgreSQL) requires:

1. **Define the API** — write an `APIResourceSchema` (like a CRD)
2. **Export the API** — create an `APIExport` in the platform workspace
3. **Add a reconciler** — add the new resource type to the cloud operator
4. **Bind to tenants** — add the APIBinding to tenant workspaces

No platform core changes. A single **cloud operator** handles all platform APIs (Compute, VM, Notebook, GPU, Storage, Network). New resource types are added as reconcilers within this operator.

---

## Billing (Optional, Layered On)

When billing is needed, add **OpenMeter**:

```
Workload cluster metrics (CPU, GPU, RAM per tenant)
    |
    v
OpenMeter collector (scrapes every 15 min)
    |
    v
OpenMeter (aggregates, rates, invoices)
    |
    v
Stripe (or alternative payment processor)
```

Billing is **not required** to run the platform. It's an optional layer that plugs into the existing architecture.

---

## Production Stack (Full Version)

When you need the full production setup, see `whitepaper.md`. The full stack adds:

| Layer | Component | Purpose |
|-------|-----------|---------|
| Bare Metal | Metal3 + Flatcar | Automated server provisioning |
| Cluster Lifecycle | Cluster API | Declarative cluster management |
| Identity | Zitadel | Full IAM with user management |
| Storage | Rook-Ceph | Block + object storage |
| GPU | NVIDIA GPU Operator | GPU management + scheduling |
| GPU Scheduling | Kueue | Job queuing (when needed) |
| VMs | KubeVirt | Virtual machine support |
| Billing | OpenMeter + Stripe | Usage-based billing |
| Observability | Prometheus + Grafana | Monitoring + dashboards |
| Long-term Metrics | VictoriaMetrics | Metrics retention (when needed) |
| Security | gVisor, Cilium encryption | Runtime sandboxing, encryption |
| Backup | Velero + etcd snapshots | Disaster recovery |

Each component is independent and can be added incrementally.

---

## Licensing

Every component is open source:

| License | Components |
|---------|-----------|
| **Apache 2.0** | KCP, Kubernetes, Cilium, Metal3, Flatcar, Rook-Ceph, OpenMeter, Kueue, KubeVirt, Prometheus, gVisor, Cluster API, cert-manager, GPU Operator |
| **AGPL-3.0** | Zitadel (server), Grafana — deployed unmodified, no copyleft impact |

No BSL, SSPL, or proprietary licenses. No commercial components required.

---

## Documents in This Repository

### Architecture Papers (by layer)

| Document | Layer | What it covers |
|----------|-------|---------------|
| **01-infrastructure.md** | Layer 1 | Bare metal → K8s (Metal3, Flatcar, Cilium, Ceph, GPU, KubeVirt) |
| **02-platform.md** | Layer 2 | Multi-tenant cloud APIs (KCP, Identity, Cloud Operator, CLI, Console) — **demo lives here** |
| **03-production.md** | Layer 3 | Productionization (billing, metering, monitoring, backup, day-2 ops) |

### Other Documents

| Document | What it is | Audience |
|----------|-----------|----------|
| **overview.md** (this file) | Simplified architecture overview | Everyone |
| **deployment.md** | Production deployment guide (20 phases) | Platform operators |
| **demo.md** | Quick demo setup guide | Developers, demo presenters |
| **deploy/** | 83 YAML manifests for all components | Platform operators |

---

## Getting Started

**Fastest path to a working demo:**

1. Get 3 Linux servers (bare metal, VMs, or cloud instances)
2. Install Kubernetes (kubeadm or k3s)
3. Install Cilium
4. Install KCP
5. Deploy the cloud operator
6. Create a tenant workspace
7. Apply a Compute resource — see it running on the backend

Total time: **~2 hours** for someone familiar with Kubernetes.

See `demo.md` for step-by-step instructions.
