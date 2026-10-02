# Kubernetes manifests

A generic Kustomize base (`base/`), optional components (`components/`) and two example overlays (`overlays/`). Each install keeps its own overlay in its own repository.

The guide is [`docs/deployments/kubernetes.md`](../../docs/deployments/kubernetes.md): prerequisites, the secrets contract, settings, components, consuming the base (`make vendor-k8s` while the repository is private, a remote base afterwards), upgrades and troubleshooting.

```sh
make k8s-validate   # kustomize build + kubeconform -strict for every overlay and component set
make k8s-smoke      # deploy on a throwaway kind cluster, check readiness and OCR
make k8s-load       # load tests (k6, fake models) on a throwaway kind cluster (deploy/loadtest)
make k8s-restore-rehearsal   # back up, destroy, restore and verify on a throwaway kind cluster
make vendor-k8s DEST=<dir> COMPONENTS="postgres-single valkey-single"
```
