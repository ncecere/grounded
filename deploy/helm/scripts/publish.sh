#!/usr/bin/env bash
# FUTURE protected tag workflow only. Never invoked by local validation.
set -euo pipefail
: "${TAG:?}" "${DIGEST:?}" "${OCR_DIGEST:?}" "${GITHUB_TOKEN:?}" "${GITHUB_ACTOR:?}"
: "${GITHUB_REPOSITORY:?}" "${GITHUB_SHA:?}" "${GITHUB_REF:?}"
[[ "$GITHUB_REF" == "refs/tags/$TAG" ]] || { echo 'not a tag build' >&2; exit 1; }
[[ "$TAG" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)(-[0-9A-Za-z.-]+)?$ ]] || exit 1
# Do not back-publish charts for released versions. First eligible minor: 0.7.
(( 10#${BASH_REMATCH[1]} > 0 || 10#${BASH_REMATCH[2]} >= 7 )) || exit 1
[[ "$DIGEST" =~ ^sha256:[0-9a-f]{64}$ && "$OCR_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 1
version="${TAG#v}"
owner="${GITHUB_REPOSITORY_OWNER,,}"
repository="$owner/charts/grounded"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
identity="https://github.com/$GITHUB_REPOSITORY/.github/workflows/helm-publish.yml@refs/tags/$TAG"
issuer=https://token.actions.githubusercontent.com
attestation_type=https://grounded.example.org/attestations/generated-chart/v1
# Keyless signing fetches a GitHub Actions OIDC token, and that request can fail transiently (v0.9.0: "fetching ambient
# OIDC credentials: invalid character 'u'", after the chart was pushed). Retry; never skip.
retry() {
  local n
  for n in 1 2 3 4; do
    "$@" && return 0
    (( n < 4 )) && sleep $(( n * 20 ))
  done
  return 1
}
# Only proceed on an authenticated, definitive not-found. Network/auth errors fail.
token=$(curl --fail --silent --show-error --user "$GITHUB_ACTOR:$GITHUB_TOKEN" \
  "https://ghcr.io/token?service=ghcr.io&scope=repository:${repository}:pull" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')
status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --head --dump-header "$work/head.txt" \
  --header "Authorization: Bearer $token" --header 'Accept: application/vnd.oci.image.manifest.v1+json' \
  "https://ghcr.io/v2/$repository/manifests/$version")
unset token
# A version is never replaced. An existing one is only resumed: a rerun of this tag's job after the push succeeded and
# signing failed. It must be byte for byte the chart this tag packages (checked below); it is then signed, not pushed.
case "$status" in
  404) existing="" ;;
  200)
    existing=$(tr -d '\r' < "$work/head.txt" | sed -n 's/^[Dd]ocker-[Cc]ontent-[Dd]igest: \(sha256:[0-9a-f]\{64\}\)$/\1/p')
    [[ "$existing" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo 'refusing publication: existing version without a digest' >&2; exit 1; } ;;
  *) echo "refusing publication: registry returned $status" >&2; exit 1 ;;
esac
# Existing image signing/scanning gates remain mandatory; verify exact tag identity.
for image in "ghcr.io/ncecere/grounded@$DIGEST" "ghcr.io/ncecere/grounded-ocr@$OCR_DIGEST"; do
  cosign verify "$image" \
    --certificate-identity "https://github.com/$GITHUB_REPOSITORY/.github/workflows/image.yml@refs/tags/$TAG" \
    --certificate-oidc-issuer "$issuer" >/dev/null
done
python3 deploy/helm/scripts/generate.py --check
cp -a deploy/helm/grounded "$work/chart"
CHART_DIR="$work/chart" VERSION="$version" python3 - <<'PY'
import os,yaml
from pathlib import Path
p=Path(os.environ['CHART_DIR'])
c=yaml.safe_load((p/'Chart.yaml').read_text()); c.update(version=os.environ['VERSION'], appVersion=os.environ['TAG'])
(p/'Chart.yaml').write_text(yaml.safe_dump(c))
v=yaml.safe_load((p/'values.yaml').read_text())
v.update(appImage='ghcr.io/ncecere/grounded@'+os.environ['DIGEST'],ocrImage='ghcr.io/ncecere/grounded-ocr@'+os.environ['OCR_DIGEST'])
(p/'values.yaml').write_text(yaml.safe_dump(v))
PY
helm package "$work/chart" --destination "$work"
archive="$work/grounded-$version.tgz"
printf '%s' "$GITHUB_TOKEN" | helm registry login ghcr.io --username "$GITHUB_ACTOR" --password-stdin
if [[ -z "$existing" ]]; then
  # Unique-version workflow concurrency serializes this repository's writers.
  helm push "$archive" "oci://ghcr.io/$owner/charts" 2>&1 | tee "$work/push.log"
  chart_digest=$(sed -n 's/^Digest: \(sha256:[0-9a-f]\{64\}\)$/\1/p' "$work/push.log")
  [[ "$chart_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 1
else
  chart_digest="$existing"
  mkdir "$work/existing" "$work/packaged" "$work/pulled"
  helm pull "oci://ghcr.io/$repository@$chart_digest" --destination "$work/pulled"
  pulled=("$work"/pulled/*.tgz)
  [[ ${#pulled[@]} == 1 && -f "${pulled[0]}" ]] || { echo 'refusing publication: could not pull the existing version' >&2; exit 1; }
  tar -xzf "${pulled[0]}" -C "$work/existing"
  tar -xzf "$archive" -C "$work/packaged"
  diff -r "$work/existing" "$work/packaged" >&2 || { echo "refusing publication: $version exists with different content" >&2; exit 1; }
  archive="${pulled[0]}" # the provenance names the published archive
  if cosign verify "ghcr.io/$repository@$chart_digest" --certificate-identity "$identity" --certificate-oidc-issuer "$issuer" >/dev/null 2>&1 &&
     cosign verify-attestation "ghcr.io/$repository@$chart_digest" --type "$attestation_type" \
       --certificate-identity "$identity" --certificate-oidc-issuer "$issuer" >/dev/null 2>&1; then
    echo "$version is already published, signed and attested: ghcr.io/$repository@$chart_digest"
    exit 0
  fi
  echo "resuming $version: signing the existing, identical chart ghcr.io/$repository@$chart_digest"
fi
sha256sum "$archive" > "$work/checksums.txt"
ref="ghcr.io/$repository@$chart_digest"
retry cosign sign --yes "$ref"
ARCHIVE="$archive" CHART_DIR="$work/chart" python3 - <<'PY' > "$work/provenance.json"
import hashlib,json,os
from pathlib import Path
print(json.dumps({'source':os.environ['GITHUB_REPOSITORY'],'commit':os.environ['GITHUB_SHA'],
 'ref':os.environ['GITHUB_REF'],'archiveSha256':hashlib.sha256(Path(os.environ['ARCHIVE']).read_bytes()).hexdigest(),
 'images':{'app':os.environ['DIGEST'],'ocr':os.environ['OCR_DIGEST']},
 'generation':json.loads(Path(os.environ['CHART_DIR'],'provenance.json').read_text())}))
PY
retry cosign attest --yes --type "$attestation_type" --predicate "$work/provenance.json" "$ref"
printf '## Generated Helm chart\n\n`%s`\n\n' "$ref" >> "$GITHUB_STEP_SUMMARY"
cat "$work/checksums.txt" >> "$GITHUB_STEP_SUMMARY"
