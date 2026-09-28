#!/usr/bin/env bash
# Renders deploy/kubernetes/base plus chosen components into DEST, for a
# GitOps repository that cannot reference this repository remotely (while
# it is private). DEST receives:
#   grounded.yaml         the rendered manifests (no namespace; the consumer's
#                         overlay sets it, pins the image and patches)
#   grounded-config.env   the grounded-config settings (base and components)
#   kustomization.yaml    a Kustomization listing grounded.yaml and generating
#                         grounded-config from the env file, so the consumer's
#                         build hashes it and a configuration change rolls
#                         the pods (overlays merge keys with behavior: merge
#                         or patch grounded-config)
# All start with a "generated, do not edit" header naming the source commit.
#
# Usage: deploy/kubernetes/scripts/vendor.sh DEST [COMPONENT...]
#   (or: make vendor-k8s DEST=<dir> COMPONENTS="postgres-single valkey-single")
set -euo pipefail

if [ $# -lt 1 ] || [ -z "$1" ]; then
  echo "usage: $0 DEST [COMPONENT...]" >&2
  exit 2
fi
dest="$1"
shift
root="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(cd "${root}/../.." && pwd)"
KUSTOMIZE="${KUSTOMIZE:-kustomize}"
GO="${GO:-go}"

for c in "$@"; do
  if [ ! -f "${root}/components/${c}/kustomization.yaml" ]; then
    echo "unknown component ${c}; available: $(ls "${root}/components" | tr '\n' ' ')" >&2
    exit 2
  fi
done

commit="$(git -C "$root" rev-parse HEAD 2>/dev/null || echo unknown)"
describe="$(git -C "$root" describe --tags --always --dirty 2>/dev/null || echo unknown)"
if [ -n "$(git -C "$root" status --porcelain -- . 2>/dev/null)" ]; then
  commit="${commit} (with uncommitted changes in deploy/kubernetes)"
fi
generated="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

scratch="$(mktemp -d "${root}/.tmp.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT
{
  echo "apiVersion: kustomize.config.k8s.io/v1beta1"
  echo "kind: Kustomization"
  echo "resources:"
  echo "  - ../base"
  if [ $# -gt 0 ]; then
    echo "components:"
    for c in "$@"; do echo "  - ../components/${c}"; done
  fi
} >"${scratch}/kustomization.yaml"
"$KUSTOMIZE" build "$scratch" >"${scratch}/rendered.yaml"
labels="$(cd "$repo" && "$GO" run ./tools/k8svendor -name grounded-config \
  -manifests "${scratch}/grounded.yaml" -env "${scratch}/grounded-config.env" <"${scratch}/rendered.yaml")"

header() {
  cat <<EOF
# GENERATED - DO NOT EDIT. Re-run \`make vendor-k8s\` in github.com/ncecere/grounded:
#   make vendor-k8s DEST=<this directory> COMPONENTS="$*"
# Source:     github.com/ncecere/grounded//deploy/kubernetes
# Commit:     ${commit}
# Version:    ${describe}
# Generated:  ${generated}
# Components: ${*:-none}
# Patch these manifests from your own overlay, never here. Once the
# repository is public, reference the base and components remotely instead
# (docs/deployments/kubernetes.md, "Consuming the base").
EOF
}

mkdir -p "$dest"
{
  header "$@"
  cat "${scratch}/grounded.yaml"
} >"${dest}/grounded.yaml"
{
  header "$@"
  cat "${scratch}/grounded-config.env"
} >"${dest}/grounded-config.env"
{
  header "$@"
  echo "apiVersion: kustomize.config.k8s.io/v1beta1"
  echo "kind: Kustomization"
  echo "resources:"
  echo "  - grounded.yaml"
  echo "configMapGenerator:"
  echo "  - name: grounded-config"
  echo "    envs:"
  echo "      - grounded-config.env"
  echo "    options:"
  echo "      labels:"
  sed 's/^/        /' <<<"$labels"
} >"${dest}/kustomization.yaml"
echo "vendored deploy/kubernetes (${describe}; components: ${*:-none}) into ${dest}"
