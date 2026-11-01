"""Receipt/process-ownership controls; no Docker, model HTTP or real signals."""
import json
import pathlib
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


class FakeProcess:
    pid = 123456789

    def __init__(self, exit_code=0, waits=None):
        self.exit_code = exit_code
        self.returncode = None
        self.waits = list(waits or [])

    def wait(self, timeout):
        action = self.waits.pop(0) if self.waits else self.exit_code
        if action == "timeout":
            raise subprocess.TimeoutExpired("owned-test", timeout)
        if action == "interrupt":
            raise KeyboardInterrupt
        self.returncode = action
        return action


class OuterTests(unittest.TestCase):
    def check_receipt(self, test_exit, docker_exit, waits=None):
        with tempfile.TemporaryDirectory() as directory:
            calls = []
            signals = []

            def popen(command, **kwargs):
                calls.append(command)
                self.assertTrue(kwargs["start_new_session"])
                self.assertEqual(kwargs["cwd"], pathlib.Path(__file__).resolve().parents[2])
                return FakeProcess(test_exit, waits)

            def run(command, **kwargs):
                calls.append(command)
                self.assertEqual(command[0], "docker")
                return subprocess.CompletedProcess(command, docker_exit, "", "")

            argv = ["outer.py", "--grant", "/private/grant", "--artifacts", directory]
            with patch.object(sys, "argv", argv), patch("subprocess.Popen", popen), patch("subprocess.run", run), patch("os.killpg", lambda pid, sig: signals.append((pid, sig.name))):
                with self.assertRaises(SystemExit) as result:
                    runpy.run_path(str(pathlib.Path(__file__).with_name("outer.py")), run_name="__main__")
            receipts = list(pathlib.Path(directory).glob("*.receipt.json"))
            self.assertEqual(len(receipts), 1)
            self.assertEqual(receipts[0].stat().st_mode & 0o777, 0o600)
            receipt = json.loads(receipts[0].read_text())
            self.assertNotIn("/private/grant", receipts[0].read_text())
            expected = test_exit == 0 and docker_exit == 0 and not waits
            self.assertEqual(receipt["passed"], expected)
            self.assertEqual(result.exception.code, 0 if expected else 1)
            self.assertEqual(len(calls), 4)
            self.assertEqual(receipt["fixtureTeardown"], "not_independently_observed")
            return receipt, signals

    def test_pass_requires_exit_and_absence(self):
        self.check_receipt(0, 0)

    def test_private_pass_cannot_mask_failed_cleanup(self):
        self.check_receipt(0, 1)

    def test_failed_test_cannot_pass(self):
        self.check_receipt(1, 0)

    def test_timeout_terminates_owned_group_not_just_wrapper(self):
        receipt, signals = self.check_receipt(0, 0, ["timeout", "timeout", -9])
        self.assertEqual(receipt["failureCode"], "outer_timeout")
        self.assertEqual(receipt["testExit"], -9)
        self.assertEqual(signals, [(FakeProcess.pid, "SIGTERM"), (FakeProcess.pid, "SIGKILL")])

    def test_interrupted_success_still_fails_and_ends_child(self):
        receipt, signals = self.check_receipt(0, 0, ["interrupt", 0])
        self.assertEqual(receipt["failureCode"], "outer_interrupted")
        self.assertEqual(signals, [(FakeProcess.pid, "SIGTERM")])


if __name__ == "__main__":
    unittest.main()
