#!/usr/bin/env bash
# Build and push custom containerDisk images with fixed fstab to ghcr.io/mjudeikis.
#
# Usage:
#   ./build.sh                  # build all images
#   ./build.sh ubuntu-22.04     # build one image
#   PUSH=1 ./build.sh           # build and push all images

set -euo pipefail

REGISTRY="${REGISTRY:-ghcr.io/mjudeikis/containerdisks}"
PUSH="${PUSH:-0}"

declare -A IMAGES=(
    ["ubuntu-22.04"]="quay.io/containerdisks/ubuntu:22.04"
    ["ubuntu-24.04"]="quay.io/containerdisks/ubuntu:24.04"
    ["debian-12"]="quay.io/containerdisks/debian:12"
    ["flatcar"]="quay.io/containerdisks/flatcar"
)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

build_image() {
    local name="$1"
    local base_image="${IMAGES[$name]}"
    # Convert ubuntu-22.04 -> ubuntu:22.04 for the tag
    local tag="${name/-/:}"
    local full_tag="${REGISTRY}/${tag%%:*}:${tag#*:}"

    echo "==> Building ${full_tag} from ${base_image}"
    docker build \
        --build-arg "BASE_IMAGE=${base_image}" \
        --platform linux/amd64 \
        -t "${full_tag}" \
        "${SCRIPT_DIR}"

    if [[ "${PUSH}" == "1" ]]; then
        echo "==> Pushing ${full_tag}"
        docker push "${full_tag}"
    fi

    echo "==> Done: ${full_tag}"
}

if [[ $# -gt 0 ]]; then
    for name in "$@"; do
        if [[ -z "${IMAGES[$name]+x}" ]]; then
            echo "Unknown image: ${name}. Available: ${!IMAGES[*]}"
            exit 1
        fi
        build_image "$name"
    done
else
    for name in "${!IMAGES[@]}"; do
        build_image "$name"
    done
fi
