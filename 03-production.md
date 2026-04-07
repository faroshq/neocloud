# Layer 3: Productionization

**Billing, Monitoring, Operations, and Everything Else**

*Part of the Sovereign Small Cloud Reference Architecture series*

---

## Overview

This document answers: **"I have a working multi-tenant platform (Layer 2). How do I make it a production-grade business?"**

Layer 1 ([01-compute-platform.md](01-compute-platform.md)) builds the infrastructure: bare metal, Kubernetes, kcp, identity, storage, and networking. Layer 2 adds multi-tenancy, workload APIs, and basic observability. This layer — Layer 3 — adds everything needed to run the platform as a production service:

- **Billing and metering** — Track usage, generate invoices, collect payment
- **Advanced monitoring and alerting** — Platform-wide and per-tenant observability
- **Tenant self-service** — Tier management, payment methods, usage dashboards
- **Backup and disaster recovery** — Protect platform state and tenant data
- **Day-2 operations** — Node scaling, upgrades, new service types
- **TLS and DNS** — Certificate management and DNS automation
- **SLA/SLO tracking** — Measure and report on service quality

### Prerequisites

- Layer 1 deployed: bare-metal infrastructure, management cluster, workload cluster(s)
- Layer 2 deployed: kcp with workspace-per-tenant, Zitadel OIDC, onboarding controller, basic Prometheus + Grafana
- Helm 3 and kubectl on management workstation
- A Stripe account (or alternative payment processor) for paid tiers

---

## 1. Metering and Billing — OpenMeter

### Why OpenMeter

OpenMeter was selected as the billing engine because it covers the most requirements in a single, self-hostable component:

| Criterion | OpenMeter |
|-----------|-----------|
| License | Apache 2.0 |
| Language | Go (consistent with the rest of the stack) |
| K8s-native collector | Yes (DaemonSet, scrapes kubelet per pod) |
| Entitlements API | Yes (enables quota enforcement at the kcp admission layer) |
| Built-in billing | Yes (plans, subscriptions, invoicing) |
| Self-hostable | Yes (all data stays on provider infrastructure) |
| Payment integration | Stripe native, others via interface |

OpenMeter is the only option that combines Apache 2.0 licensing, a Go implementation, Kubernetes-native collection, an entitlements API for quota enforcement, and built-in billing/invoicing.

### Architecture

OpenMeter requires three backing services, all deployed on the management cluster:

```
┌──────────────────────────────────────────────────────────────────┐
│                WORKLOAD CLUSTER(S)                                  │
│                                                                     │
│  OpenMeter K8s Collector (DaemonSet)                                │
│  ├── Scrapes kubelet metrics per pod                                │
│  ├── Labels usage by tenant namespace                               │
│  └── Emits CloudEvents to OpenMeter server                         │
│                                                                     │
│  DCGM Exporter (DaemonSet, GPU nodes only)                          │
│  └── Feeds Prometheus → custom bridge → CloudEvents                 │
└────────────────────────┬────────────────────────────────────────────┘
                         │ CloudEvents (HTTPS)
┌────────────────────────▼────────────────────────────────────────────┐
│                OPENMETER (Management Cluster)                        │
│                                                                      │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────────────┐      │
│  │ Kafka /       │   │ ClickHouse   │   │ PostgreSQL         │      │
│  │ Redpanda      │   │              │   │                    │      │
│  │ Event ingest  │   │ Aggregation  │   │ Plans, customers,  │      │
│  │ & streaming   │   │ engine       │   │ subscriptions,     │      │
│  │               │   │              │   │ entitlements        │      │
│  └───────┬───────┘   └──────┬───────┘   └──────┬─────────────┘      │
│          └──────────────────┴──────────────────┘                     │
│                         │                                            │
│                  OpenMeter Server                                    │
│                  (API + workers)                                      │
└──────────────────────────────────────────────────────────────────────┘
```

- **Kafka / Redpanda** — Event ingestion and streaming. Redpanda is recommended for smaller deployments (single binary, no JVM). Estimate: 2 CPU, 4 GB RAM.
- **ClickHouse** — Columnar storage for high-speed usage aggregation. Handles queries like "total CPU-seconds for tenant-a in March" efficiently. Estimate: 2 CPU, 8 GB RAM, 100 GB SSD.
- **PostgreSQL** — Stores plans, customers, subscriptions, entitlements, and invoice records. Estimate: 1 CPU, 2 GB RAM, 20 GB SSD.

### Billing Dimensions

The platform meters three dimensions at launch:

| Dimension | Unit | Collection Method | Sampling |
|-----------|------|-------------------|----------|
| **CPU** | CPU-seconds | OpenMeter K8s collector (kubelet) | Continuous |
| **Memory** | GB-seconds | OpenMeter K8s collector (kubelet) | Sampled 4x/hour |
| **GPU** | GPU-seconds | DCGM Exporter via custom bridge | Continuous |

Memory is sampled every 15 minutes and interpolated. This balances accuracy against data volume for a dimension that changes less frequently than CPU.

### Extensible Dimensions

Future dimensions are added by emitting new CloudEvents to OpenMeter — no changes to the core billing pipeline:

| Future Dimension | Unit | Source |
|-----------------|------|--------|
| Storage | GB-months | Rook-Ceph metrics |
| Network egress | GB | Kube-OVN flow logs |
| Public IP | IP-hours | IP allocation controller |
| Object storage | GB-months + requests | MinIO / Ceph RGW metrics |

Each new dimension requires: (1) a metrics source, (2) a CloudEvents emitter, (3) a meter definition in OpenMeter, and (4) pricing configuration in the billing plan.

### Alternatives Considered

| Engine | Why not chosen |
|--------|---------------|
| **Lago** | Ruby, heavier operational footprint, lacks K8s-native collector |
| **Flexprice** | Newer project, smaller community, fewer integrations |
| **Kill Bill** | Java, enterprise-focused, significant operational complexity |
| **Custom** | High development cost, not justified for v1 |

Any of these could replace OpenMeter. The integration points (CloudEvents in, entitlements API out, payment processor interface) are standard enough to swap.

### Reference Files

```
deploy/openmeter/
  namespace.yaml              # OpenMeter namespace
  helm-values.yaml            # Helm chart configuration
  collector-daemonset.yaml    # K8s collector DaemonSet (workload cluster)
  collector-rbac.yaml         # Collector RBAC (workload cluster)
  setup-billing-plans.sh      # Initial plan configuration script
```

---

## 2. Billing Models

All billing models are configured per tenant — different tenants can be on different models simultaneously. OpenMeter supports all of these natively.

### Free Tier

Free-tier tenants have tight resource quotas and no billing relationship:

- **Quotas**: 1 CPU, 2 GB RAM, 0 GPU (enforced via kcp ResourceQuota + OpenMeter entitlements)
- **Billing**: None required — no payment method on file
- **Purpose**: Trial, evaluation, learning
- **Metering**: Usage is still tracked (for provider capacity planning) but not invoiced

### Pay-as-you-go

Usage events are collected, rated at per-unit prices, and invoiced monthly:

```
Usage events  -->  Rated at per-unit price  -->  Monthly invoice  -->  Stripe charge
```

- Tenant adds payment method to upgrade from free tier
- No commitment, no minimum spend
- Clear per-unit prices published in plan configuration

### Prepaid Credits

Tenant purchases credit grants upfront. Usage is deducted from the credit balance:

```
Tenant buys $100 credits  -->  Usage deducted from balance  -->  Alert at $10 remaining
```

- Credits can have expiration dates
- Multiple credit grants can coexist (FIFO deduction)
- Low-balance alerts via webhook or email
- When credits are exhausted: block new workloads or fall back to pay-as-you-go (configurable)

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

Custom rates, custom invoicing schedules, negotiated terms. Configured manually per tenant in OpenMeter:

- Volume discounts
- Quarterly or annual invoicing
- Custom payment terms (net-30, net-60)
- Dedicated support tier

---

## 3. Payment Processing

### Stripe (Default)

OpenMeter integrates natively with Stripe for payment collection. Stripe handles:

- Credit card and bank account storage (PCI compliance)
- Recurring charges and one-time payments
- Invoice delivery (email or hosted page)
- Dispute and refund management
- Tax calculation (via Stripe Tax)

The platform sends only invoice data (amounts, line items, tenant email) to Stripe. No workload data, usage details, or source code leaves the platform.

### European Alternatives

The payment processor is behind a swappable interface. Providers in jurisdictions where Stripe is not preferred can substitute:

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

## 4. Quota Enforcement

### kcp Admission Webhook

A custom admission webhook runs in the kcp server context and intercepts resource creation requests:

```
Tenant creates Notebook  -->  kcp admission webhook
  --> Queries OpenMeter: "Does tenant-{id} have GPU entitlement?"
  --> If yes: allow
  --> If no (free tier, credits exhausted): reject with clear error
```

The webhook checks the OpenMeter entitlements API synchronously during admission. This means quota violations are caught before any workload reaches the backend cluster.

### Error Messages

When quota is exceeded, the webhook rejects with a clear, actionable error:

```
Error from server (Forbidden): notebooks.ai.platform.example.com "my-notebook" is
forbidden: GPU entitlement not available on your current plan (free).
Upgrade to a paid plan: https://console.example.com/billing/upgrade
```

The error includes: what resource was denied, why (which entitlement is missing), and how to fix it (link to upgrade).

### Credit Exhaustion

When a prepaid or pay-as-you-go tenant exhausts their credits or exceeds their spending limit:

1. **Existing workloads continue running** — No sudden termination of running pods or VMs
2. **New workload creation is blocked** — The admission webhook rejects new resource creation
3. **Workspace enters read-only mode** — Indicated by a workspace condition
4. **Tenant is notified** — Via email/webhook with instructions to add credits or payment method
5. **Grace period** — Configurable (default: 72 hours) before existing workloads are scaled down

### Tier Transitions

Tier transitions are self-service and handled by the billing controller:

| Transition | Trigger | Actions |
|-----------|---------|---------|
| Free to Pay-as-you-go | User adds payment method | Update OpenMeter subscription, lift ResourceQuota |
| Free to Prepaid | User purchases credits | Create credit grant, lift ResourceQuota |
| Pay-as-you-go to Subscription | User selects plan | Update subscription, adjust entitlements |
| Any to Enterprise | Admin action | Manual configuration in OpenMeter |

On upgrade, the billing controller: (1) verifies payment method or credit balance via OpenMeter API, (2) updates the OpenMeter subscription, (3) updates kcp ResourceQuota, and (4) updates workspace labels/annotations.

### Reference Files

```
deploy/quota/
  quota-webhook.yaml          # kcp admission webhook for entitlements
  quota-controller.yaml       # Credit balance monitor
```

---

## 5. Tenant Self-Service

### Extended Web Console

Layer 2 provides a basic web console for workspace management. Layer 3 extends it with billing and account management:

- **Billing dashboard** — Current plan, current usage vs. entitlements, projected invoice
- **Usage charts** — CPU, memory, GPU usage over time (data from OpenMeter)
- **Invoice history** — Past invoices with downloadable PDFs
- **Payment methods** — Add/remove credit cards or bank accounts (via Stripe hosted form)
- **Plan management** — View available plans, upgrade/downgrade self-service
- **Credit balance** — Current prepaid credit balance and purchase option

### Onboarding Flow with Billing

The full onboarding flow integrates identity, workspace creation, and billing setup:

```
1. User signs in via OIDC (Google / GitHub / Zitadel)
        |
        v
2. Onboarding controller detects new user
   +-- Creates kcp workspace (tenant-{id})
   +-- Binds RBAC (user = workspace admin)
   +-- Creates APIBindings (compute, storage, network, ai)
   +-- Sets ResourceQuota (free tier defaults)
   +-- Creates OpenMeter customer (subject = tenant-{id})
   +-- Creates OpenMeter subscription (free tier plan)
   +-- Returns workspace kubeconfig
        |
        v
3. User accesses workspace (console / CLI / kubectl)
        |
        v
4. User wants more resources
   +-- Visits billing page in console
   +-- Adds payment method (Stripe hosted form)
   +-- Selects plan (pay-as-you-go or subscription)
   +-- Billing controller lifts ResourceQuota
        |
        v
5. Usage metered --> OpenMeter --> Invoiced --> Stripe charge
```

### API Keys and Programmatic Access

Tenants manage API keys through Zitadel:

- **Service accounts** — Machine-to-machine access via OIDC client credentials
- **Personal access tokens** — For CLI and kubectl access
- **Scoped permissions** — API keys can be scoped to specific workspaces or APIs

All authentication flows go through Zitadel. The platform does not implement its own token management.

---

## 6. Advanced Monitoring and Alerting

### Beyond Layer 2

Layer 2 provides basic Prometheus + Grafana for platform metrics. Layer 3 adds production-grade alerting and per-tenant observability.

### Key Platform Alerts

These alerts should fire on the platform operations channel (PagerDuty, Slack, email):

| Alert | Severity | Condition |
|-------|----------|-----------|
| kcp control plane down | Critical | kcp API server unreachable for > 2 minutes |
| GPU node not ready | Warning | Any GPU node in NotReady state for > 5 minutes |
| Ceph health degraded | Warning | Ceph reports HEALTH_WARN or HEALTH_ERR |
| Tenant quota at 90% | Info | Any tenant within 10% of any entitlement limit |
| Metering lag | Warning | OpenMeter event ingestion lag > 15 minutes |
| etcd disk usage high | Warning | etcd data directory > 80% of allocated space |
| Certificate expiry | Warning | Any managed certificate expiring within 14 days |
| Workload cluster unreachable | Critical | Management cluster cannot reach workload cluster API |

Alert definitions are in `deploy/observability/platform-alerts.yaml`.

### Per-Tenant Usage Dashboards

Grafana dashboards filtered by tenant namespace, showing:

- CPU, memory, GPU usage over time
- Resource requests vs. actual usage (right-sizing guidance)
- Number of running workloads by type
- Storage consumption

These dashboards are available to tenants through the web console (embedded Grafana with tenant-scoped data source).

### SLA/SLO Tracking

Track service-level objectives for the platform:

| SLO | Target | Measurement |
|-----|--------|-------------|
| kcp API availability | 99.9% | Synthetic probes every 30 seconds |
| Workload scheduling latency | < 30 seconds | Time from resource creation to pod running |
| Metering accuracy | < 5% error | Compare OpenMeter totals to kubelet totals |
| Invoice generation | Within 24 hours of period end | OpenMeter invoice timestamps |

SLO dashboards give the operations team visibility into service quality and support SLA commitments to enterprise tenants.

### Future: Logs and Traces

Layer 3 focuses on metrics and alerts. Future iterations add:

- **Loki** for centralized log aggregation (per-tenant log isolation via namespace labels)
- **OpenTelemetry** for distributed tracing across the platform control plane
- **Tempo** as the trace backend

These are not required for production launch but are valuable for debugging complex multi-tenant issues.

---

## 7. Backup and Disaster Recovery

### What to Back Up

| Component | Method | Frequency | Retention |
|-----------|--------|-----------|-----------|
| kcp etcd | etcd snapshot | Hourly | 7 days |
| Zitadel PostgreSQL | pg_dump | Every 6 hours | 30 days |
| OpenMeter PostgreSQL | pg_dump | Every 6 hours | 30 days |
| OpenMeter ClickHouse | ClickHouse backup | Daily | 30 days |
| Rook-Ceph data | Ceph snapshots + Velero | Continuous | Per policy |
| Workload cluster etcd | etcd snapshot | Hourly | 7 days |
| Grafana dashboards | GitOps (provisioning) | On change | Git history |

### Velero for Workload Backup

Velero provides Kubernetes-native backup and restore. It uses Ceph RGW as the S3-compatible backend, keeping all backup data on the provider's infrastructure:

```bash
helm install velero vmware-tanzu/velero \
  --namespace velero \
  --create-namespace \
  --set configuration.backupStorageLocation[0].provider=aws \
  --set configuration.backupStorageLocation[0].bucket=backups \
  --set configuration.backupStorageLocation[0].config.s3Url=http://rook-ceph-rgw.rook-ceph:80
```

Velero backs up Kubernetes resources and persistent volumes. It supports scheduled backups, on-demand snapshots, and cross-cluster restore.

### etcd Snapshot CronJob

A CronJob on each cluster takes hourly etcd snapshots and uploads them to Ceph object storage (S3-compatible via RGW). The CronJob uses the standard `etcdctl snapshot save` command and uploads via the AWS CLI pointed at the Ceph RGW endpoint. See `deploy/backup/etcd-snapshot-cronjob.yaml` for the full manifest.

### Backup Schedule Summary

| Priority | Components | Frequency |
|----------|-----------|-----------|
| Critical | kcp etcd, workload cluster etcd | Hourly |
| Platform | Zitadel PostgreSQL, OpenMeter PostgreSQL | Every 6 hours |
| Data | ClickHouse, Ceph snapshots | Daily |
| Tenant workloads | Velero scheduled backups | Weekly (configurable per tenant) |

### Reference Files

```
deploy/backup/
  velero-values.yaml          # Velero Helm configuration
  etcd-snapshot-cronjob.yaml  # etcd snapshot CronJob
  pg-backup-cronjob.yaml     # PostgreSQL backup CronJob
```

---

## 8. Day-2 Operations

### Adding New Nodes

Scale node pools by patching the CAPI MachineDeployment:

```bash
# Scale GPU pool from 3 to 4 nodes
kubectl --kubeconfig=management.kubeconfig \
  -n metal3 patch machinedeployment workload-1-gpu \
  --type=merge -p '{"spec":{"replicas":4}}'
```

CAPI handles the full lifecycle: PXE boot the new bare-metal machine, install the OS (Flatcar), join it to the workload cluster, and apply GPU operator configuration.

### Kubernetes Upgrades

Rolling upgrades via CAPI — control plane first, then workers:

```bash
# Upgrade control plane
kubectl --kubeconfig=management.kubeconfig \
  -n metal3 patch kubeadmcontrolplane workload-1-cp \
  --type=merge -p '{"spec":{"version":"v1.32.0"}}'

# After control plane is ready, upgrade workers
kubectl --kubeconfig=management.kubeconfig \
  -n metal3 patch machinedeployment workload-1-workers \
  --type=merge -p '{"spec":{"template":{"spec":{"version":"v1.32.0"}}}}'
```

CAPI performs a rolling update: cordon, drain, replace one node at a time. Workloads are rescheduled automatically.

### Adding a New Service Type

To add a new API to the platform (e.g., a managed database service):

1. **Define the API** — Create a new APIResourceSchema and APIExport in the kcp platform workspace
2. **Deploy the operator** — Deploy the reconciler on the management cluster (the "cloud operator" pattern from Layer 2)
3. **Update onboarding** — Modify the onboarding controller to auto-bind the new API for new tenants
4. **Add metering** — Emit CloudEvents for the new service to OpenMeter
5. **Update billing plans** — Add the new dimension to billing plan configuration

### Certificate Rotation

cert-manager handles certificate rotation automatically for all Let's Encrypt certificates. Internal certificates (Kubernetes CAs, etcd) are managed by kubeadm and CAPI during upgrades.

No manual certificate rotation is required under normal operations. Monitor the "Certificate expiry" alert (Section 6) for any failures.

---

## 9. TLS and DNS

### cert-manager + Let's Encrypt

All public-facing endpoints use TLS certificates from Let's Encrypt, managed by cert-manager. A `ClusterIssuer` resource configures ACME with HTTP-01 challenges via the platform ingress controller. cert-manager automatically provisions, renews, and rotates certificates for all platform endpoints. See `deploy/tls/cluster-issuer.yaml` for the full manifest.

### Required DNS Records

| Record | Type | Target | Purpose |
|--------|------|--------|---------|
| `kcp.example.com` | A | Management cluster LB | kcp API endpoint |
| `auth.example.com` | A / CNAME | Management cluster LB | Zitadel OIDC |
| `console.example.com` | A / CNAME | Management cluster LB | Web console |
| `grafana.example.com` | A / CNAME | Management cluster LB | Grafana dashboards |
| `*.tenant.example.com` | A / CNAME | Workload cluster LB | Tenant workload ingress |
| `tunnel.example.com` | A | Management cluster LB | CLI SSH tunnels |

### External-DNS for Automation

For providers managing many DNS records, External-DNS automates DNS record creation from Kubernetes Ingress and Gateway resources. It supports multiple DNS providers (Cloudflare, AWS Route 53, etc.) and eliminates manual record management. This is optional — small deployments can manage DNS manually or via Terraform.

### Reference Files

```
deploy/tls/
  cluster-issuer.yaml         # Let's Encrypt ClusterIssuer
  certificates.yaml           # Certificate resources for platform endpoints
  external-dns-values.yaml    # External-DNS Helm values (optional)
```

---

## 10. Data Sovereignty

All billing and operational data stays on the provider's infrastructure:

- **Usage events** — Stored in ClickHouse on the management cluster
- **Customer records** — Stored in PostgreSQL on the management cluster
- **Plans and subscriptions** — Stored in PostgreSQL on the management cluster
- **Invoices** — Generated and stored locally
- **Backups** — Stored in Ceph object storage on the provider's hardware
- **Monitoring data** — Prometheus/VictoriaMetrics on the management cluster

The only data that leaves the platform is what is sent to the payment processor:
- Invoice amounts and line items
- Tenant email address
- Payment method tokens (created by the processor's hosted form)

No workload data, usage patterns, or tenant resource details are sent externally. Providers who require fully offline billing can use direct bank transfer instead of Stripe.

---

## 11. Component Summary

| Component | Role | License | Deployed On |
|-----------|------|---------|-------------|
| **OpenMeter** | Metering, rating, invoicing | Apache 2.0 | Management cluster |
| **OpenMeter K8s Collector** | Usage metrics collection | Apache 2.0 | Workload cluster (DaemonSet) |
| **Kafka / Redpanda** | Event streaming for OpenMeter | Apache 2.0 | Management cluster |
| **ClickHouse** | Usage data aggregation | Apache 2.0 | Management cluster |
| **Stripe** (or alternative) | Payment processing | SaaS | External |
| **Quota Webhook** | Entitlement enforcement at kcp API | Custom | kcp server |
| **Quota Controller** | Credit balance monitoring | Custom | Management cluster |
| **Velero** | Workload backup and restore | Apache 2.0 | Management + workload clusters |
| **cert-manager** | TLS certificate lifecycle | Apache 2.0 | Management cluster |
| **External-DNS** (optional) | DNS record automation | Apache 2.0 | Management cluster |

---

## 12. Decision Log

Decisions specific to Layer 3, extending the architecture decision log from earlier layers.

| # | Decision | Choice | Alternatives Considered | Rationale |
|---|----------|--------|------------------------|-----------|
| D19 | Billing units | CPU-hours, memory-GB-hours (4x/hr), GPU-hours | Per-instance, flat fee | Multi-dimensional, extensible. Matches industry standard cloud billing. Memory sampled 4x/hour balances accuracy vs. data volume. |
| D20 | Billing models | All (free, pay-as-you-go, credits, subscriptions, enterprise) | Single model | Flexibility for different tenant needs. Research teams prefer credits, startups prefer PAYG, enterprises prefer subscriptions. OpenMeter supports all natively. |
| D21 | Billing architecture | Self-hosted engine + swappable payment processor | Stripe-native only, fully custom | Sovereign billing data stays on-premises. Stripe as default processor is swappable for EU alternatives (Mollie, Adyen). |
| D22 | Billing engine | OpenMeter | Lago, Flexprice, Kill Bill, custom | Apache 2.0, Go, K8s-native collector, entitlements API for quotas, built-in billing. Only option covering all requirements in one component. |
| D23 | Backup strategy | Velero + etcd snapshots + pg_dump | Kasten K10, custom scripts | Velero is open source, K8s-native, supports Ceph RGW as S3 backend. etcd snapshots and pg_dump are standard, reliable tools for their respective databases. |
| D24 | Certificate management | cert-manager + Let's Encrypt | Manual certs, Vault PKI | cert-manager is the de facto standard for K8s certificate management. Let's Encrypt provides free, automated certificates. No manual rotation needed. |
| D25 | DNS automation | External-DNS (optional) | Manual DNS, Terraform | External-DNS reduces operational burden for providers with many records. Optional because small deployments can manage DNS manually. |

---

## What This Layer Does Not Cover

Layer 3 focuses on making the platform production-ready. The following are explicitly out of scope and may be addressed in future layers:

- **Multi-region deployment** — This architecture assumes a single site
- **Federation** — Cross-platform tenant mobility
- **Marketplace** — Third-party service catalog
- **Compliance certification** — SOC 2, ISO 27001 processes (though the architecture supports them)
- **Custom SLA contracts** — Legal/commercial concerns, not technical

---

*This is Layer 3 in the Sovereign Small Cloud series. Layer 1 ([01-compute-platform.md](01-compute-platform.md)) covers the compute platform. Layer 2 covers multi-tenancy and workload APIs. This layer adds everything needed to run it as a production business.*
