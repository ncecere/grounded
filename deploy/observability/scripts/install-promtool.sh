#!/usr/bin/env bash
# Installs promtool from the official Prometheus release, pinned by version
# and SHA-256, to $DEST (used by `make obs-validate` and CI). promtool can't
# be built with `go install pkg@version`: the Prometheus module has replace
# directives.
#
#   DEST=bin/obs-tools/prometheus-3.15.0/promtool deploy/observability/scripts/install-promtool.sh
set -euo pipefail

version="${PROMETHEUS_VERSION:-3.15.0}"
dest="${DEST:?DEST is the path to install promtool to}"

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$arch" in
  x86_64 | amd64) arch=amd64 ;;
  aarch64 | arm64) arch=arm64 ;;
  *) echo "unsupported architecture: $arch" >&2; exit 1 ;;
esac
platform="${os}-${arch}"

# sha256sums.txt of the v3.15.0 release.
case "${version}/${platform}" in
  3.15.0/linux-amd64) sum=2a542df32eac02ee17b9d844fb2aa1de00dafa5476579ba8a3ba862e9d572ea0 ;;
  3.15.0/linux-arm64) sum=f1f90ec08e849d494ca66c611470afc50192f0355f1a61c33f2cbde02d067823 ;;
  3.15.0/darwin-amd64) sum=2d79e744c2d7e505db936fbc898e05abc74fcb6e437c25befd26e9c9f00aa58b ;;
  3.15.0/darwin-arm64) sum=920df4d17e78b3b0175af144eb318b0c74d1cf7b1d1251b326966f0e81977260 ;;
  *) echo "no pinned checksum for Prometheus ${version} on ${platform}: add it to $0" >&2; exit 1 ;;
esac

name="prometheus-${version}.${platform}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
curl -fsSL -o "${tmp}/${name}.tar.gz" \
  "https://github.com/prometheus/prometheus/releases/download/v${version}/${name}.tar.gz"
if command -v sha256sum >/dev/null; then
  got="$(sha256sum "${tmp}/${name}.tar.gz" | cut -d' ' -f1)"
else
  got="$(shasum -a 256 "${tmp}/${name}.tar.gz" | cut -d' ' -f1)"
fi
if [ "$got" != "$sum" ]; then
  echo "checksum mismatch for ${name}.tar.gz: got ${got}, want ${sum}" >&2
  exit 1
fi
tar -xzf "${tmp}/${name}.tar.gz" -C "$tmp" "${name}/promtool"
mkdir -p "$(dirname "$dest")"
mv "${tmp}/${name}/promtool" "$dest"
"$dest" --version | head -n 1
