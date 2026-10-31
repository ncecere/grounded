#!/usr/bin/env python3
"""Sequential controlled canonical mutation; always restore source and chart."""
import hashlib
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[3]
ARTIFACTS = Path(sys.argv[1]).resolve()
if ARTIFACTS == ROOT or ROOT in ARTIFACTS.parents:
    raise SystemExit('mutation evidence must be outside the repository')
ARTIFACTS.mkdir(parents=True, exist_ok=True)
SOURCE = ROOT / 'deploy/kubernetes/base/serviceaccount.yaml'
CHART = ROOT / 'deploy/helm/grounded'
original = SOURCE.read_bytes()
log = ARTIFACTS / 'commands.log'


def run(args, expected=0):
    p = subprocess.run(args, cwd=ROOT, text=True, capture_output=True, timeout=180)
    with log.open('a') as f:
        f.write(f'$ {" ".join(args)}\nexit={p.returncode}\n{p.stdout}{p.stderr}\n')
    if p.returncode != expected:
        raise RuntimeError(f'unexpected exit {p.returncode}, expected {expected}')


with tempfile.TemporaryDirectory() as d:
    backup = Path(d, 'chart')
    shutil.copytree(CHART, backup)
    try:
        mutated = original.replace(b'metadata:\n', b'metadata:\n  annotations:\n    helm-mutation-control: detected\n', 1)
        assert mutated != original
        SOURCE.write_bytes(mutated)
        (ARTIFACTS / 'mutated-serviceaccount.yaml').write_bytes(mutated)
        run(['python3', 'deploy/helm/scripts/generate.py', '--check'], expected=1)
        run(['python3', 'deploy/helm/scripts/generate.py'])
        run(['python3', 'deploy/helm/scripts/generate.py', '--check'])
        run(['python3', 'deploy/helm/scripts/test_chart.py', 'ChartTest.test_defaults'])
    finally:
        SOURCE.write_bytes(original)
        shutil.rmtree(CHART)
        shutil.copytree(backup, CHART)
        assert SOURCE.read_bytes() == original
        (ARTIFACTS / 'restored-source.sha256').write_text(hashlib.sha256(original).hexdigest() + '\n')
run(['python3', 'deploy/helm/scripts/generate.py', '--check'])
print('stale check failed before regeneration, passed after, and canonical source/chart restored')
