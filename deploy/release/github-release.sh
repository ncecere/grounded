#!/usr/bin/env bash
# Creates (or updates) the GitHub Release for $TAG with notes from
# docs/releases/<base version>.md, the image digest and verification steps,
# and attaches the release assets:
#   grounded-<tag>-<os>-<arch>.sbom.spdx.json  the image's SPDX SBOM, per platform
#                                              (from its BuildKit attestations)
#   grounded-<tag>.digest.txt                  the image reference by digest
#   grounded-ocr-<tag>.digest.txt              the OCR sidecar's reference (OCR_DIGEST)
#   checksums.txt                              SHA-256 of the files above
# Run by the `release` job in .github/workflows/ci.yml (needs GH_TOKEN, TAG,
# DIGEST, and read access to the image; OCR_DIGEST is the grounded-ocr
# image's digest, optional). Tags with a hyphen (v0.1.0-rc.1)
# become pre-releases. Any failure (no SBOM, a malformed digest, a failed
# upload) stops the script with a message saying what went wrong.
set -euo pipefail

fail() {
  echo "::error::github-release: $*" >&2
  exit 1
}

: "${TAG:?TAG is not set}" "${DIGEST:?DIGEST is not set}"
[[ "$DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "DIGEST is not a sha256 digest: '${DIGEST}'"
for cmd in gh docker jq sha256sum; do
  command -v "$cmd" >/dev/null || fail "${cmd} is not installed"
done

image=ghcr.io/ncecere/grounded
ref="${image}@${DIGEST}"
base="${TAG%%-*}"                        # v0.1.0-rc.1 -> v0.1.0
notes_src="docs/releases/${base}.md"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
assets="${work}/assets"
mkdir "$assets"

# ---- assets ------------------------------------------------------------------

# The SBOM. For a multi-platform index, .SBOM maps each platform
# ("linux/amd64") to its attestations; a single-platform image has .SPDX at
# the top. Each platform's SPDX document becomes one file.
sboms="${work}/sboms.json"
docker buildx imagetools inspect "$ref" --format '{{ json .SBOM }}' >"$sboms" ||
  fail "could not read the SBOM attestations of ${ref}"
if jq -e 'type == "object" and has("SPDX")' "$sboms" >/dev/null; then
  jq '{"image": .}' "$sboms" >"${sboms}.tmp" && mv "${sboms}.tmp" "$sboms"
fi
platforms="$(jq -r 'if type == "object" then keys[] else empty end' "$sboms")"
[ -n "$platforms" ] || fail "${ref} has no SBOM attestation (was it built with sbom: true?)"
sbom_files=()
while IFS= read -r platform; do
  name="grounded-${TAG}-${platform//\//-}.sbom.spdx.json"   # linux/amd64 -> linux-amd64
  [ "$platform" = image ] && name="grounded-${TAG}.sbom.spdx.json"
  jq --arg p "$platform" '.[$p].SPDX' "$sboms" >"${assets}/${name}"
  jq -e '.spdxVersion | type == "string" and startswith("SPDX-")' "${assets}/${name}" >/dev/null ||
    fail "the SBOM for ${platform} is not an SPDX document"
  sbom_files+=("$name")
done <<<"$platforms"

echo "$ref" >"${assets}/grounded-${TAG}.digest.txt"

# The OCR sidecar (docs/ocr.md §3), released with the same tag.
ocr_files=()
ocr_ref=""
if [ -n "${OCR_DIGEST:-}" ]; then
  [[ "$OCR_DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || fail "OCR_DIGEST is not a sha256 digest: '${OCR_DIGEST}'"
  ocr_ref="ghcr.io/ncecere/grounded-ocr@${OCR_DIGEST}"
  echo "$ocr_ref" >"${assets}/grounded-ocr-${TAG}.digest.txt"
  ocr_files+=("grounded-ocr-${TAG}.digest.txt")
fi

(cd "$assets" && sha256sum -- "${sbom_files[@]}" "grounded-${TAG}.digest.txt" "${ocr_files[@]}" >checksums.txt)

# ---- notes -------------------------------------------------------------------

notes="${work}/notes.md"
{
  if [ "$TAG" != "$base" ]; then
    echo "> **Release candidate** for ${base}. Test it before relying on it; the final release follows."
    echo
  fi
  echo "## Image"
  echo
  echo '```'
  echo "${image}:${TAG}"
  echo "$ref"
  echo '```'
  echo
  echo "Deploy by digest. Verify the signature (keyless, GitHub Actions OIDC):"
  echo
  echo '```sh'
  echo "cosign verify ${ref} \\"
  echo "  --certificate-identity-regexp '^https://github.com/ncecere/grounded/\\.github/workflows/.+@refs/tags/${TAG}\$' \\"
  echo "  --certificate-oidc-issuer https://token.actions.githubusercontent.com"
  echo '```'
  echo
  if [ -n "$ocr_ref" ]; then
    echo "The OCR sidecar (optional, \`components/ocr-tesseract\`), signed the same way:"
    echo
    echo '```'
    echo "ghcr.io/ncecere/grounded-ocr:${TAG}"
    echo "$ocr_ref"
    echo '```'
    echo
  fi
  echo "## Release assets"
  echo
  echo "- \`grounded-${TAG}-<os>-<arch>.sbom.spdx.json\`: the image's SBOM (SPDX JSON) for each platform, as attached to the image."
  echo "- \`grounded-${TAG}.digest.txt\`: the image reference by digest."
  echo "- \`checksums.txt\`: SHA-256 of the files above (\`sha256sum -c checksums.txt\`)."
  echo
  echo "The SBOM and build provenance are also attached to the image as attestations, which the signature covers:"
  echo "\`docker buildx imagetools inspect ${ref} --format '{{ json .SBOM }}'\`."
  echo
  if [ -f "$notes_src" ]; then
    cat "$notes_src"
  else
    echo "_No release notes file (${notes_src})._"
  fi
} >"$notes"

# ---- release -----------------------------------------------------------------

# Name the repository: the asset upload runs from the assets directory,
# where gh can't infer it from a git checkout (v0.2.0-rc.1's first run failed).
repo="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner -q .nameWithOwner)}" || fail "could not tell the repository (set GITHUB_REPOSITORY)"
flags=(--repo "$repo" --title "Grounded ${TAG}" --notes-file "$notes" --verify-tag)
[ "$TAG" != "$base" ] && flags+=(--prerelease)
if gh release view "$TAG" --repo "$repo" >/dev/null 2>&1; then
  gh release edit "$TAG" --repo "$repo" --title "Grounded ${TAG}" --notes-file "$notes" || fail "could not update the release ${TAG}"
else
  gh release create "$TAG" "${flags[@]}" || fail "could not create the release ${TAG}"
fi
(cd "$assets" && gh release upload "$TAG" --repo "$repo" --clobber "${sbom_files[@]}" "grounded-${TAG}.digest.txt" "${ocr_files[@]}" checksums.txt) || fail "could not upload the release assets"
echo "release ${TAG}: ${ref}"
ls -l "$assets"
