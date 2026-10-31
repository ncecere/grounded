#!/usr/bin/env bash
# Match repo kind pin and its node Kubernetes minor. Go downloads use sumdb;
# kubectl is the official release binary, with an independently recorded hash.
set -euo pipefail
export GOBIN="${GOBIN:-$(pwd)/bin/helm-tools}"
mkdir -p "$GOBIN"
go install sigs.k8s.io/kind@v0.33.0
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
curl --fail --location --silent --show-error \
  https://dl.k8s.io/release/v1.37.0/bin/linux/amd64/kubectl -o "$work/kubectl"
echo "6129359f4e1f3848a5572ccb0b26cf28b8ca08cef38c95a765b2f64a2c961a2f  $work/kubectl" | sha256sum -c -
install -m 0755 "$work/kubectl" "$GOBIN/kubectl"
