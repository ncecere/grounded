"""Parent regressions for source-bound helper and unchanged Go deadline; no HTTP."""
import pathlib
import runpy
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from tools.issue21.test_outer import FakeProcess


class ParentOuterTests(unittest.TestCase):
    def commands(self):
        with tempfile.TemporaryDirectory() as directory:
            commands = []

            def run(command, **kwargs):
                commands.append(command)
                return subprocess.CompletedProcess(command, 0, "", "")

            def popen(command, **kwargs):
                commands.append(command)
                self.assertTrue(kwargs["start_new_session"])
                return FakeProcess()

            argv = ["outer.py", "--grant", "/private/grant", "--artifacts", directory]
            with patch.object(sys, "argv", argv), patch("subprocess.run", run), patch("subprocess.Popen", popen):
                with self.assertRaises(SystemExit):
                    runpy.run_path(str(pathlib.Path(__file__).with_name("outer.py")), run_name="__main__")
            return commands

    def test_dependency_helper_is_in_pinned_source(self):
        command = self.commands()[0]
        expected = pathlib.Path(__file__).with_name("deps.sh").resolve()
        self.assertEqual(pathlib.Path(command[0]), expected, "dependency helper is outside pinned source")
        self.assertTrue(expected.is_file())

    def test_wrapper_does_not_enlarge_canonical_go_timeout(self):
        command = self.commands()[0]
        self.assertNotIn("25m", command, "wrapper increases Go's original test timeout")


if __name__ == "__main__":
    unittest.main()
