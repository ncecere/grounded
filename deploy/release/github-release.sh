#!/usr/bin/env bash
# Creates (or updates) the GitHub Release for $TAG with notes from
# docs/releases/<base version>.md, the image digest and verification steps.
# Run by the `release` job in .github/workflows/ci.yml (needs GH_TOKEN, TAG,
# DIGEST). Tags with a hyphen (v0.1.0-rc.1) become pre-releases.
set -euo pipefail
: "${TAG:?}" "${DIGEST:?}"
image=ghcr.io/ncecere/grounded
base="${TAG%%-*}"                        # v0.1.0-rc.1 -> v0.1.0
notes_src="docs/releases/${base}.md"
notes="$(mktemp)"
{
  if [ "$TAG" != "$base" ]; then
    echo "> **Release candidate** for ${base}. Test it before relying on it; the final release follows."
    echo
  fi
  echo "## Image"
  echo
  echo '```'
  echo "${image}:${TAG}"
  echo "${image}@${DIGEST}"
  echo '```'
  echo
  echo "Deploy by digest. Verify the signature (keyless, GitHub Actions OIDC):"
  echo
  echo '```sh'
  echo "cosign verify ${image}@${DIGEST} \\"
  echo "  --certificate-identity-regexp '^https://github.com/ncecere/grounded/\\.github/workflows/.+@refs/tags/${TAG}\$' \\"
  echo "  --certificate-oidc-issuer https://token.actions.githubusercontent.com"
  echo '```'
  echo
  echo "The SBOM and build provenance are attached to the image as attestations:"
  echo "\`docker buildx imagetools inspect ${image}@${DIGEST} --format '{{ json .SBOM }}'\`."
  echo
  if [ -f "$notes_src" ]; then
    cat "$notes_src"
  else
    echo "_No release notes file (${notes_src})._"
  fi
} >"$notes"
flags=(--title "Grounded ${TAG}" --notes-file "$notes" --verify-tag)
[ "$TAG" != "$base" ] && flags+=(--prerelease)
if gh release view "$TAG" >/dev/null 2>&1; then
  gh release edit "$TAG" --title "Grounded ${TAG}" --notes-file "$notes"
else
  gh release create "$TAG" "${flags[@]}"
fi
echo "release ${TAG}: ${image}@${DIGEST}"
