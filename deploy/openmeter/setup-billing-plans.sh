#!/usr/bin/env bash
# =============================================================================
# setup-billing-plans.sh — Create billing plans in OpenMeter
# =============================================================================
#
# This script provisions the three standard billing plans for the sovereign
# cloud platform via the OpenMeter API:
#
#   1. Free plan       — hard-capped resource limits, no charges.
#   2. Pay-as-you-go   — usage-based pricing with per-unit rates.
#   3. Prepaid plan     — credit-based, customers buy credits upfront.
#
# Prerequisites:
#   - OPENMETER_URL must be set (e.g. http://localhost:8888 or the cluster URL).
#   - OPENMETER_API_KEY must be set (admin API key with plan management perms).
#   - curl and jq must be available.
#
# Usage:
#   export OPENMETER_URL=http://openmeter-api.openmeter.svc:8888
#   export OPENMETER_API_KEY=om_api_xxxx
#   bash setup-billing-plans.sh
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
OPENMETER_URL="${OPENMETER_URL:?OPENMETER_URL environment variable must be set}"
OPENMETER_API_KEY="${OPENMETER_API_KEY:?OPENMETER_API_KEY environment variable must be set}"

API="${OPENMETER_URL}/api/v1"
AUTH_HEADER="Authorization: Bearer ${OPENMETER_API_KEY}"
CONTENT_TYPE="Content-Type: application/json"

# ---------------------------------------------------------------------------
# Helper function to POST to the OpenMeter API
# ---------------------------------------------------------------------------
om_post() {
  local endpoint="$1"
  local payload="$2"
  local description="$3"

  echo ">>> Creating: ${description}..."
  response=$(curl -s -w "\n%{http_code}" -X POST \
    "${API}${endpoint}" \
    -H "${AUTH_HEADER}" \
    -H "${CONTENT_TYPE}" \
    -d "${payload}")

  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$d')

  if [[ "$http_code" -ge 200 && "$http_code" -lt 300 ]]; then
    echo "    OK (HTTP ${http_code})"
    echo "$body" | jq -r '.id // .key // "created"' 2>/dev/null || true
  else
    echo "    FAILED (HTTP ${http_code})"
    echo "$body" | jq . 2>/dev/null || echo "$body"
    return 1
  fi
}

echo "============================================="
echo "Setting up billing plans in OpenMeter"
echo "API: ${API}"
echo "============================================="
echo ""

# =============================================================================
# 1. FREE PLAN
# =============================================================================
# The free plan gives tenants a fixed allocation of resources at no cost.
# It is designed for evaluation and small workloads.
#
# Limits:
#   - CPU:    360,000 core-seconds  = 100 CPU-hours  (e.g. 1 core for ~4 days)
#   - Memory: 720,000 GB-seconds    = 200 GB-hours   (e.g. 2 GB for ~4 days)
#   - GPU:    0 GPU-seconds          (GPUs not available on free plan)
#
# Soft limit is false — usage is hard-capped. Once the limit is reached,
# the tenant must upgrade or wait for the next billing period.
# =============================================================================
om_post "/plans" '{
  "key": "free",
  "name": "Free Plan",
  "description": "Evaluation plan with hard-capped resource limits. No charges.",
  "currency": "USD",
  "phases": [
    {
      "key": "free-phase",
      "name": "Free Tier",
      "description": "Hard-capped resource allocation for evaluation",
      "rateCards": [
        {
          "type": "usage_based",
          "key": "free-cpu",
          "name": "CPU (Free)",
          "meterSlug": "cpu_usage",
          "billingCadence": "P1M",
          "price": null,
          "entitlementTemplate": {
            "type": "metered",
            "usageLimit": 360000,
            "isSoftLimit": false
          }
        },
        {
          "type": "usage_based",
          "key": "free-memory",
          "name": "Memory (Free)",
          "meterSlug": "memory_usage",
          "billingCadence": "P1M",
          "price": null,
          "entitlementTemplate": {
            "type": "metered",
            "usageLimit": 720000,
            "isSoftLimit": false
          }
        },
        {
          "type": "usage_based",
          "key": "free-gpu",
          "name": "GPU (Free — disabled)",
          "meterSlug": "gpu_usage",
          "billingCadence": "P1M",
          "price": null,
          "entitlementTemplate": {
            "type": "metered",
            "usageLimit": 0,
            "isSoftLimit": false
          }
        }
      ]
    }
  ]
}' "Free Plan"

echo ""

# =============================================================================
# 2. PAY-AS-YOU-GO PLAN
# =============================================================================
# Pure usage-based pricing. Tenants pay only for what they consume, with no
# upfront commitment and no hard caps.
#
# Pricing:
#   - CPU:    $0.00001  per core-second  (~$0.036/core-hour, ~$26/core-month)
#   - Memory: $0.000005 per GB-second    (~$0.018/GB-hour,   ~$13/GB-month)
#   - GPU:    $0.001    per GPU-second   (~$3.60/GPU-hour — varies by model)
#
# These rates are competitive with major cloud providers and can be adjusted
# per-tenant or per-GPU-model via overrides.
# =============================================================================
om_post "/plans" '{
  "key": "pay-as-you-go",
  "name": "Pay-as-you-go",
  "description": "Usage-based plan. Pay only for what you consume, no commitments.",
  "currency": "USD",
  "phases": [
    {
      "key": "payg-phase",
      "name": "Usage-Based",
      "description": "Metered billing at per-unit rates",
      "rateCards": [
        {
          "type": "usage_based",
          "key": "payg-cpu",
          "name": "CPU Usage",
          "description": "Billed at $0.00001 per core-second (~$0.036/core-hour, ~$26/core-month)",
          "meterSlug": "cpu_usage",
          "billingCadence": "P1M",
          "price": {
            "type": "unit",
            "amount": "0.00001"
          }
        },
        {
          "type": "usage_based",
          "key": "payg-memory",
          "name": "Memory Usage",
          "description": "Billed at $0.000005 per GB-second (~$0.018/GB-hour, ~$13/GB-month)",
          "meterSlug": "memory_usage",
          "billingCadence": "P1M",
          "price": {
            "type": "unit",
            "amount": "0.000005"
          }
        },
        {
          "type": "usage_based",
          "key": "payg-gpu",
          "name": "GPU Usage",
          "description": "Billed at $0.001 per GPU-second (~$3.60/GPU-hour). Rate may vary by gpu_model.",
          "meterSlug": "gpu_usage",
          "billingCadence": "P1M",
          "price": {
            "type": "unit",
            "amount": "0.001"
          }
        }
      ]
    }
  ]
}' "Pay-as-you-go Plan"

echo ""

# =============================================================================
# 3. PREPAID (CREDIT-BASED) PLAN
# =============================================================================
# Tenants purchase credits upfront (e.g. $1000) and consume them at the same
# per-unit rates as pay-as-you-go. This model suits enterprises that prefer
# predictable spending and want volume discounts.
#
# Credits are deducted based on usage at the same per-unit prices. When credits
# are exhausted, the tenant can either top up or fall back to pay-as-you-go
# (configurable via entitlement soft limit).
# =============================================================================
om_post "/plans" '{
  "key": "prepaid",
  "name": "Prepaid (Credit-Based)",
  "description": "Buy credits upfront and consume at standard per-unit rates. Ideal for predictable budgets.",
  "currency": "USD",
  "phases": [
    {
      "key": "prepaid-phase",
      "name": "Prepaid Credits",
      "description": "Usage deducted from prepaid credit balance",
      "rateCards": [
        {
          "type": "usage_based",
          "key": "prepaid-cpu",
          "name": "CPU Usage (Prepaid)",
          "description": "CPU at $0.00001/core-second, deducted from credit balance",
          "meterSlug": "cpu_usage",
          "billingCadence": "P1M",
          "price": {
            "type": "unit",
            "amount": "0.00001"
          },
          "entitlementTemplate": {
            "type": "metered",
            "isSoftLimit": true
          }
        },
        {
          "type": "usage_based",
          "key": "prepaid-memory",
          "name": "Memory Usage (Prepaid)",
          "description": "Memory at $0.000005/GB-second, deducted from credit balance",
          "meterSlug": "memory_usage",
          "billingCadence": "P1M",
          "price": {
            "type": "unit",
            "amount": "0.000005"
          },
          "entitlementTemplate": {
            "type": "metered",
            "isSoftLimit": true
          }
        },
        {
          "type": "usage_based",
          "key": "prepaid-gpu",
          "name": "GPU Usage (Prepaid)",
          "description": "GPU at $0.001/GPU-second, deducted from credit balance",
          "meterSlug": "gpu_usage",
          "billingCadence": "P1M",
          "price": {
            "type": "unit",
            "amount": "0.001"
          },
          "entitlementTemplate": {
            "type": "metered",
            "isSoftLimit": true
          }
        }
      ]
    }
  ]
}' "Prepaid (Credit-Based) Plan"

echo ""
echo "============================================="
echo "Billing plan setup complete."
echo "============================================="
echo ""
echo "Next steps:"
echo "  1. Verify plans:  curl -H '${AUTH_HEADER}' ${API}/plans | jq ."
echo "  2. Assign a plan to a customer via the OpenMeter API or portal."
echo "  3. Configure Stripe webhooks if using Stripe for payment processing."
