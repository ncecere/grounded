import copy
import tempfile
from types import SimpleNamespace
import unittest

from ocr_networkpolicy import Acceptance, http_target, tcp_target, verify_local_kind


class LocalKindGuardTests(unittest.TestCase):
    def setUp(self):
        self.cluster = "grounded-smoke"
        self.config = {"current-context": "kind-grounded-smoke", "clusters": [
            {"cluster": {"server": "https://127.0.0.1:31415"}}]}
        self.node = {"Config": {"Labels": {"io.x-k8s.kind.cluster": self.cluster}},
                     "NetworkSettings": {"Ports": {"6443/tcp": [
                         {"HostIp": "127.0.0.1", "HostPort": "31415"}]}}}

    def test_accepts_only_the_matched_local_node(self):
        verify_local_kind(self.config, self.node, self.cluster)
        config = copy.deepcopy(self.config)
        config["clusters"][0]["cluster"]["server"] = "https://[::1]:31415"
        node = copy.deepcopy(self.node)
        node["NetworkSettings"]["Ports"]["6443/tcp"][0]["HostIp"] = "::1"
        verify_local_kind(config, node, self.cluster)

    def test_rejects_wrong_context_remote_servers_and_ports(self):
        for server in ["https://cluster.example.edu:31415", "https://192.0.2.1:31415",
                       "https://127.0.0.1:6443", "http://127.0.0.1:31415"]:
            with self.subTest(server=server):
                config = copy.deepcopy(self.config)
                config["clusters"][0]["cluster"]["server"] = server
                with self.assertRaises(ValueError):
                    verify_local_kind(config, self.node, self.cluster)
        config = copy.deepcopy(self.config)
        config["current-context"] = "admin@other-cluster"
        with self.assertRaises(ValueError):
            verify_local_kind(config, self.node, self.cluster)

    def test_rejects_unlabelled_nodes_and_exposed_api_bindings(self):
        node = copy.deepcopy(self.node)
        node["Config"]["Labels"] = {}
        with self.assertRaises(ValueError):
            verify_local_kind(self.config, node, self.cluster)
        node = copy.deepcopy(self.node)
        node["NetworkSettings"]["Ports"]["6443/tcp"][0]["HostIp"] = "0.0.0.0"
        with self.assertRaises(ValueError):
            verify_local_kind(self.config, node, self.cluster)

    def test_component_renders_from_an_isolated_scratch_tree(self):
        args = SimpleNamespace(cluster=None, kubeconfig=None, ocr_image="unused-by-client-render")
        with tempfile.TemporaryDirectory() as work:
            rendered = Acceptance(args, work).render_component().decode()
        self.assertIn("namespace: dev-grounded", rendered)
        self.assertIn("name: grounded-ocr-ingress", rendered)
        self.assertIn("imagePullPolicy: Never", rendered)

    def test_probe_targets_support_both_ip_families(self):
        self.assertEqual(tcp_target("192.0.2.1"), "192.0.2.1:8080")
        self.assertEqual(http_target("2001:db8::1"), "http://[2001:db8::1]:8080/healthz")


if __name__ == "__main__":
    unittest.main()
