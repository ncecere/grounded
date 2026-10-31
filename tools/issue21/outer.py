#!/usr/bin/env python3
"""Parent-managed single-run wrapper. No spending authority is supplied here."""
import argparse
import json
import os
import pathlib
import subprocess
import uuid

parser = argparse.ArgumentParser()
parser.add_argument("--grant", required=True)
parser.add_argument("--artifacts", required=True)
args = parser.parse_args()
directory = pathlib.Path(args.artifacts)
# Refuse symlink components, noncanonical paths and shared output directories.
if not directory.is_absolute() or str(directory.resolve()) != str(directory):
    parser.error("canonical private artifact directory required")
if directory.stat().st_mode & 0o777 != 0o700 or directory.stat().st_uid != os.getuid():
    parser.error("owner-private artifact directory required")
run_id = "issue21-" + str(uuid.uuid4())
env = dict(os.environ, RUN_ID=run_id, GOMAXPROCS="4", GOFLAGS="-p=2")
command = ["/home/user/test-with-deps.sh", "go", "test", "-race", "-count=1",
           "-timeout", "25m", "./internal/contextual", "-run",
           "^TestIssue21LiveAcceptance$", "-args", "-issue21-grant", args.grant]
receipt = {"runID": run_id, "testExited": False, "testExit": None,
           "fixtureTeardown": "not_independently_observed",
           "dependencyCleanup": "unknown", "passed": False}
# Exclusive private artifacts. Never record the command (it contains a grant path).
with open(directory / (run_id + ".log"), "xb", opener=lambda p, f: os.open(p, f, 0o600)) as log:
    try:
        result = subprocess.run(command, env=env, stdout=log, stderr=log, timeout=1560)
        receipt.update(testExited=True, testExit=result.returncode)
    except subprocess.TimeoutExpired:
        receipt["failureCode"] = "outer_timeout"
    except OSError:
        receipt["failureCode"] = "outer_execution"
evidence = {}
for kind, name in [("container", run_id + "-pg"), ("container", run_id + "-valkey"),
                   ("network", run_id + "-net")]:
    exact = "grounded-focused-" + name
    cmd = ["docker", "ps", "-a", "--format", "{{.Names}}"] if kind == "container" else [
        "docker", "network", "ls", "--format", "{{.Name}}"]
    try:
        check = subprocess.run(cmd, capture_output=True, text=True, timeout=10)
        evidence[exact] = check.returncode == 0 and exact not in check.stdout.splitlines()
    except (OSError, subprocess.TimeoutExpired):
        evidence[exact] = False
receipt["independentAbsence"] = evidence
receipt["dependencyCleanup"] = "absent" if all(evidence.values()) else "failed_or_unknown"
receipt["passed"] = receipt["testExited"] and receipt["testExit"] == 0 and all(evidence.values())
with open(directory / (run_id + ".receipt.json"), "xb", opener=lambda p, f: os.open(p, f, 0o600)) as out:
    out.write(json.dumps(receipt).encode())
    out.flush()
    os.fsync(out.fileno())
fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
try:
    os.fsync(fd)
finally:
    os.close(fd)
raise SystemExit(0 if receipt["passed"] else 1)
