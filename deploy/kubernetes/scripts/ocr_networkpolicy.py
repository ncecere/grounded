#!/usr/bin/env python3
"""Real OCR ingress/egress acceptance on an isolated local kind namespace.

Never reads the default kubeconfig. Standalone runs own a throwaway cluster;
kind-smoke may supply its already-owned cluster and dedicated kubeconfig.
"""
import argparse
import ipaddress
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
from urllib.parse import urlparse
import uuid

K8S = Path(__file__).resolve().parents[1]
ROOT = K8S.parents[1]
NODE_IMAGE = "kindest/node:v1.37.0@sha256:a1ed56cfb0e7b93589bdf97c8cd566405a265939e3620fc4f5de89adff580ae5"
NS = "dev-grounded"
DNS = "kubernetes.default.svc.cluster.local."


def run(args, *, data=None, check=True, timeout=180, env=None):
    p = subprocess.run([str(a) for a in args], input=data, capture_output=True, timeout=timeout, env=env)
    if check and p.returncode:
        raise RuntimeError(f"{args[0]} {args[1]} failed ({p.returncode}): {p.stderr.decode(errors='replace')[-2000:]}")
    return p


def verify_local_kind(config, node, cluster):
    """Refuse aliases/remote endpoints: the API must be this Docker kind node."""
    if config.get("current-context") != f"kind-{cluster}" or len(config.get("clusters", [])) != 1:
        raise ValueError("refusing kubeconfig: not the requested kind context")
    if node.get("Config", {}).get("Labels", {}).get("io.x-k8s.kind.cluster") != cluster:
        raise ValueError("refusing target: not a local Docker kind node")
    server = urlparse(config["clusters"][0]["cluster"]["server"])
    if server.scheme != "https" or server.hostname not in {"127.0.0.1", "::1", "localhost"}:
        raise ValueError("refusing target: API must be on loopback")
    bindings = node.get("NetworkSettings", {}).get("Ports", {}).get("6443/tcp") or []
    if not any(b["HostIp"] in {"127.0.0.1", "::1"} and int(b["HostPort"]) == server.port for b in bindings):
        raise ValueError("refusing target: API port is not the local kind node's published port")


def tcp_target(ip):
    host = f"[{ip}]" if ipaddress.ip_address(ip).version == 6 else ip
    return f"{host}:8080"


def http_target(ip):
    return f"http://{tcp_target(ip)}/healthz"


class Acceptance:
    def __init__(self, args, work):
        self.args, self.work = args, Path(work)
        self.kind = os.environ.get("KIND", "kind")
        self.cluster = args.cluster or f"grounded-ocr-netpol-{uuid.uuid4().hex[:8]}"
        self.kubeconfig = Path(args.kubeconfig).resolve() if args.kubeconfig else self.work / "kubeconfig"
        self.owned_cluster = self.owned_namespace = self.owned_tag = False
        self.peer = self.owned_network = None
        self.tag = f"grounded-ocr-policy:{self.cluster}"
        self.pods, self.results = {}, []

    def k(self, *args, **kw):
        return run(["kubectl", "--kubeconfig", self.kubeconfig, "--context", f"kind-{self.cluster}",
                    "--namespace", NS, "--request-timeout=60s", *args], **kw)

    def obj(self, *args):
        return json.loads(self.k(*args, "-o", "json").stdout)

    def apply(self, obj):
        self.k("apply", "-f", "-", data=json.dumps(obj).encode())

    def setup(self):
        before = set(run(["docker", "network", "ls", "-q", "--no-trunc"]).stdout.decode().split())
        if not self.args.kubeconfig:
            existing = run([self.kind, "get", "clusters"]).stdout.decode().split()
            if self.cluster in existing:
                raise ValueError("refusing to replace an existing cluster")
            self.owned_cluster = True
            run([self.kind, "create", "cluster", "--name", self.cluster, "--kubeconfig", self.kubeconfig,
                 "--image", NODE_IMAGE, "--wait", "180s"], timeout=360)
        config = json.loads(run(["kubectl", "--kubeconfig", self.kubeconfig, "config", "view", "--minify", "-o", "json"]).stdout)
        node = json.loads(run(["docker", "inspect", f"{self.cluster}-control-plane"]).stdout)[0]
        verify_local_kind(config, node, self.cluster)
        networks = node["NetworkSettings"]["Networks"]
        if len(networks) != 1:
            raise ValueError("kind node must have one identifiable Docker bridge")
        self.network, info = next(iter(networks.items()))
        if self.owned_cluster and info["NetworkID"] not in before:
            self.owned_network = info["NetworkID"]
        if self.k("get", "namespace", NS, check=False).returncode == 0:
            raise ValueError(f"refusing to change an existing {NS} namespace")
        self.apply({"apiVersion": "v1", "kind": "Namespace", "metadata": {"name": NS, "labels": {
            "pod-security.kubernetes.io/enforce": "restricted"}}})
        self.owned_namespace = True
        self.prepare_image()
        self.deploy()

    def prepare_image(self):
        if run(["docker", "image", "inspect", self.args.ocr_image], check=False).returncode:
            run(["docker", "pull", self.args.ocr_image], timeout=360)
        image = json.loads(run(["docker", "image", "inspect", self.args.ocr_image]).stdout)[0]
        self.image_id, self.arch = image["Id"], image["Architecture"]
        if run(["docker", "image", "inspect", self.tag], check=False).returncode == 0:
            raise ValueError("refusing to replace an existing test image tag")
        run(["docker", "tag", self.image_id, self.tag])
        self.owned_tag = True
        run([self.kind, "load", "docker-image", self.tag, "--name", self.cluster], timeout=300)
        self.peer = run(["docker", "run", "--rm", "-d", "--network", self.network,
                         "--cap-drop=ALL", "--security-opt=no-new-privileges", "--read-only",
                         "--tmpfs", "/tmp:rw,mode=1777", self.tag]).stdout.decode().strip()
        peer = json.loads(run(["docker", "inspect", self.peer]).stdout)[0]
        net = peer["NetworkSettings"]["Networks"][self.network]
        self.peer_ip = net.get("IPAddress") or net["GlobalIPv6Address"]

    def deploy(self):
        overlay = self.work / "overlay"
        overlay.mkdir()
        (overlay / "kustomization.yaml").write_text(
            "apiVersion: kustomize.config.k8s.io/v1beta1\nkind: Kustomization\n"
            f"namespace: {NS}\ncomponents:\n  - {K8S / 'components/ocr-tesseract'}\n"
            "images:\n  - name: ghcr.io/ncecere/grounded-ocr\n"
            f"    newName: docker.io/library/grounded-ocr-policy\n    newTag: {self.cluster}\n"
            "patches:\n  - target:\n      kind: Deployment\n      name: grounded-ocr\n"
            "    patch: |-\n      apiVersion: apps/v1\n      kind: Deployment\n"
            "      metadata:\n        name: grounded-ocr\n      spec:\n        template:\n          spec:\n"
            "            containers:\n              - name: ocr\n                imagePullPolicy: Never\n"
            "                resources:\n                  requests: {cpu: 10m, memory: 32Mi}\n"
            "                  limits: {cpu: 200m, memory: 256Mi}\n"
            "                readinessProbe:\n                  periodSeconds: 2\n                  failureThreshold: 1\n")
        rendered = run(["kubectl", "kustomize", overlay]).stdout
        self.k("apply", "-f", "-", data=rendered)
        # Establish the counterfactual first: ingress-only means OCR can reach
        # DNS and the controlled outside-cluster peer. No other policy selects it.
        self.k("patch", "networkpolicy", "grounded-ocr-ingress", "--type=merge", "-p",
               json.dumps({"spec": {"policyTypes": ["Ingress"], "egress": None}}))
        for role in ["api", "worker", "netpol-control"]:
            self.apply(self.client(role))
            self.k("wait", "--for=condition=Ready", f"pod/netpol-{role}", "--timeout=120s")
            self.pods[role] = f"netpol-{role}"
        self.k("rollout", "status", "deployment/grounded-ocr", "--timeout=120s")
        ocr = self.obj("get", "pods", "-l", "app.kubernetes.io/component=ocr")["items"]
        if len(ocr) != 1:
            raise ValueError("expected one test OCR pod")
        self.pods["ocr"] = ocr[0]["metadata"]["name"]
        self.targets = [http_target(ocr[0]["status"]["podIP"]),
                        http_target(self.obj("get", "service", "grounded-ocr")["spec"]["clusterIP"])]
        env = dict(os.environ, CGO_ENABLED="0", GOOS="linux", GOARCH=self.arch)
        run([os.environ.get("GO", "go"), "build", "-o", self.work / "netprobe", "./tools/netprobe"], timeout=180, env=env)
        # The script is run from the repository root; copy into writable /tmp,
        # leaving the shipped image and its read-only root filesystem intact.
        for pod in self.pods.values():
            self.k("exec", "-i", pod, "--", "sh", "-c", "cat > /tmp/netprobe && chmod 700 /tmp/netprobe",
                   data=(self.work / "netprobe").read_bytes())

    def client(self, role):
        return {"apiVersion": "v1", "kind": "Pod", "metadata": {"name": f"netpol-{role}", "labels": {
            "app.kubernetes.io/name": "grounded", "app.kubernetes.io/component": role}}, "spec": {
            "automountServiceAccountToken": False, "terminationGracePeriodSeconds": 1,
            "securityContext": {"runAsNonRoot": True, "runAsUser": 65532, "runAsGroup": 65532,
                                "fsGroup": 65532, "seccompProfile": {"type": "RuntimeDefault"}},
            "containers": [{"name": "probe", "image": self.tag, "imagePullPolicy": "Never",
                            "command": ["sleep", "900"], "securityContext": {"allowPrivilegeEscalation": False,
                            "readOnlyRootFilesystem": True, "capabilities": {"drop": ["ALL"]}},
                            "volumeMounts": [{"name": "tmp", "mountPath": "/tmp"}]}],
            "volumes": [{"name": "tmp", "emptyDir": {"sizeLimit": "16Mi"}}]}}

    def probe(self, role, action, target):
        p = self.k("exec", self.pods[role], "--", "/tmp/netprobe", action, target, check=False, timeout=15)
        try:
            result = json.loads(p.stdout)
        except (ValueError, TypeError) as err:
            raise RuntimeError(f"probe did not run, not evidence of denial: {p.stderr.decode()[-500:]}") from err
        if (result.get("action") != action or result.get("target") != target or type(result.get("ok")) is not bool
                or p.returncode != (0 if result["ok"] else 1)
                or (not result["ok"] and not isinstance(result.get("error"), str))):
            raise RuntimeError("invalid probe result, not evidence of denial")
        return result["ok"] is True

    def expect(self, role, action, target, ok, guard=None):
        until = time.monotonic() + 40
        while time.monotonic() < until:
            if guard is None or self.probe(guard, action, target):
                if self.probe(role, action, target) == ok:
                    return
            time.sleep(0.3)
        raise AssertionError(f"{role} {action} {target}: expected {'reachable' if ok else 'denied'} with a healthy positive control")

    def readiness_and_ingress(self):
        for target in self.targets:
            for role in ["api", "worker"]:
                self.expect(role, "http", target, True)
            self.expect("netpol-control", "http", target, False, guard="api")
        # Test probes run every 2s with failureThreshold 1. Observe fresh kubelet
        # probes rather than accepting a Ready bit left over before the policy.
        time.sleep(6)
        self.k("wait", "--for=condition=Ready", f"pod/{self.pods['ocr']}", "--timeout=30s")

    def egress(self, ok):
        for action, target in [("dns", DNS), ("tcp", tcp_target(self.peer_ip))]:
            self.expect("netpol-control", action, target, True)
            self.expect("ocr", action, target, ok, guard="netpol-control")

    def check(self):
        self.egress(True)
        self.readiness_and_ingress()
        self.results.append("ingress-only baseline: DNS/external egress reachable; API/worker allowed; unrelated ingress denied; readiness fresh")
        self.k("apply", "-f", K8S / "components/ocr-tesseract/networkpolicy.yaml")
        self.egress(False)
        self.readiness_and_ingress()
        self.results.append("standalone shipped component: DNS/external egress denied; API/worker and readiness preserved")
        self.k("apply", "-f", K8S / "base/networkpolicies.yaml")
        # Only the positive-control pod receives this test-only grant. It never
        # selects OCR and cannot hide the base's additive DNS-policy regression.
        cidr = f"{self.peer_ip}/{ipaddress.ip_address(self.peer_ip).max_prefixlen}"
        self.apply({"apiVersion": "networking.k8s.io/v1", "kind": "NetworkPolicy", "metadata": {"name": "test-control-peer"},
                    "spec": {"podSelector": {"matchLabels": {"app.kubernetes.io/component": "netpol-control"}},
                             "policyTypes": ["Egress"], "egress": [{"to": [{"ipBlock": {"cidr": cidr}}],
                             "ports": [{"protocol": "TCP", "port": 8080}]}]}})
        self.egress(False)
        for role in ["api", "worker"]:
            self.expect(role, "dns", DNS, True)
        self.readiness_and_ingress()
        self.results.append("composed shipped base: OCR still has no DNS/external egress; other workloads retain DNS; API/worker and readiness preserved")
        # A live mutation proves the additive base-DNS grant could defeat OCR's
        # own policy. Restore the shipped selector and prove denial again.
        self.k("patch", "networkpolicy", "grounded-allow-dns", "--type=json", "-p",
               json.dumps([{"op": "replace", "path": "/spec/podSelector", "value": {}}]))
        self.expect("ocr", "dns", DNS, True, guard="netpol-control")
        self.k("apply", "-f", K8S / "base/networkpolicies.yaml")
        self.expect("ocr", "dns", DNS, False, guard="netpol-control")
        self.readiness_and_ingress()
        self.results.append("live additive-DNS mutation permits OCR DNS; restoring the shipped selector blocks it again")

    def cleanup(self):
        errors = []
        def remove(args):
            try:
                p = run(args, check=False)
                detail = p.stderr.decode(errors="replace")[-500:]
                if p.returncode and "no such" not in detail.lower():
                    errors.append(f"cleanup {args[0]} {args[1]}: {detail}")
            except Exception as err:
                errors.append(f"cleanup: {err}")
        if self.peer:
            remove(["docker", "rm", "-f", self.peer])
        if self.owned_cluster:
            remove([self.kind, "delete", "cluster", "--name", self.cluster, "--kubeconfig", self.kubeconfig])
            p = run(["docker", "inspect", f"{self.cluster}-control-plane"], check=False)
            if p.returncode == 0:
                errors.append("owned kind node still exists after cleanup")
        elif self.owned_namespace:
            try:
                self.k("delete", "namespace", NS, "--wait=true", "--timeout=60s")
            except Exception as err:
                errors.append(f"namespace cleanup: {err}")
        if self.owned_tag:
            remove(["docker", "image", "rm", self.tag])
        if self.owned_network:
            remove(["docker", "network", "rm", self.owned_network])
        return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ocr-image", required=True, help="exact image digest, or the local image built by kind-smoke")
    parser.add_argument("--cluster", help="existing kind-smoke cluster (requires --kubeconfig)")
    parser.add_argument("--kubeconfig", help="dedicated kubeconfig for an existing LOCAL Docker kind cluster")
    parser.add_argument("--report", type=Path, help="write a durable JSON result")
    args = parser.parse_args()
    if bool(args.cluster) != bool(args.kubeconfig):
        parser.error("--cluster and --kubeconfig must be supplied together")
    os.chdir(ROOT)
    def interrupted(_signum, _frame):
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, interrupted)
    with tempfile.TemporaryDirectory(prefix="grounded-ocr-network-") as work:
        acceptance = Acceptance(args, work)
        error = None
        try:
            acceptance.setup()
            acceptance.check()
        except (Exception, KeyboardInterrupt) as err:
            error = str(err) or "interrupted"
        finally:
            cleanup_errors = acceptance.cleanup()
            if cleanup_errors:
                error = "; ".join(([error] if error else []) + cleanup_errors)
        report = {"ok": error is None, "source": run(["git", "rev-parse", "HEAD"]).stdout.decode().strip(),
                  "sourceDirty": bool(run(["git", "status", "--porcelain"]).stdout.strip()),
                  "nodeImage": NODE_IMAGE, "image": args.ocr_image, "imageID": getattr(acceptance, "image_id", None),
                  "results": acceptance.results, "error": error}
        if args.report:
            args.report.parent.mkdir(parents=True, exist_ok=True)
            args.report.write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps(report, indent=2))
        return 0 if error is None else 1


if __name__ == "__main__":
    raise SystemExit(main())
