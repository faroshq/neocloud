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

# Copy CRDs into the bootstrap embed directory.
echo "Copying CRDs to bootstrap embed..."
rm -rf "${PLATFORM_ROOT}/pkg/bootstrap/crds"
mkdir -p "${PLATFORM_ROOT}/pkg/bootstrap/crds"
cp "${PLATFORM_ROOT}"/config/crds/*.yaml "${PLATFORM_ROOT}/pkg/bootstrap/crds/"

# Step 3: Generate kcp APIResourceSchemas and APIExport from CRDs using apigen.
echo "Generating kcp APIResourceSchemas with apigen..."
(
    cd "${PLATFORM_ROOT}"
    "${KCP_APIGEN_BIN}" \
        --input-dir "${PLATFORM_ROOT}/config/crds" \
        --output-dir "${PLATFORM_ROOT}/config/kcp"
)

# Step 4: Patch virtual storage for cached resources in generated APIExports.
# apigen always outputs "storage: crd: {}" but publicimages and publiccloudinits
# use KCP CachedResource virtual storage. Apply overrides before merging.
echo "Patching virtual storage for cached resources..."
go run "${PLATFORM_ROOT}/hack/patch-virtual-storage" \
    --config-dir "${PLATFORM_ROOT}/config/kcp"

# Step 5: Generate cloud.platform merged APIExport from all individual APIExports.
echo "Generating merged cloud.platform APIExport..."
go run "${PLATFORM_ROOT}/hack/gen-core-apiexport" \
    --config-dir "${PLATFORM_ROOT}/config/kcp" \
    --output "${PLATFORM_ROOT}/config/kcp/apiexport-cloud.platform.yaml"

echo "Codegen complete."
