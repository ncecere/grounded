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
# Only proceed on an authenticated, definitive not-found. Network/auth errors fail.
token=$(curl --fail --silent --show-error --user "$GITHUB_ACTOR:$GITHUB_TOKEN" \
  "https://ghcr.io/token?service=ghcr.io&scope=repository:${repository}:pull" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')
status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --head \
  --header "Authorization: Bearer $token" --header 'Accept: application/vnd.oci.image.manifest.v1+json' \
  "https://ghcr.io/v2/$repository/manifests/$version")
unset token
[[ "$status" == 404 ]] || { echo "refusing publication: registry returned $status (existing version or error)" >&2; exit 1; }
# Existing image signing/scanning gates remain mandatory; verify exact tag identity.
for image in "ghcr.io/ncecere/grounded@$DIGEST" "ghcr.io/ncecere/grounded-ocr@$OCR_DIGEST"; do
  cosign verify "$image" \
    --certificate-identity "https://github.com/$GITHUB_REPOSITORY/.github/workflows/image.yml@refs/tags/$TAG" \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com >/dev/null
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
sha256sum "$archive" > "$work/checksums.txt"
printf '%s' "$GITHUB_TOKEN" | helm registry login ghcr.io --username "$GITHUB_ACTOR" --password-stdin
# Unique-version workflow concurrency serializes this repository's writers.
helm push "$archive" "oci://ghcr.io/$owner/charts" 2>&1 | tee "$work/push.log"
chart_digest=$(sed -n 's/^Digest: \(sha256:[0-9a-f]\{64\}\)$/\1/p' "$work/push.log")
[[ "$chart_digest" =~ ^sha256:[0-9a-f]{64}$ ]] || exit 1
ref="ghcr.io/$repository@$chart_digest"
cosign sign --yes "$ref"
ARCHIVE="$archive" CHART_DIR="$work/chart" python3 - <<'PY' > "$work/provenance.json"
import hashlib,json,os
from pathlib import Path
print(json.dumps({'source':os.environ['GITHUB_REPOSITORY'],'commit':os.environ['GITHUB_SHA'],
 'ref':os.environ['GITHUB_REF'],'archiveSha256':hashlib.sha256(Path(os.environ['ARCHIVE']).read_bytes()).hexdigest(),
 'images':{'app':os.environ['DIGEST'],'ocr':os.environ['OCR_DIGEST']},
 'generation':json.loads(Path(os.environ['CHART_DIR'],'provenance.json').read_text())}))
PY
cosign attest --yes --type https://grounded.example.org/attestations/generated-chart/v1 \
  --predicate "$work/provenance.json" "$ref"
printf '## Generated Helm chart\n\n`%s`\n\n' "$ref" >> "$GITHUB_STEP_SUMMARY"
cat "$work/checksums.txt" >> "$GITHUB_STEP_SUMMARY"
