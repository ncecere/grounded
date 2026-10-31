"""Receipt protocol regression tests; no Docker or model HTTP."""
import json
import pathlib
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


class OuterTests(unittest.TestCase):
    def check_receipt(self, test_exit, docker_exit):
        with tempfile.TemporaryDirectory() as directory:
            calls = []

            def run(command, **kwargs):
                calls.append(command)
                if command[0] == "docker":
                    return subprocess.CompletedProcess(command, docker_exit, "", "")
                return subprocess.CompletedProcess(command, test_exit)

            argv = ["outer.py", "--grant", "/private/grant", "--artifacts", directory]
            with patch.object(sys, "argv", argv), patch("subprocess.run", run):
                with self.assertRaises(SystemExit) as result:
                    runpy.run_path(str(pathlib.Path(__file__).with_name("outer.py")), run_name="__main__")
            receipts = list(pathlib.Path(directory).glob("*.receipt.json"))
            self.assertEqual(len(receipts), 1)
            self.assertEqual(receipts[0].stat().st_mode & 0o777, 0o600)
            receipt = json.loads(receipts[0].read_text())
            self.assertNotIn("/private/grant", receipts[0].read_text())
            expected = test_exit == 0 and docker_exit == 0
            self.assertEqual(receipt["passed"], expected)
            self.assertEqual(result.exception.code, 0 if expected else 1)
            self.assertEqual(len(calls), 4)
            self.assertEqual(receipt["fixtureTeardown"], "not_independently_observed")

    def test_pass_requires_exit_and_absence(self):
        self.check_receipt(0, 0)

    def test_private_pass_cannot_mask_failed_cleanup(self):
        self.check_receipt(0, 1)

    def test_failed_test_cannot_pass(self):
        self.check_receipt(1, 0)


if __name__ == "__main__":
    unittest.main()
