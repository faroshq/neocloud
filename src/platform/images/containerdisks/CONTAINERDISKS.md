# KubeVirt containerDisk UEFI/fstab Boot Problem

## Problem

Ubuntu cloud images (and potentially other distros) ship with an `/etc/fstab` entry:

```
LABEL=UEFI /boot/efi vfat defaults 0 2
```

KubeVirt boots VMs in **BIOS mode** by default. In BIOS mode there is no EFI
System Partition, so the `LABEL=UEFI` mount fails. systemd's `fstab-generator`
creates a `boot-efi.mount` unit from this entry, and when it fails, systemd
drops the VM into **emergency mode** — the VM is unreachable via SSH or
networking.

## Why cloud-init cannot fix this

systemd boot order:

1. **systemd generators** (including `fstab-generator`) — parse `/etc/fstab`, create mount units
2. `local-fs-pre.target`
3. `local-fs.target` — all fstab mounts must succeed (unless `nofail`)
4. `cloud-init-local.service` — earliest cloud-init stage
5. `cloud-init.service`, `cloud-config.service`, `cloud-final.service`

The generator phase (step 1) runs **before any service**, including cloud-init.
No cloud-init mechanism — `bootcmd`, `cloud-boothook`, `write_files`, MIME
multipart, `mounts` — can modify `/etc/fstab` in time. By the time cloud-init
starts, systemd has already failed the mount and entered emergency mode.

Tested and confirmed non-working approaches:
- `bootcmd` with `sed` to fix fstab
- `write_files` to overwrite fstab
- `#!` shell script user-data
- MIME multipart with `cloud-boothook`
- `mounts` module (only adds entries, doesn't modify existing ones)

## Why UEFI boot mode doesn't help

We tried `spec.domain.firmware.bootloader.efi` with `secureBoot: false`:
- Requires `smm.enabled: true` or SecureBoot must be explicitly disabled
- Even with UEFI firmware, the containerdisk images don't have a proper EFI
  partition with `LABEL=UEFI` — the label comes from the base cloud image but
  the partition isn't present in the containerDisk qcow2
- Result: same emergency mode

## Solution: Custom containerDisk images

Modify `/etc/fstab` at **image build time** using `virt-customize` (libguestfs).
Adding `nofail,x-systemd.device-timeout=10s` to the UEFI fstab entry makes the
mount optional — systemd skips it if the partition is missing, and boot continues
normally.

### How it works

```
LABEL=UEFI  /boot/efi  vfat  umask=0077               0 1
→
LABEL=UEFI  /boot/efi  vfat  umask=0077,nofail,x-systemd.device-timeout=10s  0 1
```

With `nofail`:
- `fstab-generator` still creates `boot-efi.mount`
- But the unit is **wanted** (not required) by `local-fs.target`
- Mount failure is logged but does not block boot
- `x-systemd.device-timeout=10s` prevents a 90s hang waiting for the device

### Build process

The Dockerfile:
1. Takes an upstream containerDisk as `BASE_IMAGE`
2. Uses Alpine + libguestfs to modify the qcow2 in-place
3. Outputs a clean `FROM scratch` containerDisk image

```bash
# Build one image
docker build --build-arg BASE_IMAGE=quay.io/containerdisks/ubuntu:22.04 \
  -t ghcr.io/mjudeikis/containerdisks/ubuntu:22.04 .

# Build all images
./build.sh

# Build and push
PUSH=1 ./build.sh
```

## Affected images

| Image | Has UEFI fstab entry | Needs fix |
|-------|---------------------|-----------|
| `quay.io/containerdisks/ubuntu:22.04` | Yes | Yes |
| `quay.io/containerdisks/ubuntu:24.04` | Yes | Yes |
| `quay.io/containerdisks/debian:12` | No | No (works as-is) |
| `quay.io/containerdisks/flatcar` | Unknown | TBD |

## Upstream status

- **No GitHub issue exists** in `kubevirt/kubevirt` or `kubevirt/containerdisks`
  for this specific problem (as of 2026-04-06)
- The [containerdisks project](https://github.com/kubevirt/containerdisks) packages
  upstream cloud images **without modification** via their `medius` tool
- The correct upstream fix would be for containerdisks to add `nofail` to UEFI
  fstab entries, per [systemd#795](https://github.com/systemd/systemd/issues/795)
- Ubuntu Launchpad has a related bug: [#1463120](https://bugs.launchpad.net/bugs/1463120)

## Alternative approaches considered

| Approach | Result |
|----------|--------|
| cloud-init bootcmd | Too late — generators run first |
| cloud-init boothook (MIME multipart) | Too late — same reason |
| cloud-init write_files | Too late — same reason |
| UEFI firmware boot | UEFI partition still not found |
| `onDefineDomain` sidecar hook + kernel args | `qemu -append` only works with direct kernel boot |
| `disk-mutation` sidecar | Only renames disk files, doesn't modify contents |
| Direct kernel boot + `systemd.mask=boot-efi.mount` | Requires extracting kernel/initrd from every image |
| Default to Debian | Works but doesn't solve it for Ubuntu users |
| **Custom containerDisk (this solution)** | **Works — fixes fstab at build time** |

## References

- [KubeVirt: Customizing images for containerized VMs](https://kubevirt.io/2020/Customizing-images-for-containerized-vms.html)
- [KubeVirt Hook Sidecar docs](https://kubevirt.io/user-guide/user_workloads/hook-sidecar/)
- [cloud-init boot stages](https://docs.cloud-init.io/en/latest/explanation/boot.html)
- [systemd-fstab-generator(8)](https://manpages.ubuntu.com/manpages/focal/en/man8/systemd-fstab-generator.8.html)
- [systemd#795 — nofail behavior](https://github.com/systemd/systemd/issues/795)
- [kubevirt/containerdisks](https://github.com/kubevirt/containerdisks)
