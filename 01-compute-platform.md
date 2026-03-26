# Sovereign Small Cloud — Compute Platform Architecture

## Paper 1: Multi-Tenant Cloud APIs with KCP

**Version:** 0.1.0-draft
**Date:** 2026-03-26
**Status:** Working Draft

> For metering, billing, and quota enforcement, see [02-billing-metering.md](02-billing-metering.md).

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Motivation and Goals](#2-motivation-and-goals)
3. [Design Principles](#3-design-principles)
4. [Architecture Overview](#4-architecture-overview)
5. [Control Plane — KCP](#5-control-plane--kcp)
6. [Identity and Access — Zitadel](#6-identity-and-access--zitadel)
7. [Bare Metal Provisioning — Metal3 + Flatcar](#7-bare-metal-provisioning--metal3--flatcar)
8. [Kubernetes Layer](#8-kubernetes-layer)
9. [Tenant Model and Isolation](#9-tenant-model-and-isolation)
10. [Compute Services](#10-compute-services)
11. [GPU and Accelerator Management](#11-gpu-and-accelerator-management)
12. [Networking](#12-networking)
13. [Storage](#13-storage)
14. [Observability](#14-observability)
15. [Custom CLI](#15-custom-cli)
16. [Web Console](#16-web-console)
17. [Security Model](#17-security-model)
18. [Component Summary](#18-component-summary)
19. [Licensing and Sovereignty](#19-licensing-and-sovereignty)
20. [Relationship to Sovereign Cloud Initiatives](#20-relationship-to-sovereign-cloud-initiatives)
21. [Future Enhancements](#21-future-enhancements)
22. [Appendix: Decision Log](#22-appendix-decision-log)

---

## 1. Executive Summary

This document presents a reference architecture for building a sovereign, multi-tenant cloud platform on commodity hardware (2-3 racks). It targets small infrastructure providers who want to offer cloud services — compute, GPU/accelerator workloads, VMs, and extensible platform services — to external users with minimal operational overhead.

The architecture is built around **KCP** (Kubernetes-like Control Plane) as the multi-tenant API core, exposing high-level cloud APIs to tenants while hiding the complexity of the underlying infrastructure. Tenants interact with the platform through a web console and custom CLI, authenticating via standard OIDC providers (Google, GitHub, etc.). Usage tracking and billing can be layered on (see [Paper 2](02-billing-metering.md)).

Every component is open source, CNCF-aligned where possible, and self-hostable. External dependencies (OIDC providers, payment processors) are behind swappable interfaces, allowing providers to choose sovereign alternatives.

**Key characteristics:**

- **API Platform model** — tenants consume high-level cloud APIs (Compute, VM, GPU, Storage), not raw Kubernetes
- **KCP at the core** — multi-tenant workspaces with full API isolation, RBAC, and quotas
- **Interface-based** — identity and infrastructure components are swappable
- **Bare metal native** — Metal3 for hardware lifecycle, Flatcar for immutable OS
- **GPU-ready** — NVIDIA GPU Operator with extensible sharing models
- **Self-service** — OIDC login, automatic workspace provisioning

---

## 2. Motivation and Goals

### The Problem

Small infrastructure providers — hosting companies, research labs, GPU cluster operators, edge providers — face a significant barrier to offering cloud-like services. Building a multi-tenant platform with self-service provisioning, billing, and proper isolation traditionally requires either:

- Adopting heavyweight platforms (OpenStack, CloudFoundry) with significant operational burden, or
- Building custom solutions from scratch, reinventing common patterns

Both paths are expensive and slow.

### The Opportunity

The Kubernetes ecosystem has matured to the point where most building blocks for a cloud platform exist as open-source, composable components. KCP extends this by providing a multi-tenant control plane purpose-built for offering APIs as services. By combining these components with a clear reference architecture, small providers can stand up a functional cloud platform with a minimal team.

### Goals

1. **Minimal viable stack** — every component must earn its place. No bloat.
2. **Time to first tenant < 1 week** — from bare hardware to serving the first external user.
3. **Extensible service catalog** — providers can add new service types (AI workloads, managed databases, etc.) by registering CRDs and deploying operators.
4. **Sovereign by default** — all data and control stays on the provider's infrastructure. External dependencies are optional and swappable.
5. **Production-grade multi-tenancy** — proper isolation, quotas, and access control from day one.

### Non-Goals

- Competing with hyperscalers on breadth of services
- Supporting thousands of racks (this is for small-scale deployments)
- Defining new standards (we align with existing CNCF ecosystem patterns)

---

## 3. Design Principles

| # | Principle | Rationale |
|---|-----------|-----------|
| 1 | **API Platform, not Infrastructure-as-a-Service** | Tenants interact with high-level, domain-specific APIs (Compute, GPU, VM), not raw Kubernetes primitives. This allows the provider to control the abstraction level, enforce policies, and evolve the backend independently. |
| 2 | **Interface-based architecture** | External dependencies (identity, payments, bare metal provisioning) are behind well-defined interfaces. Default implementations ship with the platform, but providers can swap them for sovereign or custom alternatives. |
| 3 | **Kubernetes-native APIs everywhere** | All platform APIs are Kubernetes-style CRDs. This means standard tooling (kubectl, client-go, controller-runtime, GitOps) works out of the box. The learning curve for operators familiar with Kubernetes is minimal. |
| 4 | **Operator pattern for service fulfillment** | High-level tenant APIs are fulfilled by operators running against backend infrastructure. Adding a new service type means defining a CRD + deploying an operator. No platform core changes required. |
| 5 | **Minimal moving parts** | Small team = small stack. Prefer components that serve multiple purposes (e.g., Cilium for CNI + NetworkPolicy + Gateway API + observability). |
| 6 | **Open source, CNCF-aligned** | Every component must be open source with an OSI-approved license. Prefer CNCF projects where available. No vendor lock-in, no commercial-only dependencies in the critical path. |
| 7 | **Sovereign by default** | The entire platform runs on the provider's infrastructure. No phone-home, no SaaS requirements. External integrations (Google OIDC, Stripe) are convenience options, not requirements. |

---

## 4. Architecture Overview

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      TENANTS / USERS                             │
│                 Web Console  ·  Custom CLI  ·  kubectl            │
└──────────────────────────┬──────────────────────────────────────┘
                           │ OIDC (Google, GitHub, ...)
                           │ via Zitadel
┌──────────────────────────▼──────────────────────────────────────┐
│                    KCP  (Multi-Tenant Control Plane)              │
│                                                                   │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌──────────────┐  │
│  │ Workspace  │ │ Workspace  │ │ Workspace  │ │   System     │  │
│  │ tenant-a   │ │ tenant-b   │ │ tenant-c   │ │  (platform)  │  │
│  │            │ │            │ │            │ │              │  │
│  │ Compute    │ │ Compute    │ │ Compute    │ │ APIExports   │  │
│  │ VM         │ │ GPU        │ │ VM         │ │ Operators    │  │
│  │ Storage    │ │ Storage    │ │ Notebook   │ │              │  │
│  └────────────┘ └────────────┘ └────────────┘ └──────────────┘  │
│                                                                   │
│  APIExport/APIBinding · RBAC · ResourceQuota · Front Proxy       │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Virtual Workspaces
                           │ (operators reconcile tenant resources)
┌──────────────────────────▼──────────────────────────────────────┐
│                  MANAGEMENT CLUSTER                               │
│                                                                   │
│  KCP Server · Zitadel · Prometheus · Grafana                     │
│  Quota Controller · Service Operators                            │
│  Metal3 + Cluster API (production) · cert-manager                │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Syncer / Operators
┌──────────────────────────▼──────────────────────────────────────┐
│                  WORKLOAD CLUSTER(s)                              │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Kubernetes (kubeadm on Flatcar)                         │    │
│  │                                                           │    │
│  │  Namespaces per tenant (operator-managed):                │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐                 │    │
│  │  │tenant-a  │ │tenant-b  │ │tenant-c  │                 │    │
│  │  │ pods     │ │ pods     │ │ VMs      │                 │    │
│  │  │ services │ │ GPU jobs │ │ services │                 │    │
│  │  └──────────┘ └──────────┘ └──────────┘                 │    │
│  │                                                           │    │
│  │  Cilium (CNI + NetworkPolicy + Gateway API)               │    │
│  │  NVIDIA GPU Operator · KubeVirt                           │    │
│  │  DCGM Exporter                                            │    │
│  └─────────────────────────────────────────────────────────┘    │
└──────────────────────────┬──────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────────┐
│                  BARE METAL (Production Path)                     │
│                                                                   │
│  Metal3 (Ironic) · Flatcar Container Linux                       │
│  IPMI/Redfish · PXE Boot                                         │
│  2-3 racks · commodity servers · NVIDIA GPUs                     │
└─────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
Tenant ──OIDC──▶ Zitadel ──JWT──▶ KCP (workspace access)
                                        │
Tenant ──kubectl/CLI──▶ KCP workspace ──▶ creates Compute/VM/GPU CRs
                                        │
Operator (via virtual workspace) ◀──────┘ watches CRs
    │
    ├──▶ Creates pods/VMs in workload cluster (tenant namespace)
    └──▶ Returns status (URL, SSH endpoint, kubeconfig) to KCP
```

---

## 5. Control Plane — KCP

### Role

KCP is the multi-tenant control plane — the single system that all tenants interact with. It provides:

- **Workspaces** — isolated logical clusters per tenant with independent CRDs, RBAC, secrets, and API surfaces
- **APIExport / APIBinding** — service providers (platform operators) define APIs centrally, tenants bind to them in their workspaces
- **Virtual Workspaces** — operators get a filtered view across all tenant workspaces to reconcile resources
- **Front Proxy** — stateless proxy routing requests to the correct workspace/shard
- **ResourceQuota** — per-workspace resource limits

### Why KCP

KCP was purpose-built for this use case — offering APIs as services to many isolated tenants. Compared to alternatives:

| Approach | Isolation | Cost per tenant | API customization | Fit |
|----------|-----------|----------------|-------------------|-----|
| Namespaces | Weak (shared CRDs, shared RBAC) | Near zero | None | Poor |
| Capsule | Namespace grouping + policy | Near zero | None | Poor |
| vCluster | Virtual apiserver per tenant | Medium (pod per tenant) | Full K8s | Overkill |
| Kamaji | Full cluster per tenant | High | Full K8s | Overkill |
| **KCP** | **Logical cluster (workspace)** | **Near zero** | **Full (APIExport)** | **Ideal** |

KCP gives us the API customization and isolation of virtual clusters at the cost profile of namespaces.

### Tenant Interaction Model

Tenants never see or interact with the backend Kubernetes clusters. Their entire world is a KCP workspace:

```
$ kubectl --kubeconfig=tenant.kubeconfig get apiresources
NAME              SHORTNAMES   APIVERSION                  NAMESPACED
computes          vm           compute.cloud.example/v1    true
gpujobs           gj           ai.cloud.example/v1         true
notebooks         nb           ai.cloud.example/v1         true
volumes           vol          storage.cloud.example/v1    true
publicips         pip          network.cloud.example/v1    true
```

These APIs are defined by the platform operator via APIExport and made available to tenant workspaces via APIBinding. The tenant creates resources using these APIs:

```yaml
apiVersion: ai.cloud.example/v1
kind: Notebook
metadata:
  name: my-analysis
  namespace: default
spec:
  image: jupyter/scipy-notebook:latest
  resources:
    cpu: "2"
    memory: "8Gi"
  gpu:
    count: 1
```

The platform operator, watching via a virtual workspace, picks this up and creates the actual workload on the backend cluster. The status flows back:

```yaml
status:
  phase: Ready
  url: https://my-analysis.tenant-a.cloud.example.com
  tunnelEndpoint: grpc://tunnel.cloud.example.com/tenant-a/my-analysis
```

### KCP Deployment

KCP runs on the management cluster as a set of pods:

- **kcp-server** — the multi-tenant API server (one or more replicas)
- **kcp-front-proxy** — stateless request router
- **etcd** — KCP's datastore (can share the management cluster's etcd or run dedicated)

For high availability, KCP supports **sharding** — running multiple kcp-server instances with separate etcd stores, with the front proxy routing transparently. For a 2-3 rack deployment, a single shard is typically sufficient. The reference architecture documents sharding as a scale-out option.

### API Design Pattern

Platform services follow a consistent pattern:

1. **Define the API** — create an `APIResourceSchema` (similar to a CRD but KCP-native)
2. **Export the API** — create an `APIExport` in the platform workspace, referencing the schema
3. **Build the operator** — a controller watching the virtual workspace, reconciling tenant resources against the backend cluster
4. **Bind to tenants** — when a tenant workspace is created, automatically bind the platform's APIExports

This pattern is repeatable for any service type. Adding a new service (e.g., managed PostgreSQL) requires only a new schema + operator, no changes to the platform core.

---

## 6. Identity and Access — Zitadel

### Role

Zitadel serves as the identity provider and OIDC broker. It:

- Federates external OIDC providers (Google, GitHub, corporate IdPs)
- Issues JWT tokens trusted by KCP (`--oidc-issuer-url` flag)
- Manages user profiles, organizations, and machine users
- Provides device authorization grant for CLI authentication
- Provides personal access tokens (PATs) for programmatic access

### Why Zitadel

| Requirement | Zitadel | Dex | Keycloak |
|-------------|---------|-----|----------|
| OIDC brokering (Google, GitHub) | Yes | Yes | Yes |
| User management / profiles | Yes | No | Yes |
| API keys / machine users | Yes (PAT) | No | Yes |
| Device auth (CLI) | Yes | No | Configurable |
| Multi-tenancy | Built-in (orgs) | No | Realms |
| Language | Go | Go | Java |
| RAM footprint | ~256MB | ~50MB | ~512MB-1GB |
| API-first | gRPC + REST | REST only | REST (UI-first) |
| Origin | Swiss (EU) | US (CoreOS/Red Hat) | US (Red Hat) |

Zitadel is the best balance between features and footprint. Dex is lighter but lacks user management and CLI auth flows that we need. Keycloak is heavier (JVM) and UI-centric.

### Interface Contract

Zitadel is the default identity provider, but the platform defines an interface at the OIDC boundary:

```
Platform ──trusts──▶ OIDC Issuer (Zitadel by default)
                     │
                     ├── Issues JWT with claims: sub, email, groups
                     ├── Supports device authorization grant
                     └── Provides user info endpoint
```

To swap Zitadel for another provider (e.g., Keycloak, Authentik, corporate ADFS), the provider must:
1. Issue JWTs with the expected claims
2. Support the device authorization grant (for CLI)
3. Expose a JWKS endpoint for KCP token verification

KCP's `--oidc-issuer-url` is the only configuration point that changes.

### Authentication Flows

**Web Console:**
```
Browser → Console → Zitadel (authorization code flow) → JWT → KCP
```

**Custom CLI:**
```
CLI → Zitadel (device authorization grant) → User approves in browser → JWT → KCP
```

**Programmatic (CI/CD, scripts):**
```
Machine user → Zitadel PAT or client credentials → JWT → KCP
```

### License

- **Server:** AGPL-3.0 (deployed unmodified — no copyleft impact on our code)
- **SDKs / API protos:** Apache 2.0 / MIT (our CLI and console integrate freely)

---

## 7. Bare Metal Provisioning — Metal3 + Flatcar

### Role

Metal3 manages the lifecycle of bare metal servers — from powered-off hardware to running Kubernetes nodes. Flatcar Container Linux is the immutable operating system installed on each machine.

### Why Metal3

Metal3 is the Kubernetes-native bare metal provisioning system:

- **CNCF Incubating** — governed by the CNCF, not a single vendor
- **Apache 2.0** — fully open source, no commercial components
- **57 contributing organizations** — co-maintained by Red Hat and Ericsson (Sweden/EU)
- **Cluster API integration** — declarative cluster lifecycle management
- **Ironic-based** — battle-tested provisioning engine from OpenStack, runs standalone

Alternatives considered:

| Project | CNCF | License | Vendor neutral | Status |
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

**Lifecycle:**

1. **Register** — Create `BareMetalHost` resources with BMC credentials
2. **Inspect** — Metal3/Ironic introspects hardware (CPU, RAM, disks, NICs)
3. **Provision** — Apply CAPI `Cluster` + `Machine` manifests; Metal3 PXE-boots machines, writes Flatcar to disk
4. **Bootstrap** — kubeadm initializes Kubernetes on the nodes
5. **Scale** — Add/remove `Machine` resources; Metal3 provisions/deprovisions automatically
6. **Update** — Rolling OS updates via Flatcar's atomic update mechanism

### Network Requirements

Metal3/Ironic requires control over a provisioning network for PXE boot:

- **Provisioning network** — isolated L2 segment where DHCP/TFTP runs (managed by Ironic)
- **BMC network** — connectivity to server BMC interfaces (IPMI/Redfish)
- **Cluster network** — standard Kubernetes networking (overlay or native)

These can be the same physical network with VLANs, or separate interfaces.

### Alternatives

The bare metal provisioning layer is interface-based. The platform can work with any provisioning system that produces Kubernetes nodes. Alternatives include:

- **Tinkerbell** — CNCF Sandbox, lighter than Metal3, good for simpler deployments
- **Manual / cloud-init** — for hosted machines without BMC access (demo path)
- **PXE + Ansible** — traditional approach, works but not declarative

---

## 8. Kubernetes Layer

### Distribution

The reference architecture uses **kubeadm** for Kubernetes cluster bootstrap:

- Default Cluster API bootstrap provider — first-class Metal3 integration
- Vanilla upstream Kubernetes — no vendor-specific patches
- Most documented path for Metal3 + CAPI deployments

**k3s** is documented as a lightweight alternative for simpler setups or demo environments where Cluster API is not used.

### Cluster Topology

The platform operates two logical cluster tiers:

```
┌─────────────────────────────┐     ┌─────────────────────────────┐
│    MANAGEMENT CLUSTER        │     │    WORKLOAD CLUSTER(s)       │
│                              │     │                              │
│  KCP (control plane)         │     │  Tenant workloads            │
│  Zitadel (identity)          │     │  (pods, VMs, GPU jobs)       │
│  Prometheus + Grafana        │     │                              │
│  Platform operators          │     │  Cilium (CNI + ingress)      │
│  Metal3 + CAPI               │     │  NVIDIA GPU Operator         │
│  cert-manager                │     │  KubeVirt (VMs)              │
│                              │     │                              │
│  Runs on CPU-only nodes      │     │  Runs on GPU + CPU nodes     │
└─────────────────────────────┘     └─────────────────────────────┘
```

**Why separate clusters:**

- **Fault isolation** — management plane failure doesn't kill tenant workloads (and vice versa)
- **Security boundary** — tenants have zero access to management infrastructure
- **Independent scaling** — scale workload cluster(s) without touching management
- **Upgrade flexibility** — management and workload clusters can be at different K8s versions

In production, the workload tier can be multiple clusters (e.g., per-rack, per-GPU-type, per-region). The management cluster treats them all the same via operators.

---

## 9. Tenant Model and Isolation

### Isolation Layers

Tenant isolation operates at two levels:

```
Layer 1: API Isolation (KCP)
─────────────────────────────────────────────
- Each tenant gets a KCP workspace
- Independent CRDs, RBAC, secrets
- Tenants cannot discover each other
- Full API-level isolation
- ResourceQuota per workspace

Layer 2: Workload Isolation (Backend Cluster)
─────────────────────────────────────────────
- Each tenant gets a namespace (operator-managed)
- Cilium NetworkPolicy: deny all cross-tenant traffic
- ResourceQuota per namespace
- gVisor RuntimeClass for non-GPU workloads (optional)
- Whole GPU allocation (no sharing in v1)
```

Tenants never interact with Layer 2 directly. They only see their KCP workspace (Layer 1). The platform operators create and manage Layer 2 resources on the tenants' behalf.

### Workspace Lifecycle

```
1. User signs in via OIDC (Google/GitHub)
         │
         ▼
2. Onboarding controller detects new user
   ├── Creates KCP workspace (tenant-{id})
   ├── Binds RBAC (user = workspace admin)
   ├── Creates APIBindings (compute, storage, network, ai)
   ├── Sets ResourceQuota (free tier defaults)
   └── Returns workspace kubeconfig
         │
         ▼
3. User accesses workspace via console/CLI/kubectl
         │
         ▼
4. User creates resources (Compute, VM, Notebook, etc.)
         │
         ▼
5. Operators provision workloads on backend cluster
```

### Tenant Tiers

Tiers are implemented as configuration on the workspace, not as separate infrastructure:

| Tier | Quotas | Access |
|------|--------|--------|
| **Free** | Tight (1 CPU, 2GB RAM, 0 GPU) | Basic APIs |
| **Standard** | Lifted (per-resource limits) | All APIs |
| **Enterprise** | Custom (admin-set) | All APIs + SLA |

> Billing-based tier transitions (pay-as-you-go, prepaid credits, etc.) are covered in [Paper 2](02-billing-metering.md).

---

## 10. Compute Services

### Service Architecture

Compute services are managed by a **single cloud operator** that handles all platform API types. The operator watches tenant resources across KCP virtual workspaces and reconciles them against the backend workload cluster:

```
┌─────────────────────────┐
│  Tenant KCP Workspace    │
│                          │
│  Compute CR ──────────┐  │
│  VM CR ───────────────┤  │
│  Notebook CR ─────────┤  │
│  GPUJob CR ───────────┤  │
│                       │  │
└───────────────────────┼──┘
                        │ APIExport / Virtual Workspace
                        ▼
┌───────────────────────────────────────┐
│  Cloud Operator (management cluster)   │
│                                        │
│  Reconciles all platform API types:    │
│  Compute ────────────▶ Pod/Deployment  │
│  VirtualMachine ─────▶ KubeVirt VM     │
│  Notebook ───────────▶ Pod + Ingress   │
│  GPUJob ─────────────▶ Job + GPU       │
│                                        │
│  The operator:                         │
│  1. Watches virtual workspace          │
│  2. Creates resources in workload      │
│     cluster (tenant namespace)         │
│  3. Updates status back in KCP         │
└───────────────────────────────────────┘
```

### Container Workloads

The `Compute` API provides a simplified container workload interface:

```yaml
apiVersion: compute.cloud.example/v1
kind: Compute
metadata:
  name: my-app
spec:
  image: nginx:latest
  replicas: 2
  resources:
    cpu: "500m"
    memory: "512Mi"
  ports:
    - port: 80
      public: true
```

The cloud operator translates this into Deployment + Service + (optionally) Gateway HTTPRoute on the workload cluster.

### Virtual Machines (KubeVirt)

The `VirtualMachine` API provides VM lifecycle management:

```yaml
apiVersion: compute.cloud.example/v1
kind: VirtualMachine
metadata:
  name: my-vm
spec:
  cores: 4
  memory: "16Gi"
  disk:
    size: "100Gi"
    image: ubuntu-22.04
  gpu:
    count: 1
  ssh:
    publicKey: "ssh-ed25519 AAAA..."
```

The cloud operator translates this into a KubeVirt `VirtualMachineInstance` on the workload cluster. GPU is passed through via PCI passthrough (whole GPU). SSH access is provided via the platform tunnel or an optional public IP.

### AI / Notebook Services

The `Notebook` API provides managed JupyterNotebook instances:

```yaml
apiVersion: ai.cloud.example/v1
kind: Notebook
metadata:
  name: analysis
spec:
  image: jupyter/scipy-notebook:latest
  resources:
    cpu: "2"
    memory: "8Gi"
  gpu:
    count: 1
```

The cloud operator creates a Pod with the Jupyter image, a Service, and a Gateway HTTPRoute for HTTPS access. The tenant receives a URL in the status.

### Extensibility

New service types follow the same pattern:

1. Define an `APIResourceSchema` for the new resource type
2. Create an `APIExport` in the platform workspace
3. Implement an operator that watches the virtual workspace and reconciles against the workload cluster
4. Bind the new APIExport to tenant workspaces (all tenants or selectively)

Examples of services that could be added:
- Managed PostgreSQL/MySQL
- Object storage buckets
- Load balancers
- DNS zones
- Managed Kubernetes clusters (via Kamaji or CAPI + Workspace Mounts)

---

## 11. GPU and Accelerator Management

### v1: Whole GPU Allocation

In the initial version, GPUs are allocated as whole units — one GPU per workload:

```
Pod requests:   nvidia.com/gpu: 1
Scheduling:     Standard Kubernetes scheduler
Monitoring:     DCGM Exporter → Prometheus
```

This is the simplest model with the strongest isolation. No GPU sharing means no risk of cross-tenant interference.

### Components

**NVIDIA GPU Operator** (Apache 2.0) automates the full NVIDIA software stack:
- Driver installation (containerized)
- Container Toolkit configuration
- Device Plugin deployment
- DCGM Exporter for monitoring
- GPU Feature Discovery for node labeling

### Scheduling Flow

```
1. Tenant creates GPUJob in KCP workspace
2. Cloud operator creates Job in workload cluster
3. Standard Kubernetes scheduler places pod on GPU node
4. DCGM Exporter reports GPU metrics to Prometheus
```

### Future: GPU Sharing

GPU sharing is documented but not implemented in v1. Future options:

| Method | How it works | Isolation | GPU support | CNCF |
|--------|-------------|-----------|-------------|------|
| **MIG** | Hardware-partitioned slices | Strong (HW-isolated) | A100, H100, B100+ | N/A |
| **MPS** | CUDA multi-process service | Medium | Any NVIDIA | N/A |
| **Time-slicing** | Software time-multiplexing | Weak | Any NVIDIA | N/A |
| **HAMi** | CUDA interception, memory limits | Medium | Multi-vendor | Sandbox |

**Recommended upgrade path:** MIG on supported GPUs (A100+), HAMi (CNCF Sandbox, Apache 2.0) for older/multi-vendor GPUs.

### Multi-Node Training

For distributed GPU training across multiple nodes, additional infrastructure is required:

- **InfiniBand or RoCE** — high-bandwidth, low-latency GPU-to-GPU networking
- **NCCL** — NVIDIA Collective Communications Library for distributed training
- **GPUDirect RDMA** — direct GPU-to-GPU data transfer bypassing CPU
- **Topology-aware scheduling** — gang scheduling for distributed training jobs

This is documented as a future enhancement. The v1 demo supports single-node GPU workloads only.

---

## 12. Networking

### CNI: Cilium

Cilium (Apache 2.0, CNCF Graduated) serves multiple roles in the platform:

```
Role                    Cilium Feature              Status
─────────────────────────────────────────────────────────────
Container networking    eBPF dataplane              Production
Tenant isolation        NetworkPolicy (L3/L4/L7)    Production
HTTP ingress            Gateway API (HTTPRoute)      Production
TCP/UDP routing         Gateway API (TCPRoute)       Production
Encryption              WireGuard (node-to-node)     Production
Observability           Hubble (flow visibility)     Production
Load balancing          Service load balancing       Production
```

Using Cilium for all networking functions eliminates the need for separate ingress controllers, kube-proxy, and network policy enforcers. One component, multiple roles.

### Overlay Networking

The default networking mode is **VXLAN overlay**:

- Works on any network topology (flat L2, L3 routed, across subnets)
- No special switch/router configuration required
- Suitable for hosted bare metal where underlay control is limited

**Production alternatives** (documented for providers with network control):

| Mode | When to use | Requirements |
|------|------------|--------------|
| VXLAN overlay | Default, works everywhere | None |
| Native routing | Better performance, same L2 | All nodes on same subnet |
| BGP | Multi-rack, L3 routed | BGP-capable switches |

### Tenant Network Isolation

Each tenant namespace gets default-deny Cilium NetworkPolicies:

```yaml
apiVersion: cilium.io/v2
kind: CiliumNetworkPolicy
metadata:
  name: tenant-isolation
  namespace: tenant-a
spec:
  endpointSelector: {}
  ingress:
    - fromEndpoints:
        - matchLabels:
            io.kubernetes.pod.namespace: tenant-a
  egress:
    - toEndpoints:
        - matchLabels:
            io.kubernetes.pod.namespace: tenant-a
    - toEntities:
        - world  # allow internet egress (configurable)
    - toCIDR:
        - 10.96.0.0/12  # allow cluster DNS
```

This ensures tenants cannot reach each other's workloads at the network level.

### Tenant Access to Workloads

**HTTP workloads** — Cilium Gateway API provides multi-tenant ingress:

```
tenant-a.cloud.example.com ──▶ Gateway HTTPRoute ──▶ tenant-a/service
tenant-b.cloud.example.com ──▶ Gateway HTTPRoute ──▶ tenant-b/service
```

Combined with **cert-manager** for automated Let's Encrypt TLS certificates and **external-dns** for DNS record automation.

**SSH access** — two modes:

1. **Tunnel (default)** — custom CLI opens a gRPC/WebSocket tunnel through the platform:
   ```
   $ cloud ssh my-vm
   # CLI authenticates via Zitadel, opens tunnel, connects to VM
   ```
   No public IP needed. Most secure.

2. **Public IP (opt-in)** — tenant requests a `PublicIP` resource in KCP. MetalLB allocates an IP from the provider's pool. SSH directly to the assigned IP.

---

## 13. Storage

### Architecture: Rook-Ceph

The reference architecture uses Rook-Ceph (Apache 2.0, CNCF Graduated) for unified storage:

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

### Why Rook-Ceph

- **Single system** for block + object storage (fewer components to operate)
- **CNCF Graduated** (Rook) — mature, well-governed
- **Self-healing** — automatic data rebalancing and recovery
- **Per-tenant quotas** — CephBlockPool and CephObjectStoreUser CRDs
- **S3 compatibility** — RGW provides S3 API for tenant object storage

### Minimum Requirements

- 3+ nodes with dedicated storage devices (HDDs or SSDs)
- Dedicated OSD disks (not shared with OS)
- 10GbE recommended for replication traffic

### Per-Tenant Storage

Storage services are exposed as KCP APIs:

```yaml
apiVersion: storage.cloud.example/v1
kind: Volume
metadata:
  name: my-data
spec:
  size: "100Gi"
  storageClass: ssd  # or hdd
```

```yaml
apiVersion: storage.cloud.example/v1
kind: ObjectBucket
metadata:
  name: my-datasets
spec:
  quota: "500Gi"
```

Operators translate these into Ceph resources on the workload cluster, with per-tenant quotas enforced.

### Alternatives

| Project | Type | License | CNCF | Best for |
|---------|------|---------|------|----------|
| **Rook-Ceph** | Block + Object + FS | Apache 2.0 | Graduated | **Reference choice** |
| Longhorn | Block only | Apache 2.0 | Incubating | Simpler deployments |
| MinIO | Object only | AGPL-3.0 | None | Dedicated S3 |
| OpenEBS | Block (Mayastor) | Apache 2.0 | Sandbox | NVMe performance |
| TopoLVM | Local block | Apache 2.0 | None | Scratch/ephemeral |

For simpler deployments: **Longhorn** (block) + **MinIO** (object) is a lighter alternative to Rook-Ceph at the cost of operating two systems.

---

## 14. Observability

### v1 Stack

```
Component           Role                    License        Source
───────────────────────────────────────────────────────────────────
Prometheus          Metrics collection      Apache 2.0     CNCF Graduated
DCGM Exporter       GPU metrics             Apache 2.0     NVIDIA
Grafana             Dashboards              AGPL-3.0       Independent
```

### Metrics Pipeline

```
Workload Cluster                    Management Cluster
─────────────────                   ──────────────────
kubelet ──────────┐
node-exporter ────┤
DCGM Exporter ────┤── Prometheus ──remote-write──▶ Prometheus
kube-state-metrics┘                  (central)        │
                                                      ▼
                                                  Grafana
                                                 (dashboards)
```

### Dashboards

Pre-built Grafana dashboards:

- **Platform overview** — total tenants, total workloads, resource utilization
- **Per-tenant** — resource consumption, active workloads (admin view)
- **Infrastructure** — node health, GPU utilization, storage capacity, network throughput
- **SLA/SLO** — API latency, availability, error rates

Tenant-facing metrics are exposed through the web console, not Grafana directly.

### Future Additions

- **Loki** (AGPL-3.0) — log aggregation, indexed by labels (lightweight)
- **OpenTelemetry Collector** (Apache 2.0) — unified telemetry collection for traces, metrics, logs
- **Tempo** (AGPL-3.0) — distributed tracing

---

## 15. Custom CLI

### Purpose

The custom CLI (`cloud` or provider-branded) is the primary programmatic interface to the platform. It wraps kubectl with platform-specific workflows:

```
$ cloud login                    # Device auth via Zitadel
$ cloud workspace list           # List my workspaces
$ cloud create notebook my-nb    # Create a Jupyter notebook
$ cloud ssh my-vm                # Tunnel SSH to a VM
$ cloud status                   # Show resource usage
$ cloud kubeconfig               # Get kubeconfig for workspace
```

### Authentication

The CLI uses Zitadel's **device authorization grant**:

```
$ cloud login
Open this URL in your browser: https://auth.cloud.example.com/device
Enter code: ABCD-1234

Waiting for authorization... done.
Logged in as user@example.com (workspace: tenant-xyz)
```

Tokens are cached locally and refreshed automatically.

### SSH Tunneling

```
$ cloud ssh my-vm

# Under the hood:
# 1. CLI authenticates with KCP
# 2. CLI opens gRPC stream to tunnel service
# 3. Tunnel service connects to VM's SSH port in workload cluster
# 4. CLI pipes local stdin/stdout through the tunnel
```

No public IP needed. The tunnel service runs on the management cluster and has network access to the workload cluster.

### kubectl Compatibility

The CLI generates standard kubeconfig files pointing to the tenant's KCP workspace:

```
$ cloud kubeconfig > ~/.kube/config
$ kubectl get notebooks
NAME        STATUS   URL
analysis    Ready    https://analysis.tenant-xyz.cloud.example.com
```

---

## 16. Web Console

### Purpose

The web console is a multi-tenant dashboard for tenants who prefer a GUI:

- **Login** — OIDC via Zitadel (Google, GitHub, etc.)
- **Resource management** — create, view, delete workloads (Compute, VMs, Notebooks, GPU jobs)
- **Access** — one-click links to Jupyter notebooks, VM consoles
- **Settings** — SSH keys, API tokens, workspace configuration

### Architecture

The console is a single-page application that talks directly to:

- **KCP** — for resource CRUD (via standard Kubernetes API with JWT auth)
- **Zitadel** — for authentication (OIDC authorization code flow)

No backend-for-frontend needed — the console is a static site that uses the existing APIs.

> Billing and usage dashboards in the console are covered in [Paper 2](02-billing-metering.md).

---

## 17. Security Model

### Authentication Chain

```
User → Zitadel (OIDC) → JWT → KCP Front Proxy → Workspace
```

KCP validates JWTs using Zitadel's JWKS endpoint. The JWT `sub` claim maps to a KCP user, `groups` claim maps to RBAC groups.

### Authorization Chain

KCP's built-in multi-layer authorization:

1. **Workspace Access** — user must have `access` verb on the workspace
2. **Required Groups** — workspace can require specific group membership
3. **RBAC** — standard Kubernetes RBAC within the workspace
4. **Maximal Permission Policy** — APIExport owner can restrict what consumers can do
5. **ResourceQuota** — prevents resource exhaustion

### Workload Isolation

| Boundary | Mechanism |
|----------|-----------|
| API isolation | KCP workspaces (logical clusters) |
| Network isolation | Cilium NetworkPolicy (default deny cross-tenant) |
| Compute isolation | Separate namespaces, ResourceQuota |
| GPU isolation | Whole GPU allocation (no sharing) |
| Runtime sandboxing | gVisor RuntimeClass (non-GPU workloads) |
| Storage isolation | Per-tenant Ceph quotas and pools |

### Data Sovereignty

- All data stored on the provider's infrastructure
- No data leaves the platform unless the tenant explicitly configures it
- Zitadel runs self-hosted — no external identity dependency required

### Supply Chain Security

- All container images from trusted registries (or provider-hosted mirror)
- Flatcar's immutable OS reduces host attack surface
- No SSH access to nodes (Talos-style operational model recommended)
- etcd encryption at rest for KCP and workload cluster secrets

---

## 18. Component Summary

### Core Components

| Component | Role | License | CNCF Status | Language |
|-----------|------|---------|-------------|----------|
| **KCP** | Multi-tenant control plane | Apache 2.0 | — | Go |
| **Zitadel** | Identity / OIDC | AGPL-3.0 | — | Go |
| **Kubernetes** (kubeadm) | Workload orchestration | Apache 2.0 | Graduated | Go |
| **Cilium** | CNI + NetworkPolicy + Ingress | Apache 2.0 | Graduated | Go |

### Infrastructure Components

| Component | Role | License | CNCF Status |
|-----------|------|---------|-------------|
| **Metal3** | Bare metal provisioning | Apache 2.0 | Incubating |
| **Flatcar** | Immutable OS | Apache 2.0 | Incubating |
| **Cluster API** | Cluster lifecycle | Apache 2.0 | — |
| **Rook-Ceph** | Storage (block + object) | Apache 2.0 | Graduated |
| **cert-manager** | TLS certificates | Apache 2.0 | — |

### Workload Components

| Component | Role | License | CNCF Status |
|-----------|------|---------|-------------|
| **NVIDIA GPU Operator** | GPU management | Apache 2.0 | — |
| **KubeVirt** | VM management | Apache 2.0 | Incubating |
| **gVisor** | Runtime sandboxing | Apache 2.0 | — |

### Observability Components

| Component | Role | License | CNCF Status |
|-----------|------|---------|-------------|
| **Prometheus** | Metrics collection | Apache 2.0 | Graduated |
| **DCGM Exporter** | GPU metrics | Apache 2.0 | — |
| **Grafana** | Dashboards | AGPL-3.0 | — |

### External Integrations (Swappable)

| Integration | Default | Alternatives |
|-------------|---------|-------------|
| OIDC Provider | Google, GitHub | Any OIDC-compliant IdP |
| DNS Provider | External-DNS (configurable) | Any DNS API |
| TLS CA | Let's Encrypt | Any ACME CA, internal CA |

---

## 19. Licensing and Sovereignty

### License Summary

All components use OSI-approved open source licenses:

```
Apache 2.0 (permissive):  KCP, Metal3, Flatcar, Cilium, Kubernetes,
                           Rook-Ceph, KubeVirt,
                           Prometheus, cert-manager,
                           NVIDIA GPU Operator, gVisor, Cluster API

AGPL-3.0 (copyleft):      Zitadel (server), Grafana
                           → deployed unmodified, no copyleft impact
                             on platform code

MIT:                       Zitadel SDKs
```

No BSL, SSPL, or proprietary licenses in the stack. No commercial components required.

### EU Alignment

Several components have EU origins:

| Component | Origin |
|-----------|--------|
| Metal3 | Co-maintained by Ericsson (Sweden) |
| Flatcar | Created by Kinvolk (Berlin, Germany) |
| Zitadel | CAOS AG (Zurich, Switzerland) |
| Rook-Ceph | Ceph originally from Inktank/Red Hat, Rook community-driven |

### Vendor Independence

- No single-vendor control over any critical component
- All CNCF projects have multi-stakeholder governance
- No CLA requirements that could enable relicensing
- Full source available — provider can fork any component if needed

---

## 20. Relationship to Sovereign Cloud Initiatives

This reference architecture is an **independent, CNCF-aligned** project. It acknowledges and is compatible with broader sovereign cloud initiatives but does not bind itself to their specific standards:

### Sovereign Cloud Stack (SCS)

SCS is a German government-funded reference implementation based on OpenStack + Kubernetes. Our architecture differs in philosophy:

- SCS uses OpenStack for IaaS; we use Kubernetes-native APIs (KCP + operators)
- SCS targets full cloud provider compliance; we target minimal viable platform
- Both share Kubernetes for CaaS and CNCF ecosystem values

### Gaia-X

Gaia-X defines trust, interoperability, and portability standards for European data infrastructure. Our architecture is compatible with Gaia-X principles:

- Data sovereignty (all data on provider infrastructure)
- Transparency (open source, auditable)
- Interoperability (standard APIs: Kubernetes, S3, OIDC)

### IPCEI-CIS

The EU's Important Project of Common European Interest on Cloud Infrastructure and Services (EUR 2.6B investment) is building federated edge-cloud infrastructure. Our architecture could serve as a lightweight node in such a federation, particularly for edge and small-scale deployments.

---

## 21. Future Enhancements

### Billing and Metering (see Paper 2)

- Usage-based metering (CPU-hours, GPU-hours, storage-GB-months)
- Billing engine integration (OpenMeter or alternatives)
- Payment processing (Stripe and alternatives)
- Quota enforcement via billing entitlements
- See [02-billing-metering.md](02-billing-metering.md) for full details

### GPU Scheduling — Kueue (v2)

- **Kueue** (Apache 2.0, Kubernetes SIG) for advanced job queuing and GPU quota management
- Fair-share scheduling across tenants
- Queue-based resource allocation with preemption policies
- Recommended for production deployments with contended GPU resources

### GPU Sharing (v2)

- **MIG** on A100/H100 for hardware-isolated GPU partitioning
- **HAMi** (CNCF Sandbox, Apache 2.0) for multi-vendor fractional GPU allocation
- **MPS** for concurrent GPU access in inference workloads

### Kubernetes-as-a-Service (v2)

- Tenants can provision managed Kubernetes clusters
- **Kamaji** (Apache 2.0) for hosted control planes
- **KCP Workspace Mounts** to expose provisioned clusters as sub-workspaces
- Tenant gets a kubeconfig to their own cluster

### Multi-Node GPU Training (v2)

- InfiniBand/RoCE networking for GPU-to-GPU RDMA
- NCCL + GPUDirect integration
- Topology-aware scheduling
- Gang scheduling for distributed training jobs

### Enhanced Observability (v2)

- **Loki** for log aggregation
- **OpenTelemetry Collector** for unified telemetry
- **Tempo** for distributed tracing
- Per-tenant observability dashboards in the web console

### Advanced Networking (v2)

- BGP peering with Cilium for native routing across racks
- Network bandwidth QoS per tenant
- IPv6 support
- VPN/WireGuard mesh for cross-site deployments

### Advanced Isolation (v2)

- CPU pinning and NUMA-aware scheduling for noisy neighbor protection
- Kata Containers for strongest non-GPU workload isolation
- Per-tenant node pools for dedicated hardware

### Federation (v3)

- Multiple sovereign cloud instances federating via KCP sharding
- Cross-site workload placement
- Federated identity via Zitadel organization model
- Alignment with IPCEI-CIS federation patterns

---

## 22. Appendix: Decision Log

This section records the architectural decisions made during design and the rationale behind each.

> Billing-related decisions (billing units, billing models, billing architecture, billing engine selection) are documented in [Paper 2](02-billing-metering.md).

| # | Decision | Choice | Alternatives Considered | Rationale |
|---|----------|--------|------------------------|-----------|
| D01 | Tenant abstraction | API Platform (high-level CRDs) | K8s-as-a-Service, Hybrid | Tenants don't need raw K8s. High-level APIs enable provider control and service evolution. |
| D02 | Control plane | KCP (only control plane, tenants get access handles) | KCP as orchestrator + direct access | Clean separation. Tenants see only KCP workspace APIs. |
| D03 | Sovereignty model | Self-hosted + swappable interfaces | Fully self-hosted, compliance-aligned | Pragmatic. Default to self-hosted, allow external services (OIDC, Stripe) behind interfaces. |
| D04 | Bare metal provisioning | Metal3 | Tinkerbell, Sidero, MAAS | CNCF Incubating, Apache 2.0, 57 orgs, EU involvement (Ericsson). Sidero deprecated. |
| D05 | OS | Flatcar Container Linux | Talos, Ubuntu, Kairos | CNCF Incubating, Apache 2.0, immutable, Metal3-compatible, EU origin (Kinvolk/Berlin). |
| D06 | Network mode | Overlay (demo), all options documented | L2 flat, L3 BGP | Overlay works everywhere. Document production options for providers with network control. |
| D07 | K8s distribution | kubeadm (default), k3s (alternative) | k0s | kubeadm is the reference CAPI bootstrap provider. Best Metal3 integration. |
| D08 | Cluster topology | Management + workload cluster(s) | Single cluster, per-tenant clusters | Fault isolation between management and workload. Security boundary. Independent scaling. |
| D09 | Workload types | Containers + KubeVirt VMs + extensible CRDs | Containers only, VMs only | Platform should support diverse workloads. New types added via CRD + operator. |
| D10 | GPU sharing (v1) | Whole GPU only | MIG, HAMi, time-slicing | Simplest. Strongest isolation. Compatible with gVisor. GPU sharing deferred to v2. |
| D11 | GPU scheduling (v1) | Standard Kubernetes scheduler | Kueue, Volcano, Run:ai | Simplest for v1 with whole-GPU allocation. Kueue recommended for v2 when GPU contention requires queuing. |
| D12 | Multi-node training | Documented, v1 single-node | Full InfiniBand support | Demo hardware won't have InfiniBand. Document for production deployments. |
| D13 | Tenant isolation (API) | KCP workspaces | vCluster, Capsule, Kamaji | KCP gives API isolation at namespace cost. vCluster is overkill when tenants don't need raw K8s. |
| D14 | Tenant isolation (workload) | Namespace + Cilium NetworkPolicy | Dedicated nodes, runtime sandboxing | Sufficient for v1. gVisor optional for non-GPU. Document stronger options. |
| D15 | Tenant discovery | Full isolation (no discovery) | Limited directory | KCP workspaces provide this by default. |
| D16 | Noisy neighbor (v1) | ResourceQuota + whole GPU + Cilium | CPU pinning, NUMA, bandwidth QoS | Sufficient for v1. Advanced protections documented for future. |
| D17 | Identity provider | Zitadel | Dex, Keycloak, Kanidm, Authentik | Go, API-first, multi-tenant, Swiss/EU, lightweight. Supports device auth for CLI. |
| D18 | Onboarding | Free for all + self-service upgrade + admin override | Approval-gated only | Maximizes adoption. Tier-based (free → paid) via billing status. |
| D23 | Storage | Rook-Ceph (block + object) | Longhorn + MinIO, OpenEBS | Unified system. CNCF Graduated. Single operator for block + object. |
| D24 | CNI + ingress | Cilium (CNI + NetworkPolicy + Gateway API) | Calico + Envoy Gateway, Cilium + Contour | Single component for networking + security + ingress. Fewer moving parts. |
| D25 | SSH access | CLI tunnel (default) + public IP (opt-in) | Public IP only, bastion host | Secure by default. No public exposure unless requested. |
| D26 | Observability (v1) | Prometheus + DCGM Exporter + Grafana | Full OTel + Loki + Tempo | Minimal viable stack. Logs and traces deferred to v2. |
| D27 | Target audience | KCP community + small cloud operators + EU sovereign projects | Single audience | Broad relevance. Tone and depth balanced for all three. |
| D28 | Ecosystem alignment | CNCF-aligned, independent | SCS-aligned, Gaia-X certified | We reference sovereign initiatives but don't bind to their standards. |

---

*This document is a living reference. It will be updated as the project evolves and implementation experience refines the architecture.*
