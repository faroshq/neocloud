# Build custom containerDisk images with fixed /etc/fstab.
#
# Problem: Upstream Ubuntu cloud images have a hard LABEL=UEFI /boot/efi fstab
# entry that causes systemd to drop into emergency mode when booted with BIOS
# (KubeVirt default). Adding nofail makes the mount optional so boot continues.
#
# Usage:
#   docker build --build-arg BASE_IMAGE=quay.io/containerdisks/ubuntu:22.04 \
#     -t ghcr.io/mjudeikis/containerdisks/ubuntu:22.04 .
#
# The image is a standard KubeVirt containerDisk — use it in place of the
# upstream image in spec.volumes[].containerDisk.image.

ARG BASE_IMAGE

FROM ${BASE_IMAGE} AS base

FROM fedora:41 AS builder

RUN dnf install -y libguestfs-tools-c qemu-img && dnf clean all

COPY --from=base /disk/ /disk/

# Fix fstab: add nofail,x-systemd.device-timeout=10s to any UEFI/EFI mount
# entries so missing partitions don't block boot. Also print the result for
# build log verification.
# Find the disk image (could be disk.img, *.qcow2, etc.) and fix fstab.
RUN DISK=$(find /disk -type f | head -1) && \
    echo "==> Patching ${DISK}" && \
    LIBGUESTFS_BACKEND=direct virt-customize \
    --no-network \
    -a "${DISK}" \
    --run-command 'if [ -f /etc/fstab ] && grep -q "LABEL=UEFI" /etc/fstab; then sed -i "/LABEL=UEFI/ s|\(vfat[[:space:]]*\)\([^[:space:]]*\)|\1\2,nofail,x-systemd.device-timeout=10s|" /etc/fstab; fi' \
    --run-command 'echo "==> /etc/fstab after patch:" && cat /etc/fstab'

FROM scratch
COPY --from=builder /disk/ /disk/
