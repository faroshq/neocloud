# Sovereign Small Cloud — Billing and Metering

**Paper 2: Usage-Based Billing for Multi-Tenant Platforms**

*Part of the Sovereign Small Cloud Reference Architecture series*

---

## Executive Summary

This paper describes how to add billing and metering to the KCP-based compute platform built in Paper 1 ([01-compute-platform.md](01-compute-platform.md)). It covers the full billing pipeline: collecting usage metrics from workload clusters, aggregating them into billable units, enforcing quotas and entitlements, generating invoices, and collecting payment.

The reference implementation uses **OpenMeter** (Apache 2.0, Go) as the billing engine and **Stripe** as the default payment processor. Both are behind swappable interfaces to preserve sovereignty — providers can replace either component without changing the rest of the stack.

By the end of this guide, your platform will support free-tier tenants with enforced quotas, pay-as-you-go billing, prepaid credit wallets, and subscription plans.

---

## Prerequisites

- **KCP platform from Paper 1 is running.** You need:
  - KCP server with workspace-per-tenant model
  - At least one workload cluster with tenant namespaces
  - Zitadel (or equivalent OIDC provider) for identity
  - Onboarding controller that creates workspaces for new users
- **Helm 3** installed on your management workstation
- **kubectl** with access to both management and workload clusters
- A **Stripe account** (or alternative payment processor) for paid tiers

---

## 1. Billing Architecture Overview

A complete billing system has four layers. Each can be implemented independently, but OpenMeter covers the first three in a single component.

```
┌─────────────────────────────────────────────────────────┐
│                    BILLING PIPELINE                       │
│                                                          │
│  1. METERING      Collect raw usage data                 │
│     What happened?   CPU-seconds, memory, GPU time       │
│                                                          │
│  2. RATING         Apply prices to usage                 │
│     What does it cost?   Per-unit rates, tiered pricing  │
│                                                          │
│  3. INVOICING      Generate bills                        │
│     How much is owed?   Line items, totals, tax          │
│                                                          │
│  4. PAYMENT        Collect money                         │
│     How do we get paid?   Stripe, bank transfer, etc.    │
└─────────────────────────────────────────────────────────┘
```

### Metering Layer

The metering layer collects raw usage data from workload clusters. OpenMeter provides a Kubernetes-native collector (DaemonSet) that scrapes kubelet metrics per pod, labels them by tenant namespace, and emits CloudEvents to the OpenMeter server.

For GPU metrics, DCGM Exporter feeds Prometheus, and a custom bridge converts GPU usage into CloudEvents for OpenMeter.

### Rating Layer

The rating layer applies prices to raw usage. OpenMeter supports per-unit pricing, tiered pricing, and volume discounts. Rates are configured per billing plan and can differ between tenants.

### Invoicing Layer

OpenMeter aggregates rated usage into invoices on a configurable schedule (monthly by default). Invoices contain line items per billing dimension with quantities and amounts.

### Payment Layer

Payment collection is delegated to an external processor (Stripe by default). The platform never handles credit card data. OpenMeter pushes invoice data to the payment processor, which handles collection, receipts, and disputes.

---

## 2. Component Choice: OpenMeter

### Why OpenMeter

OpenMeter was selected as the billing engine for this reference architecture because it covers the most requirements in a single, self-hostable component:

| Criterion | OpenMeter |
|-----------|-----------|
| License | Apache 2.0 |
| Language | Go |
| K8s-native collector | Yes (DaemonSet, scrapes kubelet) |
| Entitlements API | Yes (enables quota enforcement) |
| Built-in billing | Yes (plans, subscriptions, invoicing) |
| Self-hostable | Yes (all data stays on your infrastructure) |
| Payment integration | Stripe (native), others via interface |

### Alternatives Considered

| Engine | Why not chosen |
|--------|---------------|
| **Lago** | Ruby, heavier operational footprint, less K8s-native |
| **Flexprice** | Newer project, smaller community, fewer integrations |
| **Kill Bill** | Java, enterprise-focused, significant operational complexity |
| **Custom** | High development cost, not justified for v1 |

Any of these could replace OpenMeter if a provider has specific requirements. The integration points (CloudEvents in, entitlements API out, payment processor interface) are standard enough to swap.

### OpenMeter Architecture

OpenMeter requires three backing services:

```
┌──────────────────────────────────────────────────────────────┐
│                    OPENMETER (Management Cluster)              │
│                                                               │
│  ┌─────────────┐    ┌──────────────┐    ┌──────────────────┐ │
│  │ Kafka /      │    │ ClickHouse   │    │ PostgreSQL       │ │
│  │ Redpanda     │    │              │    │                  │ │
│  │              │    │ Aggregation  │    │ Plans, customers │ │
│  │ Event        │    │ engine for   │    │ subscriptions,   │ │
│  │ ingestion    │    │ usage data   │    │ entitlements     │ │
│  │ & streaming  │    │              │    │                  │ │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────────┘ │
│         │                   │                   │             │
│         └───────────────────┴───────────────────┘             │
│                          │                                    │
│                   OpenMeter Server                            │
│                   (API + workers)                             │
└──────────────────────────────────────────────────────────────┘
```

- **Kafka / Redpanda** — Event ingestion and streaming. Redpanda is recommended for smaller deployments (single binary, no JVM).
- **ClickHouse** — Columnar storage for high-speed aggregation of usage data. Handles queries like "total CPU-seconds for tenant-a in March" efficiently.
- **PostgreSQL** — Stores plans, customers, subscriptions, entitlements, and invoice records.

---

## 3. Billing Dimensions

### Base Dimensions (v1)

The platform meters three dimensions at launch:

| Dimension | Unit | Collection Method | Sampling |
|-----------|------|-------------------|----------|
| **CPU** | CPU-seconds | OpenMeter K8s collector (kubelet) | Continuous |
| **Memory** | GB-seconds | OpenMeter K8s collector (kubelet) | Sampled 4x/hour |
| **GPU** | GPU-seconds | DCGM Exporter via custom bridge | Continuous |

CPU and GPU are metered continuously from kubelet and DCGM Exporter respectively. Memory is sampled four times per hour (every 15 minutes) and interpolated — this balances accuracy against data volume.

### Extensible Dimensions

The dimension system is designed for extension. Future dimensions are added by emitting new CloudEvents to OpenMeter, with no changes to the core billing pipeline:

| Future Dimension | Unit | Source |
|-----------------|------|--------|
| Storage | GB-months | Rook-Ceph metrics |
| Network egress | GB | Cilium flow logs |
| Public IP | IP-hours | IP allocation controller |
| Object storage | GB-months + requests | MinIO / Ceph RGW metrics |

Each new dimension requires: (1) a metrics source, (2) a CloudEvents emitter, (3) a meter definition in OpenMeter, and (4) pricing configuration in the billing plan.

---

## 4. Billing Models

OpenMeter supports all billing models required for a multi-tenant platform. Models are configured per tenant — different tenants can be on different models simultaneously.

### Free Tier

Free-tier tenants have tight resource quotas and no billing relationship:

- **Quotas**: 1 CPU, 2 GB RAM, 0 GPU
- **Billing**: None required — no payment method on file
- **Purpose**: Trial, evaluation, learning
- **Enforcement**: KCP ResourceQuota + OpenMeter entitlements

Free-tier usage is still metered (for the provider's capacity planning) but not invoiced.

### Pay-as-you-go

Usage events are collected, rated at per-unit prices, and invoiced monthly:

```
Usage events → Rated at per-unit price → Monthly invoice → Stripe charge
```

- Tenant adds payment method to upgrade from free tier
- No commitment, no minimum spend
- Clear per-unit prices published in plan configuration

### Prepaid Credits

Tenant purchases credit grants upfront. Usage is deducted from the credit balance:

```
Tenant buys $100 credits → Usage deducted from balance → Alert at $10 remaining
```

- Credits can have expiration dates
- Multiple credit grants can coexist (FIFO deduction)
- Low-balance alerts via webhook or email
- When credits are exhausted, behavior depends on configuration: either block new workloads or fall back to pay-as-you-go

### Subscription Plans

Fixed monthly plans with included resource bundles. Overage is billed at per-unit rates:

```
$49/month plan includes:
  - 200 CPU-hours
  - 400 GB-hours memory
  - 0 GPU-hours (add-on available)

Overage: $0.05/CPU-hour, $0.01/GB-hour memory
```

### Enterprise

Custom rates, custom invoicing schedules, negotiated terms. Configured manually per tenant in OpenMeter. Typically involves:

- Volume discounts
- Quarterly or annual invoicing
- Custom payment terms (net-30, net-60)
- Dedicated support tier

---

## 5. Tenant Onboarding Integration

Billing is woven into the tenant onboarding flow from Paper 1. The onboarding controller handles both workspace creation and billing setup in a single transaction.

### Onboarding Flow with Billing

```
1. User signs in via OIDC (Google/GitHub/Zitadel)
         │
         ▼
2. Onboarding controller detects new user
   ├── Creates KCP workspace (tenant-{id})
   ├── Binds RBAC (user = workspace admin)
   ├── Creates APIBindings (compute, storage, network, ai)
   ├── Sets ResourceQuota (free tier defaults)
   ├── Creates OpenMeter customer (subject = tenant-{id})
   ├── Creates OpenMeter subscription (free tier plan)
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
         │
         ▼
6. Usage metered → OpenMeter → invoiced → Stripe
```

### OpenMeter Customer + Subscription Creation

When the onboarding controller creates a new tenant, it makes two API calls to OpenMeter:

1. **Create customer** — Associates the tenant ID with an OpenMeter subject. This is the identity that all usage events and entitlements are tracked against.

2. **Create subscription** — Assigns the tenant to the free-tier plan. This sets the initial entitlements (quotas) and billing configuration.

The onboarding controller in `deploy/onboarding/onboarding-controller.yaml` handles this as part of the workspace creation flow.

### Tier Transitions

Tier transitions are self-service and handled by the billing controller:

| Transition | Trigger | Actions |
|-----------|---------|---------|
| Free to Pay-as-you-go | User adds payment method | Update OpenMeter subscription, lift ResourceQuota |
| Free to Prepaid | User purchases credits | Create credit grant in OpenMeter, lift ResourceQuota |
| Pay-as-you-go to Subscription | User selects plan | Update OpenMeter subscription, adjust entitlements |
| Any to Enterprise | Admin action | Manual configuration in OpenMeter |

On upgrade, the billing controller:
1. Verifies payment method or credit balance via OpenMeter API
2. Updates the OpenMeter subscription to the new plan
3. Updates KCP ResourceQuota to match the new tier's limits
4. Updates workspace labels/annotations to reflect the new tier

---

## 6. Quota Enforcement

Quota enforcement prevents tenants from consuming resources beyond their plan limits. It operates at the KCP API level, before any workload reaches the backend cluster.

### KCP Admission Webhook

A custom admission webhook runs in the KCP server context and intercepts resource creation requests:

```
Tenant creates Notebook → KCP admission webhook
  → Queries OpenMeter: "Does tenant-{id} have GPU entitlement?"
  → If yes: allow
  → If no (free tier, credits exhausted): reject with clear error
```

The webhook is deployed via `deploy/quota/quota-webhook.yaml` and checks the OpenMeter entitlements API synchronously during admission.

### Behavior When Quota Exceeded

When a tenant exceeds their plan limits, the webhook rejects the request with a clear, actionable error:

```
Error from server (Forbidden): notebooks.ai.platform.example.com "my-notebook" is
forbidden: GPU entitlement not available on your current plan (free).
Upgrade to a paid plan: https://console.example.com/billing/upgrade
```

The error message includes:
- What resource was denied
- Why (which entitlement is missing)
- How to fix it (link to upgrade)

### Credit Exhaustion

When a prepaid or pay-as-you-go tenant exhausts their credits or exceeds their spending limit:

1. **Existing workloads continue running** — No sudden termination of running pods or VMs
2. **New workload creation is blocked** — The admission webhook rejects new resource creation
3. **Workspace enters read-only mode** — Indicated by a workspace condition
4. **Tenant is notified** — Via email/webhook with instructions to add credits or payment method
5. **Grace period** — Configurable (default: 72 hours) before existing workloads are scaled down

The quota controller (`deploy/quota/quota-controller.yaml`) periodically checks credit balances and updates workspace conditions accordingly.

---

## 7. Payment Processing

### Stripe (Default)

OpenMeter integrates natively with Stripe for payment collection. Stripe handles:

- Credit card and bank account storage (PCI compliance)
- Recurring charges and one-time payments
- Invoice delivery (email or hosted page)
- Dispute and refund management
- Tax calculation (via Stripe Tax)

The platform sends only invoice data (amounts, line items, tenant email) to Stripe. No workload data, usage details, or source code leaves the platform.

### European Alternatives

The payment processor is behind an interface. Providers in jurisdictions where Stripe is not preferred can substitute:

| Processor | Headquarters | Notes |
|-----------|-------------|-------|
| **Mollie** | Netherlands | Strong in EU, supports SEPA, iDEAL |
| **Adyen** | Netherlands | Enterprise-grade, broad EU coverage |
| **Direct bank transfer** | N/A | Manual invoicing, no processor needed |

Swapping the payment processor requires:
1. Implementing the payment processor interface (webhook handlers for payment confirmation)
2. Configuring OpenMeter to use the new processor
3. Updating the tenant-facing console to use the new processor's payment form

### Security Principle

**The platform never handles credit card data directly.** All payment data flows through the payment processor's hosted forms and APIs. This eliminates PCI DSS scope for the platform operator.

---

## 8. Metering Pipeline

### End-to-End Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    WORKLOAD CLUSTER                           │
│                                                              │
│  OpenMeter K8s Collector (DaemonSet)                         │
│  ├── Scrapes kubelet metrics per pod                         │
│  ├── Labels by tenant namespace                              │
│  └── Emits CloudEvents to OpenMeter                          │
│                                                              │
│  DCGM Exporter → Prometheus → (GPU usage per pod)            │
└──────────────────────────┬──────────────────────────────────┘
                           │ CloudEvents (HTTPS)
┌──────────────────────────▼──────────────────────────────────┐
│                    OPENMETER (Management Cluster)             │
│                                                              │
│  Event Ingestion (Kafka/Redpanda)                            │
│      │                                                       │
│      ▼                                                       │
│  Aggregation (ClickHouse)                                    │
│  ├── cpu_seconds (per tenant, per hour)                      │
│  ├── memory_gb_seconds (per tenant, sampled 4x/hour)         │
│  ├── gpu_seconds (per tenant, per hour)                      │
│  └── extensible dimensions                                   │
│      │                                                       │
│      ▼                                                       │
│  Plans & Entitlements                                        │
│  ├── Free tier: 100 CPU-hours/month, 0 GPU                  │
│  ├── Pay-as-you-go: $X/CPU-hour, $Y/GPU-hour                │
│  ├── Prepaid: credit wallet, auto-deduct                     │
│  └── Subscription: fixed plans with included resources       │
│      │                                                       │
│      ▼                                                       │
│  Invoicing → Stripe (or alternative payment processor)       │
└─────────────────────────────────────────────────────────────┘
```

### Collector Configuration

The OpenMeter K8s collector runs as a DaemonSet on every workload cluster node. It requires:

- Read access to kubelet metrics API (via ServiceAccount)
- Network access to the OpenMeter server on the management cluster
- Configuration of which namespaces to meter (tenant namespaces only, not system namespaces)

The collector RBAC and DaemonSet manifests are in:
- `deploy/openmeter/collector-daemonset.yaml`
- `deploy/openmeter/collector-rbac.yaml`

### GPU Metering

GPU usage is metered through a two-step process:

1. **DCGM Exporter** runs as a DaemonSet on GPU nodes and exposes per-GPU metrics to Prometheus
2. **A custom bridge** queries Prometheus for GPU utilization per pod and emits CloudEvents to OpenMeter

This bridge is necessary because DCGM Exporter does not natively emit CloudEvents. The bridge runs as a small deployment on the workload cluster and queries Prometheus every 60 seconds.

---

## 9. Deployment

### Dependencies

OpenMeter requires three backing services deployed on the management cluster:

| Service | Purpose | Resource Estimate |
|---------|---------|-------------------|
| **Kafka / Redpanda** | Event streaming | 2 CPU, 4 GB RAM (Redpanda single-node for small deployments) |
| **ClickHouse** | Usage aggregation | 2 CPU, 8 GB RAM, 100 GB SSD |
| **PostgreSQL** | Plans, customers, state | 1 CPU, 2 GB RAM, 20 GB SSD |

For small deployments (under 100 tenants), Redpanda in single-node mode and ClickHouse with a single shard are sufficient.

### Installation

1. **Deploy OpenMeter and dependencies** using the Helm values in `deploy/openmeter/helm-values.yaml`:

```bash
# Create namespace
kubectl apply -f deploy/openmeter/namespace.yaml

# Install OpenMeter via Helm (includes Redpanda, ClickHouse, PostgreSQL)
helm repo add openmeter https://openmeter.io/helm-charts
helm install openmeter openmeter/openmeter \
  -n openmeter \
  -f deploy/openmeter/helm-values.yaml
```

2. **Deploy the K8s collector** on each workload cluster:

```bash
# On the workload cluster
kubectl apply -f deploy/openmeter/collector-rbac.yaml
kubectl apply -f deploy/openmeter/collector-daemonset.yaml
```

3. **Configure billing plans**:

```bash
# Set up free tier, pay-as-you-go, and subscription plans
./deploy/openmeter/setup-billing-plans.sh
```

4. **Deploy quota enforcement** on the KCP server:

```bash
kubectl apply -f deploy/quota/quota-webhook.yaml
kubectl apply -f deploy/quota/quota-controller.yaml
```

### Billing Plan Configuration

The `deploy/openmeter/setup-billing-plans.sh` script configures the initial billing plans in OpenMeter. Plans define:

- **Meters** — Which dimensions to track (CPU, memory, GPU)
- **Entitlements** — What each plan includes (e.g., free tier: 100 CPU-hours, 0 GPU)
- **Pricing** — Per-unit rates for pay-as-you-go and overage
- **Invoicing** — Schedule (monthly) and payment terms

Example plan structure:

```
Plan: free
  Entitlements:
    cpu:    100 CPU-hours/month (metered, hard limit)
    memory: 200 GB-hours/month (metered, hard limit)
    gpu:    0 GPU-hours/month (boolean, denied)

Plan: payg
  Entitlements:
    cpu:    unlimited (metered, usage-billed at $0.05/CPU-hour)
    memory: unlimited (metered, usage-billed at $0.01/GB-hour)
    gpu:    unlimited (metered, usage-billed at $0.50/GPU-hour)

Plan: starter
  Price: $49/month
  Entitlements:
    cpu:    200 CPU-hours/month (included, overage at $0.04/CPU-hour)
    memory: 400 GB-hours/month (included, overage at $0.008/GB-hour)
    gpu:    10 GPU-hours/month (included, overage at $0.45/GPU-hour)
```

---

## 10. Data Sovereignty

All billing data stays on the provider's infrastructure:

- **Usage events** — Stored in ClickHouse on the management cluster
- **Customer records** — Stored in PostgreSQL on the management cluster
- **Plans and subscriptions** — Stored in PostgreSQL on the management cluster
- **Invoices** — Generated and stored locally

The only data that leaves the platform is what is sent to the payment processor:
- Invoice amounts and line items
- Tenant email address
- Payment method tokens (created by the processor's hosted form)

No workload data, usage patterns, or tenant resource details are sent externally.

---

## 11. Component Summary

| Component | Role | License | Deployed On |
|-----------|------|---------|-------------|
| **OpenMeter** | Metering, rating, invoicing | Apache 2.0 | Management cluster |
| **OpenMeter K8s Collector** | Usage metrics collection | Apache 2.0 | Workload cluster (DaemonSet) |
| **Kafka / Redpanda** | Event streaming for OpenMeter | Apache 2.0 | Management cluster |
| **ClickHouse** | Usage data aggregation | Apache 2.0 | Management cluster |
| **PostgreSQL** | Plans, customers, state | PostgreSQL License | Management cluster |
| **Stripe** (or alternative) | Payment processing | SaaS | External |
| **Quota Webhook** | Entitlement enforcement | Custom | KCP server |
| **Quota Controller** | Credit balance monitoring | Custom | Management cluster |
| **DCGM Exporter** | GPU metrics | Apache 2.0 | Workload cluster (DaemonSet) |
| **GPU Bridge** | DCGM to CloudEvents | Custom | Workload cluster |

---

## 12. Decision Log

Decisions specific to billing and metering, extracted from the overall architecture decision log.

| # | Decision | Choice | Alternatives Considered | Rationale |
|---|----------|--------|------------------------|-----------|
| D19 | Billing units | CPU-hours, memory-GB-hours (4x/hr), GPU-hours | Per-instance, flat fee | Multi-dimensional, extensible. Matches industry standard cloud billing. |
| D20 | Billing models | All (pay-as-you-go, credits, subscriptions) | Single model | Flexibility for different tenant needs. OpenMeter supports all natively. |
| D21 | Billing architecture | Self-hosted engine + swappable payment processor | Stripe-native, fully custom | Sovereign billing data. Stripe as default payment processor, swappable. |
| D22 | Billing engine | OpenMeter | Lago, Flexprice, Kill Bill, custom | Apache 2.0, Go, K8s-native collector, entitlements for quotas, built-in billing. |

### Decision Details

**D19 — Billing Units**: Per-instance billing (flat fee per VM or notebook) is simpler but penalizes tenants who run small workloads. Usage-based billing (CPU-hours, GB-hours, GPU-hours) is fair and matches industry expectations. The 4x/hour memory sampling rate is a pragmatic trade-off between accuracy and data volume.

**D20 — Billing Models**: Supporting a single model would force all tenants into the same payment pattern. Research teams prefer prepaid credits. Startups prefer pay-as-you-go. Enterprises prefer subscriptions with predictable costs. OpenMeter supports all models natively, so the implementation cost of supporting all is low.

**D21 — Billing Architecture**: A fully Stripe-native solution would be simpler but creates vendor lock-in and sends all billing data to a US company. A fully custom solution would be expensive to build and maintain. Self-hosted billing engine with swappable payment processor balances sovereignty, simplicity, and cost.

**D22 — Billing Engine**: OpenMeter is the only option that combines Apache 2.0 licensing, Go implementation (consistent with the rest of the stack), Kubernetes-native collection, entitlements API (critical for quota enforcement), and built-in billing/invoicing. Lago comes closest but is Ruby-based and lacks the K8s collector.

---

## Reference Files

All deployment manifests referenced in this paper are in the `deploy/` directory:

```
deploy/
  openmeter/
    namespace.yaml              # OpenMeter namespace
    helm-values.yaml            # Helm chart configuration
    collector-daemonset.yaml    # K8s collector DaemonSet (workload cluster)
    collector-rbac.yaml         # Collector RBAC (workload cluster)
    setup-billing-plans.sh      # Initial plan configuration script
  quota/
    quota-webhook.yaml          # KCP admission webhook for entitlements
    quota-controller.yaml       # Credit balance monitor
  onboarding/
    onboarding-controller.yaml  # Workspace + billing setup (from Paper 1)
```

---

*This is Paper 2 in the Sovereign Small Cloud series. Paper 1 ([01-compute-platform.md](01-compute-platform.md)) covers the compute platform this billing system meters.*
