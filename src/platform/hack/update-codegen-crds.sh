#!/usr/bin/env bash

set -o errexit
set -o nounset
set -o pipefail
set -o xtrace

if [[ -z "${CONTROLLER_GEN:-}" ]]; then
    echo "You must either set CONTROLLER_GEN to the path to controller-gen or invoke via make"
    exit 1
fi

if [[ -z "${KCP_APIGEN_GEN:-}" ]]; then
    echo "You must either set KCP_APIGEN_GEN to the path to apigen or invoke via make"
    exit 1
fi

PLATFORM_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)

# CONTROLLER_GEN and KCP_APIGEN_GEN are relative to the top-level repo root.
TOPLEVEL_ROOT=$(cd "${PLATFORM_ROOT}/../.." && pwd)
CONTROLLER_GEN_BIN="${TOPLEVEL_ROOT}/${CONTROLLER_GEN}"
KCP_APIGEN_BIN="${TOPLEVEL_ROOT}/${KCP_APIGEN_GEN}"

# Provider group prefixes mapped to their bootstrap subdirectory names.
declare -A PROVIDER_GROUPS=(
    ["compute.cloud.platform"]="compute"
    ["network.cloud.platform"]="network"
    ["storage.cloud.platform"]="storage"
    ["ai.cloud.platform"]="ai"
)

# Step 1: Generate deepcopy methods from Go types using controller-gen.
echo "Generating deepcopy with controller-gen..."
(
    cd "${PLATFORM_ROOT}/apis"
    "${CONTROLLER_GEN_BIN}" \
        object \
        paths="./..."
)

# Step 2: Generate CRDs from Go types using controller-gen.
echo "Generating CRDs with controller-gen..."
mkdir -p "${PLATFORM_ROOT}/config/crds"
(
    cd "${PLATFORM_ROOT}/apis"
    "${CONTROLLER_GEN_BIN}" \
        crd \
        paths="./..." \
        output:crd:artifacts:config="${PLATFORM_ROOT}"/config/crds
)

# Step 3: Copy CRDs into per-provider bootstrap embed directories.
echo "Copying CRDs to per-provider bootstrap embed directories..."
for group in "${!PROVIDER_GROUPS[@]}"; do
    provider="${PROVIDER_GROUPS[$group]}"
    target_dir="${PLATFORM_ROOT}/pkg/bootstrap/crds/${provider}"
    rm -rf "${target_dir}"
    mkdir -p "${target_dir}"

    # Copy CRDs whose filename starts with the group prefix.
    for crd in "${PLATFORM_ROOT}"/config/crds/${group}_*.yaml; do
        if [[ -f "$crd" ]]; then
            cp "$crd" "${target_dir}/"
        fi
    done

    # Verify at least one CRD was copied.
    count=$(find "${target_dir}" -name '*.yaml' | wc -l | tr -d ' ')
    if [[ "$count" -eq 0 ]]; then
        echo "WARNING: No CRDs found for group ${group}"
    else
        echo "  ${provider}: ${count} CRD(s)"
    fi
done

# Step 4: Generate kcp APIResourceSchemas per provider using apigen.
echo "Generating kcp APIResourceSchemas with apigen..."
for group in "${!PROVIDER_GROUPS[@]}"; do
    provider="${PROVIDER_GROUPS[$group]}"
    input_dir="${PLATFORM_ROOT}/pkg/bootstrap/crds/${provider}"
    output_dir="${PLATFORM_ROOT}/config/kcp/${provider}"

    # Only run apigen if there are real CRDs (skip placeholder-only dirs).
    real_crds=$(grep -l '^  name:' "${input_dir}"/*.yaml 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$real_crds" -eq 0 ]]; then
        echo "  Skipping apigen for ${provider} (no real CRDs yet)"
        continue
    fi

    echo "  Running apigen for ${provider}..."
    (
        cd "${PLATFORM_ROOT}"
        "${KCP_APIGEN_BIN}" \
            --input-dir "${input_dir}" \
            --output-dir "${output_dir}"
    )
done

# Step 5: Patch virtual storage for cached resources (compute only).
# apigen always outputs "storage: crd: {}" but publicimages and publiccloudinits
# use KCP CachedResource virtual storage. Apply overrides.
echo "Patching virtual storage for cached resources..."
go run "${PLATFORM_ROOT}/hack/patch-virtual-storage" \
    --config-dir "${PLATFORM_ROOT}/config/kcp/compute"

echo "Codegen complete."
