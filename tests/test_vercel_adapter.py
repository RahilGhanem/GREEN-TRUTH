"""
Tests for the Vercel entry point (api/index.py) and its configuration.

The adapter must serve the same API as `python server.py`: same routes, same
engine, same responses. It is exercised over real HTTP, with requests shaped
both ways Vercel may deliver them (the original URL, or the rewritten
/api/index?__gt_path=... URL), from a working directory other than the
project root, as on Vercel.
"""

import http.client
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("GREENTRUTH_DETECTOR", "rule_based")

import server                     # noqa: E402
from api import index as vercel   # noqa: E402

CASE_TEXT = "We reduced routine gas flaring by 25% from 2019 levels."


class RestorePath(unittest.TestCase):
    def test_rewritten_paths_are_restored(self):
        r = vercel.restore_path
        self.assertEqual(r("/api/index?__gt_path=health"), "/api/health")
        self.assertEqual(r("/api/index?__gt_path=demo%2Fcases"), "/api/demo/cases")
        self.assertEqual(r("/api/index?__gt_path=fields/us_permian/observations&x=1"),
                         "/api/fields/us_permian/observations?x=1")

    def test_original_paths_pass_through(self):
        for p in ("/api/health", "/api/demo/cases", "/api/map?x=1"):
            self.assertEqual(vercel.restore_path(p), p)

    def test_restored_path_always_stays_under_api(self):
        self.assertTrue(vercel.restore_path("/api/index?__gt_path=../../web/index.html")
                        .startswith("/api/"))


class SameEngine(unittest.TestCase):
    def test_adapter_is_the_local_handler(self):
        self.assertTrue(issubclass(vercel.handler, server.Handler))
        # One engine module-wide: the adapter adds no second implementation.
        self.assertIs(sys.modules["server"].ENGINE, server.ENGINE)


class AdapterOverHTTP(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._cwd = os.getcwd()
        cls._tmp = tempfile.mkdtemp()
        os.chdir(cls._tmp)              # Vercel's cwd is not guaranteed to be ours
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), vercel.handler)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        os.chdir(cls._cwd)
        shutil.rmtree(cls._tmp, ignore_errors=True)

    def request(self, method, path, body=None, headers=None):
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=60)
        conn.request(method, path, body=body, headers=headers or {})
        resp = conn.getresponse()
        data = resp.read()
        conn.close()
        return resp.status, resp.getheader("Content-Type") or "", data

    def get_json(self, path):
        status, ctype, data = self.request("GET", path)
        self.assertIn("application/json", ctype, path)
        return status, json.loads(data)

    def both_forms(self, sub):
        return (f"/api/{sub}", f"/api/index?__gt_path={sub}")

    def test_every_get_endpoint_answers_in_both_url_forms(self):
        for sub in ("health", "meta", "fields", "map", "basemap", "research",
                    "methane/coverage", "demo", "demo/cases"):
            bodies = []
            for path in self.both_forms(sub):
                status, body = self.get_json(path)
                self.assertEqual(status, 200, path)
                bodies.append(body)
            self.assertEqual(bodies[0], bodies[1], sub)

    def test_field_observations_route_with_nested_path(self):
        _, fields = self.get_json("/api/fields")
        fid = fields["fields"][0]["id"]
        for path in self.both_forms(f"fields/{fid}/observations"):
            status, body = self.get_json(path)
            self.assertEqual(status, 200, path)
            self.assertEqual(body["field"]["id"], fid)
        status, _ = self.get_json("/api/index?__gt_path=fields/no_such_field/observations")
        self.assertEqual(status, 404)

    def test_health_reports_real_data_and_the_detector_honestly(self):
        _, h = self.get_json("/api/index?__gt_path=health")
        self.assertTrue(h["has_real_data"])
        self.assertEqual(h["n_fields"], 12)
        self.assertEqual(h["detector"], server.ENGINE.detector_info)

    def test_analyze_matches_the_engine_directly(self):
        payload = json.dumps({"text": CASE_TEXT, "company": "Permian Basin"})
        for path in self.both_forms("analyze"):
            status, ctype, data = self.request("POST", path, payload,
                                               {"Content-Type": "application/json"})
            self.assertEqual(status, 200, path)
            got = json.loads(data)
            want = json.loads(json.dumps(server.ENGINE.analyze(CASE_TEXT, "Permian Basin")))
            self.assertEqual(got["claims"][0]["verdict"], want["claims"][0]["verdict"])
            self.assertEqual(got["claims"][0]["analysis"], want["claims"][0]["analysis"])

    def test_analyze_rejects_bad_input_without_a_stack_trace(self):
        path = "/api/index?__gt_path=analyze"
        cases = [
            (json.dumps({"text": ""}), 400),
            (json.dumps({"text": "   "}), 400),
            ("{not json", 400),
            (json.dumps(["a list"]), 400),
        ]
        for body, want in cases:
            status, _, data = self.request("POST", path, body, {"Content-Type": "application/json"})
            self.assertEqual(status, want, body)
            self.assertNotIn(b"Traceback", data)
            self.assertIn("error", json.loads(data))
        status, _, _ = self.request("POST", path, "{}", {"Content-Length": str(server.MAX_BODY + 1)})
        self.assertEqual(status, 413)

    def test_unknown_and_static_paths_are_not_served_by_the_function(self):
        for path in ("/api/index?__gt_path=nope", "/api/nope",
                     "/api/index?__gt_path=../../web/index.html", "/index.html", "/app.js"):
            status, _, data = self.request("GET", path)
            self.assertEqual(status, 404, path)
            self.assertNotIn(b"<html", data.lower())
        status, _, _ = self.request("POST", "/api/index?__gt_path=health", "{}")
        self.assertEqual(status, 404)


class DeploymentConfig(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(os.path.join(ROOT, "vercel.json"), encoding="utf-8") as f:
            cls.cfg = json.load(f)

    def test_static_root_is_the_interface(self):
        out = os.path.join(ROOT, self.cfg["outputDirectory"])
        self.assertTrue(os.path.isfile(os.path.join(out, "index.html")))
        self.assertIsNone(self.cfg["framework"],
                          "'Other' preset, so root server.py is not taken as a framework app")

    def test_rewrite_targets_the_adapter(self):
        (rw,) = self.cfg["rewrites"]
        self.assertEqual(rw["source"], "/api/:path(.*)")
        self.assertTrue(rw["destination"].startswith("/api/index?" + vercel.PATH_PARAM + "="))
        self.assertTrue(os.path.isfile(os.path.join(ROOT, "api", "index.py")))

    def test_function_bundle_keeps_every_runtime_input(self):
        excluded = self.cfg["functions"]["api/index.py"]["excludeFiles"]
        for needed in ("greentruth", "data/", "evaluation", "server.py", ".csv", ".json"):
            self.assertNotIn(needed, excluded)

    def test_every_asset_the_page_references_exists(self):
        import re
        web = os.path.join(ROOT, "web")
        with open(os.path.join(web, "index.html"), encoding="utf-8") as f:
            html = f.read()
        with open(os.path.join(web, "style.css"), encoding="utf-8") as f:
            css = f.read()
        refs = set(re.findall(r'(?:src|href)="(/[^"#?]+)"', html)) | set(re.findall(r'url\("(/[^"]+)"\)', css))
        self.assertTrue(refs)
        for ref in refs:
            self.assertTrue(os.path.isfile(os.path.join(web, *ref.lstrip("/").split("/"))), ref)

    @unittest.skipUnless(shutil.which("git") and os.path.isdir(os.path.join(ROOT, ".git")), "not a git checkout")
    def test_runtime_data_is_not_git_ignored(self):
        # A Git-triggered deployment only contains committed files.
        for rel in ("data/real/flaring_by_field.csv", "data/real/flaring_by_country.csv",
                    "data/real/methane_by_field_s5p.csv", "data/facilities_international.json",
                    "data/geo/world_110m.json", "evaluation/experiment_registry.json"):
            ignored = subprocess.run(["git", "check-ignore", "-q", rel], cwd=ROOT).returncode == 0
            self.assertFalse(ignored, rel)


if __name__ == "__main__":
    unittest.main()
