# Layer 2: Multi-Tenant Cloud Platform with KCP

## Slicing Compute for Tenants via Kubernetes-Native APIs

**Version:** 0.1.0-draft
**Date:** 2026-03-26
**Status:** Working Draft

> **This is where the demo lives.** This layer is the primary demonstration target for the sovereign small cloud reference architecture. See [demo.md](demo.md) for step-by-step instructions.

---

## Table of Contents

1. [Overview](#1-overview)
2. [KCP -- The Multi-Tenant Control Plane](#2-kcp--the-multi-tenant-control-plane)
3. [Identity and Access](#3-identity-and-access)
4. [Tenant Model](#4-tenant-model)
5. [Platform APIs -- The Cloud Interface](#5-platform-apis--the-cloud-interface)
6. [Cloud Operator](#6-cloud-operator)
7. [Tenant Onboarding](#7-tenant-onboarding)
8. [Custom CLI](#8-custom-cli)
9. [Web Console](#9-web-console)
10. [Observability](#10-observability)
11. [Component Summary](#11-component-summary)
12. [Demo](#12-demo)
13. [What's Next](#13-whats-next)

---

## 1. Overview

Layer 2 takes the compute-ready Kubernetes cluster from Layer 1 and turns it into a multi-tenant cloud platform where tenants create workloads via high-level APIs. This is the answer to: "I have a running K8s cluster -- now how do I let multiple tenants use it as a cloud?"

This layer adds four capabilities on top of Layer 1 infrastructure:

1. **Multi-tenancy** -- isolated workspaces per tenant via KCP
2. **Cloud APIs** -- high-level resource types (Compute, VM, Notebook, GPUJob, Volume, ObjectBucket, PublicIP) exposed through KCP's APIExport/APIBinding mechanism
3. **Identity** -- OIDC-based authentication for web, CLI, and programmatic access
4. **Cloud Operator** -- a single operator that watches tenant resources and provisions workloads on the backend cluster

### What This Layer Does NOT Cover

- **Bare metal provisioning, OS, Kubernetes bootstrap** -- that is Layer 1. See [01-infrastructure.md](01-infrastructure.md).
- **Billing, metering, charging, advanced monitoring, backup/DR, day-2 operations** -- that is Layer 3. See [03-production.md](03-production.md).

### Prerequisites

- A running management cluster (KCP, operators, identity will be deployed here)
- A running workload cluster (tenant workloads will be scheduled here)
- Networking between management and workload clusters
- DNS and TLS infrastructure (cert-manager, external-dns)
- Storage provisioner (Rook-Ceph or alternative) on the workload cluster

All of these are provided by Layer 1.

### Architecture at a Glance

```
                     TENANTS / USERS
               Web Console  .  CLI  .  kubectl
                          |
                          | OIDC (Google, GitHub, ...)
                          | via Dex (OIDC)
                          v
               KCP  (Multi-Tenant Control Plane)
    +------------+ +------------+ +------------+ +-----------+
    | Workspace  | | Workspace  | | Workspace  | |  System   |
    | tenant-a   | | tenant-b   | | tenant-c   | | (platform)|
    |            | |            | |            | |           |
    | Compute    | | Compute    | | Compute    | | APIExports|
    | VM         | | GPU        | | VM         | | Operators |
    | Storage    | | Storage    | | Notebook   | |           |
    +------------+ +------------+ +------------+ +-----------+
                          |
                          | Virtual Workspaces
                          | (operators reconcile tenant resources)
                          v
              Cloud Operator (management cluster)
                          |
                          | Creates workloads
                          v
               WORKLOAD CLUSTER(s)
    +-------------------------------------------------------+
    |  Namespaces per tenant (operator-managed):             |
    |  +----------+ +----------+ +----------+               |
    |  |tenant-a  | |tenant-b  | |tenant-c  |               |
    |  | pods     | | pods     | | VMs      |               |
    |  | services | | GPU jobs | | services |               |
    |  +----------+ +----------+ +----------+               |
    |                                                       |
    |  Cilium (CNI + NetworkPolicy + Gateway API)           |
    |  NVIDIA GPU Operator . KubeVirt                       |
    +-------------------------------------------------------+
```

---

## 2. KCP -- The Multi-Tenant Control Plane

### What KCP Is

KCP is not another Kubernetes cluster. It is a multi-tenant API server that speaks the Kubernetes API but is purpose-built for offering APIs as services to many isolated tenants. Think of it as the "control plane only" part of Kubernetes, extended with first-class multi-tenancy.

KCP provides:

- **Workspaces** -- isolated logical clusters per tenant. Each workspace has its own CRDs, RBAC, secrets, and API surface. Tenants cannot see or discover each other's workspaces.
- **APIExport / APIBinding** -- the mechanism by which the platform operator defines APIs centrally and makes them available to tenant workspaces. The platform exports APIs (Compute, VM, etc.) and tenant workspaces bind to them.
- **Virtual Workspaces** -- a projected view across all tenant workspaces. Operators use this to watch and reconcile tenant resources without needing access to each workspace individually.
- **Front Proxy** -- a stateless proxy that routes API requests to the correct workspace and shard. All tenant traffic enters through the front proxy.
- **ResourceQuota** -- per-workspace resource limits, preventing any single tenant from exhausting platform capacity.

### Why KCP (and Not Something Else)

KCP was purpose-built for this exact use case. Here is how it compares to alternatives:

| Approach | Isolation | Cost per Tenant | API Customization | Fit for Cloud Platform |
|----------|-----------|-----------------|-------------------|----------------------|
| **Namespaces** | Weak (shared CRDs, shared RBAC) | Near zero | None | Poor -- tenants share everything |
| **Capsule** | Namespace grouping + policy | Near zero | None | Poor -- still shared CRDs |
| **vCluster** | Virtual apiserver per tenant | Medium (pod per tenant) | Full K8s | Overkill -- tenants don't need raw K8s |
| **Kamaji** | Full cluster per tenant | High | Full K8s | Overkill -- expensive at scale |
| **KCP** | **Logical cluster (workspace)** | **Near zero** | **Full (APIExport)** | **Ideal** |

KCP gives the API customization and isolation of virtual clusters at the cost profile of namespaces. Tenants get a workspace that looks like their own cluster with only the APIs the platform chooses to expose -- no raw Kubernetes primitives leaking through.

### Tenant Interaction Model

Tenants never see or interact with the backend Kubernetes clusters. Their entire world is a KCP workspace:

```
$ kubectl --kubeconfig=tenant.kubeconfig get apiresources
NAME              SHORTNAMES   APIVERSION                  NAMESPACED
computes          vm           compute.cloud.example/v1    true
gpujobs           gj           ai.cloud.example/v1         true
notebooks         nb           ai.cloud.example/v1         true
volumes           vol          storage.cloud.example/v1    true
objectbuckets     ob           storage.cloud.example/v1    true
publicips         pip          network.cloud.example/v1    true
```

These are the only APIs the tenant can see. No Pods, no Deployments, no Nodes. The platform controls the abstraction level completely.

### APIExport / APIBinding Pattern

The platform operator defines APIs in a system workspace and exports them. Tenant workspaces bind to these exports. This is how the platform "injects" APIs into tenant workspaces without giving tenants any control over the API definitions.

### Virtual Workspaces

When the cloud operator needs to reconcile resources across all tenants, it connects to a **virtual workspace** -- a projected view that aggregates resources from all tenant workspaces that have bound a particular APIExport. The operator watches this single endpoint and reconciles all tenant resources through it. Status updates written back through the virtual workspace are routed to the correct tenant workspace automatically.

### Deployment

KCP runs on the management cluster, deployed via **kcp-operator**:

- **kcp-server** -- the multi-tenant API server (one or more replicas)
- **kcp-front-proxy** -- stateless request router
- **etcd** -- KCP's datastore (dedicated or shared with the management cluster)

For a small deployment (2-3 racks), a single KCP shard is sufficient. KCP supports sharding for scale-out, with the front proxy routing transparently across shards.

> Reference: `deploy/kcp/`

---

## 3. Identity and Access

### OIDC Authentication

The platform authenticates all users via OIDC. KCP is configured with `--oidc-issuer-url` pointing to the identity provider. Users authenticate through the IdP and receive a JWT that KCP trusts.

Supported external identity providers (federated through the platform IdP):

- Google
- GitHub
- Corporate IdPs (SAML, LDAP via federation)
- Any OIDC-compliant provider

### Dex -- The Default Identity Broker

Dex is the default OIDC broker for Layer 2. It federates external identity providers (Google, GitHub) into a single OIDC issuer that KCP trusts.

**Why Dex:**

- **Apache 2.0** -- fully permissive, no copyleft
- **Go** -- same language as KCP and the rest of the stack
- **~50MB RAM** -- smallest footprint of any OIDC broker
- **Simple** -- static YAML config, no database required
- **Proven** -- used by Kubernetes itself, ArgoCD, and many CNCF projects
- **Connectors** -- Google, GitHub, GitLab, LDAP, SAML, OIDC

Dex is a pure broker -- it authenticates users via upstream providers and issues JWTs. It does **not** manage users, API keys, or profiles. For those features, upgrade to Zitadel in Layer 3.

### Upgrading to Zitadel (Layer 3)

When you need user management, API keys (PATs), device authorization for CLI, or org/team hierarchy, upgrade to **Zitadel** (see `03-production.md`). The swap is seamless -- only `--oidc-issuer-url` changes on KCP.

### Interface-Based Design

The identity provider is behind a well-defined OIDC interface. To swap providers, the replacement must:

1. Issue JWTs with the expected claims (`sub`, `email`, `groups`)
2. Expose a JWKS endpoint for KCP token verification
3. Support the authorization code flow (for web console)

KCP's `--oidc-issuer-url` is the only configuration point that changes. The rest of the platform is unaware of which IdP is running.

### Authentication Flows

**Web Console (authorization code flow):**

```
Browser --> Console --> Dex --> Google/GitHub --> JWT --> KCP
```

The console redirects to Dex, Dex redirects to the upstream provider (Google/GitHub), user authenticates, Dex issues a JWT, console uses it for KCP API calls.

**CLI (token-based):**

```
$ cloud login
Opening browser for authentication...
Logged in as user@example.com (workspace: tenant-xyz)
```

The CLI opens a browser for the OIDC authorization code flow with a local callback. Tokens are cached locally and refreshed automatically. For headless environments, upgrade to Zitadel (Layer 3) which supports the device authorization grant.

**Programmatic:**

For CI/CD and automation in Layer 2, use static tokens or service account kubeconfigs generated by KCP. For proper machine-to-machine auth with PATs, upgrade to Zitadel (Layer 3).

### License

- **Dex:** Apache 2.0

---

## 4. Tenant Model

### Workspace Lifecycle

When a new user signs up, the platform automatically provisions their environment:

```
1. User signs in via OIDC (Google/GitHub)
         |
         v
2. Onboarding controller detects new user
   +-- Creates KCP workspace (tenant-{id})
   +-- Binds RBAC (user = workspace admin)
   +-- Creates APIBindings (compute, storage, network, ai)
   +-- Sets ResourceQuota (default limits)
   +-- Returns workspace kubeconfig
         |
         v
3. User accesses workspace via console/CLI/kubectl
         |
         v
4. User creates resources (Compute, VM, Notebook, etc.)
         |
         v
5. Operators provision workloads on backend cluster
```

The tenant sees only their workspace. From their perspective, it looks like a Kubernetes cluster with a curated set of APIs.

### Tenant Isolation

Isolation operates at two levels:

**API Layer (KCP workspaces):**

- Each tenant gets a dedicated KCP workspace (logical cluster)
- Independent CRDs, RBAC, secrets per workspace
- Tenants cannot discover each other's workspaces
- ResourceQuota limits per workspace
- Full API-level isolation -- a tenant's `kubectl get` only returns their own resources

**Workload Layer (backend cluster):**

- Each tenant gets a namespace on the workload cluster (operator-managed)
- Cilium NetworkPolicy enforces default-deny cross-tenant traffic
- ResourceQuota per namespace prevents resource exhaustion
- gVisor RuntimeClass for non-GPU workloads (optional, stronger isolation)
- Whole GPU allocation (no sharing in v1)

Tenants never interact with the workload layer directly. They only see their KCP workspace. The cloud operator creates and manages workload-layer resources on behalf of tenants.

### Tenant Network Isolation

Each tenant namespace gets default-deny Cilium NetworkPolicies that restrict ingress and egress to same-namespace traffic only (plus DNS and internet egress). This ensures tenant workloads cannot reach each other at the network level, even though they share the same physical cluster.

### Resource Limits (No Billing in This Layer)

Resource limits in Layer 2 use basic Kubernetes ResourceQuota. This is not billing -- it is resource protection:

| Tier | CPU | Memory | GPU | Purpose |
|------|-----|--------|-----|---------|
| **Default** | 4 cores | 8Gi | 0 | Initial allocation for all tenants |
| **Extended** | 16 cores | 32Gi | 2 | Admin-adjusted for verified tenants |
| **Custom** | Admin-set | Admin-set | Admin-set | Per-tenant negotiation |

Billing-based tier transitions (pay-as-you-go, prepaid credits, automatic upgrades) are covered in [Layer 3](03-production.md). In Layer 2, resource limits are set by platform administrators manually.

---

## 5. Platform APIs -- The Cloud Interface

### Design Pattern

Every platform API follows the same pattern:

1. **APIResourceSchema** -- defines the resource type (like a CRD, but KCP-native)
2. **APIExport** -- makes the API available for tenant workspaces to bind
3. **Cloud Operator** -- watches the virtual workspace, reconciles tenant resources against the workload cluster

This pattern is repeatable. Adding a new service type (e.g., managed PostgreSQL) means defining a new schema and adding a reconciler to the cloud operator. No platform core changes required.

### Compute API

Container workloads with a simplified interface. The tenant writes:

```yaml
apiVersion: compute.cloud.example/v1
kind: Compute
metadata:
  name: my-app
  namespace: default
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

The cloud operator translates this into a Deployment + Service + Gateway HTTPRoute on the workload cluster. The tenant sees back a status with `phase: Running`, replica count, and the public URL (`https://my-app.tenant-a.cloud.example.com`).

### VirtualMachine API

VM lifecycle management via KubeVirt. The tenant writes:

```yaml
apiVersion: compute.cloud.example/v1
kind: VirtualMachine
metadata:
  name: my-vm
  namespace: default
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

The cloud operator creates a KubeVirt `VirtualMachineInstance` with PCI passthrough for GPU. The tenant sees back a status with `phase: Running`, a tunnel command (`cloud ssh my-vm`), and a console URL. SSH access is provided via the platform tunnel (no public IP needed).

### Notebook API

Managed Jupyter notebook instances. The tenant writes:

```yaml
apiVersion: ai.cloud.example/v1
kind: Notebook
metadata:
  name: analysis
  namespace: default
spec:
  image: jupyter/scipy-notebook:latest
  resources:
    cpu: "2"
    memory: "8Gi"
  gpu:
    count: 1
```

The cloud operator creates a Pod with the Jupyter image, a Service, and a Gateway HTTPRoute for HTTPS access. The tenant sees back a status with `phase: Ready`, an access URL, and an auto-generated token.

### GPUJob API

Batch GPU workloads. The tenant writes:

```yaml
apiVersion: ai.cloud.example/v1
kind: GPUJob
metadata:
  name: training-run
  namespace: default
spec:
  image: my-registry/training:v1
  command: ["python", "train.py"]
  resources:
    cpu: "4"
    memory: "32Gi"
  gpu:
    count: 1
  timeout: "4h"
```

The cloud operator creates a Kubernetes Job with `nvidia.com/gpu: 1` resource request. The tenant sees back a status with `phase: Running`, start time, GPU model, and utilization percentage.

### Volume API

Block storage backed by Rook-Ceph. The tenant writes:

```yaml
apiVersion: storage.cloud.example/v1
kind: Volume
metadata:
  name: my-data
  namespace: default
spec:
  size: "100Gi"
  storageClass: ssd  # or hdd
```

The cloud operator creates a PersistentVolumeClaim on the workload cluster. The tenant sees back `phase: Bound` with size and storage class confirmed. Volumes can be attached to Compute and VirtualMachine resources.

### ObjectBucket API

S3-compatible object storage backed by Ceph RGW. The tenant writes:

```yaml
apiVersion: storage.cloud.example/v1
kind: ObjectBucket
metadata:
  name: my-datasets
  namespace: default
spec:
  quota: "500Gi"
```

The cloud operator creates a Ceph ObjectBucketClaim. The tenant sees back `phase: Ready` with an S3 endpoint, bucket name, and a Secret containing S3 credentials.

### PublicIP API

Optional public IP allocation via MetalLB. The tenant writes:

```yaml
apiVersion: network.cloud.example/v1
kind: PublicIP
metadata:
  name: my-ip
  namespace: default
spec:
  attachTo:
    kind: VirtualMachine
    name: my-vm
```

The cloud operator creates a MetalLB Service of type LoadBalancer and routes traffic to the target resource. The tenant sees back `phase: Allocated` with the assigned public IP address.

> Reference: `deploy/platform-apis/`

---

## 6. Cloud Operator

### Single Operator, All API Types

The cloud operator is a single binary that handles all platform API types. It runs on the management cluster and reconciles tenant resources against the workload cluster:

```
+-----------------------------------------------+
|  Cloud Operator (management cluster)           |
|                                                |
|  Reconcilers:                                  |
|  Compute -----------------> Deployment         |
|  VirtualMachine ----------> KubeVirt VM        |
|  Notebook ----------------> Pod + Ingress      |
|  GPUJob ------------------> Job + GPU          |
|  Volume ------------------> PVC                |
|  ObjectBucket ------------> OBC                |
|  PublicIP ----------------> Service (LB)       |
|                                                |
|  Each reconciler:                              |
|  1. Watches KCP virtual workspace              |
|  2. Creates workloads in tenant namespace      |
|     on workload cluster                        |
|  3. Applies NetworkPolicy for isolation        |
|  4. Updates status back in KCP                 |
+-----------------------------------------------+
```

### Reconciliation Pattern

Every reconciler follows the same lifecycle:

1. **WATCH** -- Connect to KCP virtual workspace, watch for create/update/delete of its resource type.
2. **MAP** -- Determine the tenant namespace on the workload cluster (`tenant-{workspace-id}`).
3. **ENSURE** -- Ensure the tenant namespace exists. Create it if missing. Apply default NetworkPolicy.
4. **CREATE** -- Create the backend resource (Pod, VM, Job, PVC, etc.) in the tenant namespace. Labels link back to the KCP resource.
5. **STATUS** -- Watch the backend resource for status changes and write status back to KCP via the virtual workspace.
6. **DELETE** -- When the tenant deletes the KCP resource, delete the backend resource and clean up.

### Extensibility

Adding a new resource type requires: (1) define a new `APIResourceSchema` in KCP, (2) add it to the platform's `APIExport`, (3) implement a new reconciler in the cloud operator, (4) bind the updated APIExport to tenant workspaces. Examples: managed PostgreSQL, DNS zones, load balancers, managed Kubernetes clusters (via Kamaji).

### Deployment Note

The reference YAML in `deploy/operators/` shows separate operator deployments for clarity and readability. In practice, all reconcilers should be compiled into a **single binary** to reduce operational overhead. One Deployment, one image, multiple reconcilers.

> Reference: `deploy/operators/`

---

## 7. Tenant Onboarding

### Onboarding Controller

The onboarding controller runs on the management cluster and watches for new users. When a user authenticates for the first time, the controller provisions their environment:

```
New OIDC user detected
         |
         v
Create KCP workspace (tenant-{user-id})
         |
         v
Bind platform APIExports to workspace
  +-- compute-api
  +-- storage-api
  +-- network-api
  +-- ai-api
         |
         v
Set RBAC (user = workspace admin)
         |
         v
Set ResourceQuota (default limits)
         |
         v
Workspace ready -- user can create resources
```

### What Gets Created

For each new tenant:

| Resource | Where | Purpose |
|----------|-------|---------|
| Workspace | KCP | Isolated logical cluster for the tenant |
| ClusterRoleBinding | KCP workspace | Grants user admin access to their workspace |
| APIBinding (x4) | KCP workspace | Makes platform APIs available |
| ResourceQuota | KCP workspace | Default resource limits |

The onboarding controller does not create anything on the workload cluster. Workload-cluster resources (namespaces, NetworkPolicies) are created on-demand by the cloud operator when the tenant creates their first resource.

### Self-Service Model

- **Sign up:** Open to all. Any user with a valid OIDC identity can create an account.
- **Default limits:** Tight (prevent abuse without billing).
- **Tier upgrades:** Admin-managed in this layer. Automated tier management via billing is in Layer 3.
- **Admin override:** Platform admins can adjust any tenant's quotas at any time.

> Reference: `deploy/onboarding/`

---

## 8. Custom CLI

### Purpose

The custom CLI (`cloud` or provider-branded) is the primary programmatic interface to the platform. It wraps kubectl with platform-specific workflows:

```
$ cloud login                    # OIDC auth via Dex
$ cloud workspace list           # List my workspaces
$ cloud create compute my-app    # Create a container workload
$ cloud create notebook my-nb    # Create a Jupyter notebook
$ cloud ssh my-vm                # Tunnel SSH to a VM
$ cloud status                   # Show resource usage and quotas
$ cloud kubeconfig               # Get kubeconfig for kubectl
```

### OIDC Login via Dex

The CLI uses the OIDC authorization code flow with a local callback:

```
$ cloud login
Opening browser for authentication...
Logged in as user@example.com (workspace: tenant-xyz)
```

Tokens are stored locally (`~/.config/cloud/tokens.json`) and refreshed automatically. No passwords are stored. For headless/device auth, upgrade to Zitadel in Layer 3.

### SSH Tunneling

The CLI provides SSH access to VMs without requiring a public IP. Under the hood: the CLI authenticates with KCP, opens a gRPC stream to a tunnel service on the management cluster, which connects to the VM's SSH port in the workload cluster. All traffic is authenticated and routed through the platform -- no public IP needed.

```
$ cloud ssh my-vm
Connecting to my-vm via tunnel... connected.
user@my-vm:~$
```

### kubectl Compatibility

The CLI generates standard kubeconfig files pointing to the tenant's KCP workspace:

```
$ cloud kubeconfig > ~/.kube/config
$ kubectl get computes
NAME     PHASE     REPLICAS   URL
my-app   Running   2/2        https://my-app.tenant-xyz.cloud.example.com

$ kubectl get notebooks
NAME       PHASE   URL
analysis   Ready   https://analysis.tenant-xyz.cloud.example.com
```

Tenants who prefer kubectl can use it directly. The CLI is a convenience wrapper, not a requirement.

> Reference: `deploy/cli/`

---

## 9. Web Console

### Purpose

The web console is a multi-tenant dashboard for tenants who prefer a GUI:

- **Login** -- OIDC via Dex (Google, GitHub, etc.)
- **Resource management** -- create, view, delete workloads (Compute, VMs, Notebooks, GPU jobs)
- **Workload access** -- one-click links to Jupyter notebooks, VM consoles
- **Settings** -- SSH keys, API tokens, workspace configuration
- **Resource usage** -- current consumption vs. quota limits

### Architecture

The console is a single-page application (SPA) that talks directly to:

- **KCP** -- for resource CRUD (standard Kubernetes API with JWT auth)
- **Dex** -- for authentication (OIDC authorization code flow)

No backend-for-frontend is needed. The console is a static site that uses the existing APIs. It can be served from any static hosting or as a container on the management cluster.

### What Is NOT in This Layer

The web console in Layer 2 does not include:

- Billing pages
- Usage history / metering dashboards
- Payment method management
- Invoice views

These are added in [Layer 3](03-production.md) when billing and metering are integrated.

> Reference: `deploy/console/`

---

## 10. Observability

### Minimal Stack

Layer 2 includes a minimal observability stack for platform operators. This is not tenant-facing observability -- it is infrastructure monitoring for the platform team.

```
Component           Role                    License        CNCF Status
---------------------------------------------------------------------------
Prometheus          Metrics collection      Apache 2.0     Graduated
DCGM Exporter       GPU metrics             Apache 2.0     --
Grafana             Dashboards              AGPL-3.0       --
```

### Metrics Pipeline

```
Workload Cluster                    Management Cluster
-----------------                   ------------------
kubelet ----------+
node-exporter ----+
DCGM Exporter ----+-- Prometheus --remote-write--> Prometheus
kube-state-metrics+                  (central)        |
                                                      v
                                                  Grafana
                                                 (dashboards)
```

### Platform Dashboards

Pre-built Grafana dashboards for platform operators:

- **Platform overview** -- total tenants, total workloads, resource utilization
- **Per-tenant** -- resource consumption, active workloads (admin view)
- **Infrastructure** -- node health, GPU utilization, storage capacity
- **GPU** -- per-GPU utilization, temperature, memory usage (via DCGM Exporter)

Tenant-facing metrics are exposed through the web console status page, not Grafana directly.

### What Is NOT in This Layer

- Log aggregation (Loki) -- Layer 3
- Distributed tracing (Tempo) -- Layer 3
- OpenTelemetry Collector -- Layer 3
- SLA/SLO monitoring and alerting -- Layer 3
- Per-tenant observability dashboards -- Layer 3

> Reference: `deploy/observability/`

---

## 11. Component Summary

### Layer 2 Components

| Component | Role | License | CNCF Status |
|-----------|------|---------|-------------|
| **KCP** | Multi-tenant control plane | Apache 2.0 | -- |
| **kcp-operator** | KCP deployment and lifecycle | Apache 2.0 | -- |
| **Dex** | OIDC broker | Apache 2.0 | -- |
| **Cloud Operator** | Reconciles all platform API types | Apache 2.0 | -- |
| **Onboarding Controller** | Provisions tenant workspaces | Apache 2.0 | -- |
| **Custom CLI** | Tenant CLI (login, ssh, create) | Apache 2.0 | -- |
| **Web Console** | Tenant GUI | Apache 2.0 | -- |
| **Prometheus** | Metrics collection | Apache 2.0 | Graduated |
| **DCGM Exporter** | GPU metrics | Apache 2.0 | -- |
| **Grafana** | Dashboards | AGPL-3.0 | -- |

### License Note

No BSL, SSPL, or proprietary licenses in the stack. Grafana (AGPL-3.0) is the only copyleft component, deployed unmodified. All other components are Apache 2.0.

---

## 12. Demo

> **This layer is the demo.** See [demo.md](demo.md) for full step-by-step instructions.

### Quick Demo Flow

The demo walks through the complete tenant experience on Layer 2:

```
1. DEPLOY    -- Deploy KCP, Dex, Cloud Operator, Console on
                management cluster. Platform APIs registered.

2. LOGIN     -- User authenticates via CLI or Console.
                $ cloud login

3. ONBOARD   -- Onboarding controller creates workspace, binds APIs,
                sets quotas. User is ready to create workloads.

4. CREATE    -- User creates a Compute workload.
                $ cloud create compute my-app --image nginx:latest

5. OBSERVE   -- Workload is running, URL is assigned.
                $ cloud status
                my-app   Running   https://my-app.tenant-xyz.cloud.example.com

6. SCALE     -- User creates a second workload (Notebook).
                $ cloud create notebook analysis --gpu 1

7. QUOTA     -- User hits ResourceQuota limit.
                $ cloud create compute another-app
                Error: quota exceeded (cpu: 4/4 used)

8. CLEANUP   -- User deletes workloads.
                $ cloud delete compute my-app
```

The demo proves the core value proposition: a tenant can sign in, create workloads via high-level APIs, access them, and hit quota limits -- all without knowing anything about the underlying Kubernetes infrastructure.

---

## 13. What's Next

Layer 2 gives you a working multi-tenant cloud platform. Tenants can sign in, create workloads, access them, and are protected by resource quotas and network isolation. The platform operator has a dashboard for monitoring and can manage tenant tiers manually.

What is missing for production use is covered in **Layer 3** ([03-production.md](03-production.md)):

- **Billing and metering** -- usage tracking, billing engine (OpenMeter), payment processing
- **Automated quota management** -- tier transitions based on billing status
- **Advanced monitoring** -- log aggregation, distributed tracing, SLA/SLO alerting
- **Backup and disaster recovery** -- etcd snapshots, Velero, cross-site replication
- **Security hardening** -- supply chain security, runtime sandboxing, audit logging
- **Day-2 operations** -- upgrade procedures, capacity planning, incident response

Layer 2 is the foundation. Layer 3 makes it production-ready.

---
