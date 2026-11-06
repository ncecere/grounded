#!/usr/bin/env python3
"""publish.sh against fake curl, helm and cosign: a new version is pushed and signed (retrying a failed OIDC token
fetch), a rerun after a failed signing resumes the identical pushed chart without pushing, a signed and attested version
is left alone, and an existing version with other content, or a registry error, is refused. Run by helm-check."""
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
DIGEST = "sha256:" + "a" * 64
OCR = "sha256:" + "b" * 64
CHART = "sha256:" + "c" * 64

CURL = r"""#!/usr/bin/env bash
dump=""; prev=""
for a in "$@"; do [[ "$prev" == --dump-header ]] && dump="$a"; prev="$a"; done
case "$*" in *ghcr.io/token*) echo '{"token":"t"}'; exit 0 ;; esac
[[ -n "$dump" ]] && printf 'HTTP/2 %s\r\ndocker-content-digest: %s\r\n\r\n' "$FAKE_STATUS" "$FAKE_CHART" > "$dump"
printf '%s' "$FAKE_STATUS"
"""

HELM = r"""#!/usr/bin/env bash
echo "helm $*" >> "$FAKE_LOG"
case "$1" in
  package)
    d=$(mktemp -d); cp -a "$2" "$d/grounded"
    v=$(sed -n 's/^version: //p' "$2/Chart.yaml")
    tar -czf "$4/grounded-$v.tgz" -C "$d" grounded ;;
  registry) cat >/dev/null ;;
  push) cp "$2" "$FAKE_REGISTRY/chart.tgz"; echo "Pushed: x"; echo "Digest: $FAKE_CHART" ;;
  pull) cp "$FAKE_REGISTRY/chart.tgz" "$4/grounded-pulled.tgz" ;;
esac
"""

COSIGN = r"""#!/usr/bin/env bash
echo "cosign $*" >> "$FAKE_LOG"
case "$1" in
  verify|verify-attestation)
    case "$*" in *image.yml*) exit 0 ;; esac
    [[ "$FAKE_CHART_SIGNED" == 1 ]] ;;
  sign)
    n=$(cat "$FAKE_REGISTRY/sign-failures" 2>/dev/null || echo 0)
    if (( n > 0 )); then echo $((n - 1)) > "$FAKE_REGISTRY/sign-failures"; echo "fetching ambient OIDC credentials: invalid character 'u'" >&2; exit 1; fi ;;
  attest) ;;
esac
"""


def setup(tmp: Path) -> Path:
    tree = tmp / "repo"
    (tree / "deploy/helm/scripts").mkdir(parents=True)
    shutil.copytree(ROOT / "deploy/helm/grounded", tree / "deploy/helm/grounded")
    shutil.copy(ROOT / "deploy/helm/scripts/publish.sh", tree / "deploy/helm/scripts/publish.sh")
    (tree / "deploy/helm/scripts/generate.py").write_text("import sys\nsys.exit(0)\n")
    bin_dir = tmp / "bin"
    bin_dir.mkdir()
    for name, body in {"curl": CURL, "helm": HELM, "cosign": COSIGN, "sleep": "#!/usr/bin/env bash\n"}.items():
        (bin_dir / name).write_text(body)
        (bin_dir / name).chmod(0o755)
    (tmp / "registry").mkdir()
    return tree


def run(tmp: Path, tree: Path, status: str, signed: bool = False, sign_failures: int = 0):
    log = tmp / "calls.log"
    log.write_text("")
    (tmp / "registry/sign-failures").write_text(str(sign_failures))
    env = dict(os.environ, PATH=f"{tmp / 'bin'}:{os.environ['PATH']}", TAG="v9.1.0", DIGEST=DIGEST, OCR_DIGEST=OCR,
               GITHUB_TOKEN="token", GITHUB_ACTOR="actor", GITHUB_REPOSITORY="ncecere/grounded",
               GITHUB_REPOSITORY_OWNER="ncecere", GITHUB_SHA="0" * 40, GITHUB_REF="refs/tags/v9.1.0",
               GITHUB_STEP_SUMMARY=str(tmp / "summary.md"), FAKE_STATUS=status, FAKE_CHART=CHART,
               FAKE_CHART_SIGNED="1" if signed else "0", FAKE_LOG=str(log), FAKE_REGISTRY=str(tmp / "registry"))
    p = subprocess.run(["bash", "deploy/helm/scripts/publish.sh"], cwd=tree, env=env, capture_output=True, text=True)
    return p, log.read_text().splitlines()


def check(cond: bool, what: str, p, calls):
    if not cond:
        sys.exit(f"FAIL: {what}\nexit {p.returncode}\nstdout:\n{p.stdout}\nstderr:\n{p.stderr}\ncalls:\n" + "\n".join(calls))
    print(f"ok: {what}")


def main():
    with tempfile.TemporaryDirectory() as d:
        tmp = Path(d)
        tree = setup(tmp)

        p, calls = run(tmp, tree, "404", sign_failures=2)
        pushes = [c for c in calls if c.startswith("helm push")]
        signs = [c for c in calls if c.startswith("cosign sign")]
        check(p.returncode == 0 and len(pushes) == 1 and len(signs) == 3 and any(c.startswith("cosign attest") for c in calls),
              "a new version is pushed once, signing is retried after two token failures, and it is attested", p, calls)
        check(all(f"@{CHART}" in c for c in signs), "the pushed digest is signed", p, calls)

        p, calls = run(tmp, tree, "200")
        check(p.returncode == 0 and not any(c.startswith("helm push") for c in calls)
              and any(c.startswith(f"cosign sign --yes ghcr.io/ncecere/charts/grounded@{CHART}") for c in calls)
              and "resuming 9.1.0" in p.stdout,
              "a rerun resumes the identical unsigned chart: signed, not pushed", p, calls)

        p, calls = run(tmp, tree, "200", signed=True)
        check(p.returncode == 0 and not any(c.startswith(("helm push", "cosign sign", "cosign attest")) for c in calls)
              and "already published" in p.stdout,
              "a signed and attested version is left alone", p, calls)

        with tempfile.TemporaryDirectory() as x:
            subprocess.run(["tar", "-xzf", str(tmp / "registry/chart.tgz"), "-C", x], check=True)
            values = Path(x, "grounded/values.yaml")
            values.write_text(values.read_text().replace(OCR, "sha256:" + "d" * 64))
            subprocess.run(["tar", "-czf", str(tmp / "registry/chart.tgz"), "-C", x, "grounded"], check=True)
        p, calls = run(tmp, tree, "200")
        check(p.returncode != 0 and not any(c.startswith(("helm push", "cosign sign", "cosign attest")) for c in calls)
              and "exists with different content" in p.stderr,
              "an existing version with other content (another OCR digest) is refused", p, calls)

        p, calls = run(tmp, tree, "500")
        check(p.returncode != 0 and not any(c.startswith(("helm", "cosign sign")) for c in calls),
              "a registry error is refused before anything is pushed", p, calls)


if __name__ == "__main__":
    main()
