#!/usr/bin/env bash
# Pinned Go module installs use the Go checksum database, not curl-pipe-shell.
set -euo pipefail
export GOBIN="${GOBIN:-$(pwd)/bin/helm-tools}"
mkdir -p "$GOBIN"
go install sigs.k8s.io/kustomize/kustomize/v5@v5.8.1
go install helm.sh/helm/v3/cmd/helm@v3.17.3
go install github.com/yannh/kubeconform/cmd/kubeconform@v0.8.0
