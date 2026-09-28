#!/usr/bin/env bash
# Renders the base, the base with each component, combinations of
# components, and every overlay with kustomize, and validates the output
# with kubeconform -strict (CRDs from the pinned datreeio/CRDs-catalog).
#
# Used by `make k8s-validate` and CI. Tools are overridable:
#   KUSTOMIZE="kustomize" KUBECONFORM="kubeconform" deploy/kubernetes/scripts/validate.sh
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
KUSTOMIZE="${KUSTOMIZE:-kustomize}"
KUBECONFORM="${KUBECONFORM:-kubeconform}"
K8S_SCHEMA_VERSION="${K8S_SCHEMA_VERSION:-1.34.0}"
CRDS_CATALOG_REF="${CRDS_CATALOG_REF:-ad3b08c5045129d7bb1eeffd8e61719b2c8dd1e2}"
crd_schemas="https://raw.githubusercontent.com/datreeio/CRDs-catalog/${CRDS_CATALOG_REF}/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json"

# Component sets rendered on top of the base. Each line is one build.
# monitoring and monitoring-annotations are alternatives, as are the two
# Postgres components; every other component appears with each.
combinations=(
  ""
  "postgres-single"
  "postgres-cnpg"
  "valkey-single"
  "backup-pgdump"
  "backup-objects"
  "ingress"
  "tika"
  "ocr-tesseract"
  "monitoring"
  "monitoring-annotations"
  "alerts"
  "dashboards"
  "private-registry"
  "postgres-single valkey-single backup-pgdump backup-objects ingress tika ocr-tesseract monitoring alerts dashboards private-registry"
  "postgres-cnpg valkey-single ingress tika monitoring-annotations private-registry"
)

# kustomize refuses absolute paths, so builds happen in a scratch directory
# next to base/ and components/.
scratch="$(mktemp -d "${root}/.tmp.XXXXXX")"
trap 'rm -rf "$scratch"' EXIT

validate() { # name, rendered file
  echo "== $1"
  "$KUBECONFORM" -strict -summary -kubernetes-version "$K8S_SCHEMA_VERSION" \
    -schema-location default -schema-location "$crd_schemas" "$2"
}

i=0
for combo in "${combinations[@]}"; do
  i=$((i + 1))
  dir="${scratch}/c${i}"
  mkdir -p "$dir"
  {
    echo "apiVersion: kustomize.config.k8s.io/v1beta1"
    echo "kind: Kustomization"
    echo "namespace: grounded-validate"
    echo "resources:"
    echo "  - ../../base"
    if [ -n "$combo" ]; then
      echo "components:"
      for c in $combo; do echo "  - ../../components/${c}"; done
    fi
  } >"${dir}/kustomization.yaml"
  "$KUSTOMIZE" build "$dir" >"${dir}/out.yaml"
  validate "base${combo:+ + ${combo// /, }}" "${dir}/out.yaml"
done

for overlay in "${root}"/overlays/*/ "${root}"/test/*/; do
  name="$(basename "$(dirname "$overlay")")/$(basename "$overlay")"
  out="${scratch}/${name//\//-}.yaml"
  "$KUSTOMIZE" build "$overlay" >"$out"
  validate "$name" "$out"
done

# The restore Jobs (docs/operations/restore.md) are applied by hand.
for f in "${root}"/restore/*.yaml; do printf -- '---\n'; cat "$f"; done >"${scratch}/restore.yaml"
validate "restore Jobs" "${scratch}/restore.yaml"

# grounded-config is generated with a content hash, so a configuration
# change rolls the pods: every Deployment must reference the hashed name,
# and an overlay's change must change the hash.
configmap_name() { # rendered file -> the grounded-config-<hash> name
  sed -n 's/^  name: \(grounded-config-[a-z0-9]\{10\}\)$/\1/p' "$1" | head -n 1
}
check_config_refs() { # name, rendered file
  local cm refs
  cm="$(configmap_name "$2")"
  [ -n "$cm" ] || { echo "$1: grounded-config has no content hash" >&2; exit 1; }
  refs="$(grep -c "name: ${cm}\$" "$2" || true)"
  # the ConfigMap itself, plus envFrom in two containers of each Deployment
  if [ "$refs" -lt 5 ] || grep -q "name: grounded-config\$" "$2"; then
    echo "$1: Deployments do not all reference ${cm}" >&2
    exit 1
  fi
  echo "== $1: grounded-config is ${cm}"
}
check_config_refs "base" "${scratch}/c1/out.yaml"

# Vendoring (make vendor-k8s) keeps that: the vendored kustomization
# generates grounded-config, and a consumer overlay merges keys into it.
vendored="${scratch}/vendored"
GO="${GO:-go}" KUSTOMIZE="$KUSTOMIZE" "${root}/scripts/vendor.sh" "$vendored" tika >/dev/null
consumer() { # dir, APP_URL
  mkdir -p "$1"
  {
    echo "apiVersion: kustomize.config.k8s.io/v1beta1"
    echo "kind: Kustomization"
    echo "namespace: grounded-validate"
    echo "resources:"
    echo "  - ../vendored"
    echo "configMapGenerator:"
    echo "  - name: grounded-config"
    echo "    behavior: merge"
    echo "    literals:"
    echo "      - APP_URL=$2"
  } >"$1/kustomization.yaml"
  "$KUSTOMIZE" build "$1" >"$1/out.yaml"
}
consumer "${scratch}/consumer-a" https://a.example.org
consumer "${scratch}/consumer-b" https://b.example.org
validate "vendored + consumer overlay" "${scratch}/consumer-a/out.yaml"
check_config_refs "vendored + consumer overlay" "${scratch}/consumer-a/out.yaml"
for want in "APP_URL: https://a.example.org" "TIKA_URL: http://grounded-tika:9998" "LOG_FORMAT: json"; do
  grep -q "^  ${want}\$" "${scratch}/consumer-a/out.yaml" || { echo "vendored config lacks ${want}" >&2; exit 1; }
done
if [ "$(configmap_name "${scratch}/consumer-a/out.yaml")" = "$(configmap_name "${scratch}/consumer-b/out.yaml")" ]; then
  echo "a configuration change in the consumer overlay does not change the ConfigMap hash" >&2
  exit 1
fi

# Every component directory must be exercised above.
for c in "${root}"/components/*/; do
  c="$(basename "$c")"
  if ! printf '%s\n' "${combinations[@]}" | tr ' ' '\n' | grep -qx "$c"; then
    echo "components/${c} is not validated: add it to combinations in $0" >&2
    exit 1
  fi
done
echo "all manifests valid"
