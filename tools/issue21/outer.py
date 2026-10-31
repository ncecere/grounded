#!/usr/bin/env python3
"""Parent-managed single-run receipt. No spending authority is supplied here."""
import argparse
import json
import os
import pathlib
import signal
import stat
import subprocess
import uuid


def terminate_owned(process, receipt):
    """A timed-out wrapper must not leave Go/model calls running behind it."""
    receipt["ownedProcessGroupTermination"] = []
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.killpg(process.pid, sig)
            receipt["ownedProcessGroupTermination"].append(sig.name)
        except ProcessLookupError:
            pass
        try:
            code = process.wait(timeout=10)
            receipt.update(testExited=True, testExit=code)
            return
        except subprocess.TimeoutExpired:
            continue
    receipt["processTermination"] = "failed_or_unknown"


def run_test(command, env, log, repo, receipt):
    process = None
    previous = signal.getsignal(signal.SIGTERM)

    def interrupted(_signal, _frame):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, interrupted)
    try:
        # This group is owned and synchronously waited, not a detached daemon.
        process = subprocess.Popen(command, cwd=repo, env=env, stdout=log,
                                   stderr=log, start_new_session=True)
        code = process.wait(timeout=660)
        receipt.update(testExited=True, testExit=code)
    except subprocess.TimeoutExpired:
        receipt["failureCode"] = "outer_timeout"
    except KeyboardInterrupt:
        receipt["failureCode"] = "outer_interrupted"
    except OSError:
        receipt["failureCode"] = "outer_execution"
    finally:
        if process is not None and process.returncode is None:
            terminate_owned(process, receipt)
        signal.signal(signal.SIGTERM, previous)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--grant", required=True)
    parser.add_argument("--artifacts", required=True)
    args = parser.parse_args()
    directory = pathlib.Path(args.artifacts)
    try:
        if not directory.is_absolute() or directory.resolve() != directory:
            raise ValueError
        fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        info = os.fstat(fd)
        if stat.S_IMODE(info.st_mode) != 0o700 or info.st_uid != os.getuid():
            os.close(fd)
            raise ValueError
    except (OSError, ValueError):
        parser.error("canonical owner-private artifact directory required")
    run_id = "issue21-" + str(uuid.uuid4())
    repo = pathlib.Path(__file__).resolve().parents[2]
    helper = pathlib.Path(__file__).with_name("deps.sh").resolve()
    env = dict(os.environ, RUN_ID=run_id, GOMAXPROCS="4", GOFLAGS="-p=2")
    # Default Go timeout stays unchanged (10m); the selected run is <=300s.
    command = [str(helper), "go", "test", "-race", "-count=1",
               "./internal/contextual", "-run", "^TestIssue21LiveAcceptance$",
               "-args", "-issue21-grant", args.grant]
    receipt = {"runID": run_id, "testExited": False, "testExit": None,
               "fixtureTeardown": "not_independently_observed",
               "dependencyCleanup": "unknown", "passed": False}
    try:
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
        log_fd = os.open(run_id + ".log", flags, 0o600, dir_fd=fd)
        with os.fdopen(log_fd, "wb") as log:
            run_test(command, env, log, repo, receipt)
        evidence = {}
        for kind, name in [("container", run_id + "-pg"),
                           ("container", run_id + "-valkey"),
                           ("network", run_id + "-net")]:
            exact = "grounded-focused-" + name
            check_command = (["docker", "ps", "-a", "--format", "{{.Names}}"]
                             if kind == "container" else
                             ["docker", "network", "ls", "--format", "{{.Name}}"])
            try:
                check = subprocess.run(check_command, capture_output=True,
                                       text=True, timeout=10)
                evidence[exact] = check.returncode == 0 and exact not in check.stdout.splitlines()
            except (OSError, subprocess.TimeoutExpired):
                evidence[exact] = False
        receipt["independentAbsence"] = evidence
        receipt["dependencyCleanup"] = "absent" if all(evidence.values()) else "failed_or_unknown"
        receipt["passed"] = (not receipt.get("failureCode") and receipt["testExited"]
                             and receipt["testExit"] == 0 and all(evidence.values()))
        out_fd = os.open(run_id + ".receipt.json", flags, 0o600, dir_fd=fd)
        with os.fdopen(out_fd, "wb") as out:
            out.write(json.dumps(receipt).encode())
            out.flush()
            os.fsync(out.fileno())
        os.fsync(fd)
    finally:
        os.close(fd)
    raise SystemExit(0 if receipt["passed"] else 1)


if __name__ == "__main__":
    main()
