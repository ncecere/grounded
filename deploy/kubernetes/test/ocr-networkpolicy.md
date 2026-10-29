# OCR NetworkPolicy acceptance

Issue #77 needs a real enforcing CNI, not a static YAML check or an OCR pod that
happens not to make outbound requests. The homelab development area's additive
allow policies cannot prove denial. This test runs on **local Docker kind**, in a
new `dev-grounded` namespace, with no homelab access or default kubeconfig.

## Run it

Requires Docker, Go, Python 3 (standard library only), kubectl and kind v0.33.0
(the Makefile installs kind on first use). Use a verified release/candidate image
by its immutable digest, or a local image built from the source under test:

```sh
make k8s-ocr-network-test OCR_IMAGE=ghcr.io/ncecere/grounded-ocr@sha256:YOUR_VERIFIED_DIGEST
# A durable JSON result, using a kind already installed on PATH:
python3 deploy/kubernetes/scripts/ocr_networkpolicy.py \
  --ocr-image ghcr.io/ncecere/grounded-ocr@sha256:YOUR_VERIFIED_DIGEST \
  --report /tmp/ocr-networkpolicy-result.json
```

`make k8s-smoke` and its existing required CI job also run the test, using the
OCR image they just built and their existing throwaway kind cluster. The helper
accepts an existing cluster only with an explicit dedicated kubeconfig; it checks
the exact `kind-<name>` context, Docker node label, loopback API address and the
node's published API port before any Kubernetes write. An existing `dev-grounded`
namespace is refused. It never falls back to `~/.kube/config`.

A standalone run uses the pinned kind v0.33 node image (Kubernetes 1.37.0), whose
kindnetd contains the Kubernetes NetworkPolicy engine. The engine can fail open
if it cannot start: **the connectivity tests must pass**, not merely the cluster
creation. No extra CNI is installed and no host firewall is changed.

## What it proves

The production OCR component is rendered with only the image/pull policy,
small health-test resource requests, and more frequent readiness probes changed.
A static, test-only `tools/netprobe` binary is copied into writable `/tmp`; the
shipped image and its read-only root filesystem are not changed. API and worker
client pods have the production policy labels. A third client is a positive
control and is not selected by OCR's policies. A controlled Docker OCR server on
the node's bridge, **outside the cluster**, supplies an address that is known to
be reachable; no public website is loaded.

1. **Ingress-only counterfactual:** OCR can resolve the Kubernetes service name
   and connect to the outside-cluster peer. API and worker can reach `/healthz`
   through both pod and Service IPs; the unrelated client cannot. Fresh kubelet
   readiness probes pass.
2. **Standalone shipped component:** OCR DNS and external TCP connections fail,
   while the positive control still reaches each target; API/worker access and
   readiness continue to pass. This namespace has no development-area allow policy.
3. **Composed shipped base:** apply the real base NetworkPolicies too. OCR still
   cannot make those outbound connections, while API/worker and the control keep
   DNS. The control gets a test-only peer grant selecting only its own label;
   that grant cannot allow OCR egress.
4. **Live DNS mutation:** temporarily restore the old namespace-wide base DNS
   selector. OCR can resolve DNS again, demonstrating the additive-policy trap.
   Restore the shipped selector and require denial again, with ingress and fresh
   readiness still working.

A failed `kubectl exec`, missing probe, malformed output, dead target or CNI that
ignores policy is not counted as successful denial. Probe JSON, exit status and
positive controls are checked; retries are bounded. The report identifies the
source/dirty state, exact local image ID and completed phases. It measures
network isolation, not OCR quality or application authorization.

## Cleanup and operator limits

The helper removes only its owned peer/tag and its new namespace or standalone
cluster, plus a Docker bridge only if the standalone run created it. Cleanup
failures make the result fail. The outer smoke test retains ownership of its own
cluster. Always verify cleanup after an externally killed run.

NetworkPolicies combine by **union**. The shipped base DNS policy deliberately
excludes `app.kubernetes.io/component=ocr`; simply adding `Egress` to OCR's own
policy would not override the old namespace-wide DNS grant. Operators adding
namespace-wide egress allows must exclude OCR too if they want the same isolation.
The policy keeps its existing resource name, so an upgrade updates it in place.
