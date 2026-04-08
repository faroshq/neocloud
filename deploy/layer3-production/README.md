# Layer 3: Production Operations

Billing, metering, monitoring, backup, and quota enforcement.

## Dev Mode

Layer 3 is mostly skipped in dev. The platform runs without billing or external monitoring.

```bash
make layer3-dev-up          # Stub (no-op for now)
make layer3-dev-down        # Stub
```

## Prod Mode

| Component | Directory | Purpose |
|-----------|-----------|---------|
| Observability | [prod/observability/](prod/observability/) | Prometheus + VictoriaMetrics + Grafana + alerts |
| Backup | [prod/backup/](prod/backup/) | Velero + etcd snapshots + backup schedules |
| OpenMeter | [prod/openmeter/](prod/openmeter/) | Usage metering (CPU/memory/GPU) + billing |
| Quota | [prod/quota/](prod/quota/) | Admission webhook for entitlement enforcement |

## Dev vs Prod Parity

| Concern | Dev | Prod |
|---------|-----|------|
| Monitoring | None | Prometheus federation → VictoriaMetrics |
| Billing | Disabled | OpenMeter (Kafka + ClickHouse) |
| Backup | None | Velero + etcd CronJob |
| Quota | No enforcement | Admission webhook + OpenMeter entitlements |
