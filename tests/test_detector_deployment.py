"""
Tests for the claim detector as deployed (locally and on Vercel).

The unit tests replace `torch` and `transformers` with small stand-ins, so they
run offline and without PyTorch installed. They check what matters for a
deployment: the model is loaded lazily and only once, a failed load falls back
to the rules without crashing and says why, and the API never reports a model
that is not running.

The integration tests at the bottom load the real published model and compare
it with the rule detector on the three demo cases. They need PyTorch,
Transformers and network access (or a warm Hugging Face cache), so they only
run when explicitly requested:

    GREENTRUTH_TEST_CLIMATEBERT=1 python -m unittest discover -s tests
"""

import http.client
import json
import os
import sys
import tempfile
import threading
import time
import types
import unittest
from http.server import ThreadingHTTPServer
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("GREENTRUTH_DETECTOR", "rule_based")

from greentruth import GreenTruth, detectors  # noqa: E402

MODEL = detectors.DEFAULT_MODEL_ID


# ---------------------------------------------------------------- stand-ins

class _Tensor:
    def __init__(self, rows):
        self.rows = rows

    def __getitem__(self, ij):
        i, j = ij
        return self.rows[i][j]


def fake_modules(fail_with=None, positive_logit=2.0):
    """A minimal torch + transformers pair. `fail_with` makes from_pretrained raise."""
    calls = {"tokenizer": 0, "model": 0}

    torch = types.ModuleType("torch")
    torch.__version__ = "0.0-test+cpu"

    class _NoGrad:
        def __enter__(self):
            return None

        def __exit__(self, *a):
            return False

    torch.no_grad = _NoGrad

    def softmax(t, dim=-1):
        import math
        out = []
        for row in t.rows:
            e = [math.exp(v) for v in row]
            out.append([v / sum(e) for v in e])
        return _Tensor(out)

    torch.softmax = softmax

    tf = types.ModuleType("transformers")
    tf.__version__ = "0.0-test"

    class AutoTokenizer:
        @staticmethod
        def from_pretrained(model_id):
            calls["tokenizer"] += 1
            if fail_with:
                raise fail_with
            return lambda text, **kw: {"input_ids": text}

    class _Model:
        config = types.SimpleNamespace(id2label={0: "not_claim", 1: "environmental_claim"})

        def eval(self):
            return self

        def __call__(self, **enc):
            return types.SimpleNamespace(logits=_Tensor([[0.0, positive_logit]]))

    class AutoModelForSequenceClassification:
        @staticmethod
        def from_pretrained(model_id):
            calls["model"] += 1
            if fail_with:
                raise fail_with
            return _Model()

    tf.AutoTokenizer = AutoTokenizer
    tf.AutoModelForSequenceClassification = AutoModelForSequenceClassification
    return {"torch": torch, "transformers": tf}, calls


class DetectorCase(unittest.TestCase):
    def setUp(self):
        detectors.reset_cache()
        self._env = mock.patch.dict(os.environ, {"GREENTRUTH_DETECTOR": "auto"})
        self._env.start()

    def tearDown(self):
        self._env.stop()
        detectors.reset_cache()


# ---------------------------------------------------------------- loading

class LazyLoading(DetectorCase):
    def test_constructing_the_engine_loads_no_detector(self):
        built = []
        real_build = detectors._build
        with mock.patch.object(detectors, "_build", side_effect=lambda p: built.append(p) or real_build("rule_based")):
            gt = GreenTruth()
            self.assertEqual(built, [], "importing/constructing must not load the model")
            self.assertEqual(gt.detector_status()["detector"], "pending")
            self.assertIsNone(gt.detector_status()["fallback"])
            info = gt.detector_info                     # first real use
            self.assertEqual(len(built), 1)
            self.assertEqual(gt.detector_status(), info)  # no longer pending

    def test_model_is_loaded_once_and_reused(self):
        mods, calls = fake_modules()
        with mock.patch.dict(sys.modules, mods):
            a, _ = detectors.get_detector()
            b, _ = detectors.get_detector()
            GreenTruth().detector_info
        self.assertIs(a, b)
        self.assertEqual(calls, {"tokenizer": 1, "model": 1})

    def test_concurrent_first_requests_share_one_load(self):
        built = []

        def slow_build(prefer):
            built.append(prefer)
            time.sleep(0.2)
            return detectors.RuleBasedDetector()

        with mock.patch.object(detectors, "_build", side_effect=slow_build):
            threads = [threading.Thread(target=detectors.get_detector) for _ in range(6)]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
        self.assertEqual(len(built), 1)


class SuccessfulLoad(DetectorCase):
    def test_reports_the_model_honestly_and_scores(self):
        mods, _ = fake_modules()
        with mock.patch.dict(sys.modules, mods):
            det, info = detectors.get_detector()
            keep, prob = det.score("We reduced routine gas flaring by 40% in 2023.")
        self.assertEqual(info["detector"], "climatebert")
        self.assertFalse(info["fallback"])
        self.assertEqual(info["model_id"], MODEL)
        self.assertFalse(info["requires_token"])
        self.assertEqual(info["device"], "cpu")
        self.assertEqual(info["versions"], {"torch": "0.0-test+cpu", "transformers": "0.0-test"})
        self.assertIsInstance(info["load_seconds"], float)
        self.assertNotIn("reason", info)
        self.assertTrue(keep)
        self.assertGreater(prob, 0.5)
        self.assertLessEqual(prob, 1.0)


# ---------------------------------------------------------------- fallback

class Fallback(DetectorCase):
    def test_torch_missing_falls_back_and_says_why(self):
        with mock.patch.dict(sys.modules, {"torch": None, "transformers": None}):
            _, info = detectors.get_detector()
            with self.assertRaises(RuntimeError):
                detectors.get_detector("climatebert", use_cache=False)
        self.assertEqual(info["detector"], "rule_based")
        self.assertTrue(info["fallback"])
        self.assertIn("torch", info["reason"])

    def test_model_download_failure_falls_back_and_says_why(self):
        mods, _ = fake_modules(fail_with=OSError("network unreachable"))
        with mock.patch.dict(sys.modules, mods):
            _, info = detectors.get_detector()
        self.assertEqual(info["detector"], "rule_based")
        self.assertTrue(info["fallback"])
        self.assertIn(f"could not load '{MODEL}'", info["reason"])
        self.assertIn("network unreachable", info["reason"])

    def test_a_failed_load_never_breaks_an_analysis(self):
        mods, _ = fake_modules(fail_with=OSError("hub unreachable"))
        with mock.patch.dict(sys.modules, mods):
            res = GreenTruth().analyze("We reduced routine gas flaring by 25% from 2019 levels.", "Permian Basin")
        self.assertEqual(res["detector"]["detector"], "rule_based")
        self.assertTrue(res["detector"]["reason"])
        self.assertEqual(res["claims"][0]["claim"]["detector"], "rule_based")
        self.assertEqual(res["claims"][0]["verdict"], "abstain")


# ---------------------------------------------------------------- cache location

class ModelCacheLocation(unittest.TestCase):
    def test_configured_cache_is_left_alone(self):
        with mock.patch.dict(os.environ, {"HF_HOME": "/somewhere/configured"}):
            detectors._prepare_model_cache()
            self.assertEqual(os.environ["HF_HOME"], "/somewhere/configured")

    def test_read_only_home_moves_the_cache_to_the_temp_dir(self):
        blocker = tempfile.NamedTemporaryFile(delete=False)
        blocker.close()
        try:
            env = {k: v for k, v in os.environ.items()
                   if k not in ("HF_HOME", "HF_HUB_CACHE", "HF_XET_CHUNK_CACHE_SIZE_BYTES")}
            with mock.patch.dict(os.environ, env, clear=True), \
                 mock.patch.object(detectors.os.path, "expanduser", return_value=os.path.join(blocker.name, "home")):
                detectors._prepare_model_cache()
                self.assertEqual(os.environ["HF_HOME"], os.path.join(tempfile.gettempdir(), "huggingface"))
                self.assertEqual(os.environ["HF_XET_CHUNK_CACHE_SIZE_BYTES"], "0")
        finally:
            os.remove(blocker.name)


# ---------------------------------------------------------------- API (via the Vercel adapter)

class ApiReportsTheRealDetector(DetectorCase):
    def setUp(self):
        super().setUp()
        import server
        from api import index as vercel
        self.server = server
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), vercel.handler)
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        super().tearDown()

    def get(self, path):
        conn = http.client.HTTPConnection("127.0.0.1", self.httpd.server_address[1], timeout=30)
        conn.request("GET", path)
        body = json.loads(conn.getresponse().read())
        conn.close()
        return body

    def test_meta_is_pending_until_health_loads_the_model(self):
        mods, calls = fake_modules()
        with mock.patch.dict(sys.modules, mods):
            self.assertEqual(self.get("/api/index?__gt_path=meta")["detector"]["detector"], "pending")
            self.assertEqual(calls["model"], 0, "/api/meta must not load the model")
            h = self.get("/api/index?__gt_path=health")["detector"]
            self.assertEqual((h["detector"], h["fallback"]), ("climatebert", False))
            self.assertEqual(self.get("/api/meta")["detector"], h)
        self.assertEqual(calls["model"], 1)

    def test_health_reports_the_fallback_with_its_reason(self):
        mods, _ = fake_modules(fail_with=OSError("offline"))
        with mock.patch.dict(sys.modules, mods):
            h = self.get("/api/health")["detector"]
        self.assertEqual((h["detector"], h["fallback"]), ("rule_based", True))
        self.assertIn("offline", h["reason"])


# ---------------------------------------------------------------- real model (opt-in)

@unittest.skipUnless(os.environ.get("GREENTRUTH_TEST_CLIMATEBERT") == "1",
                     "set GREENTRUTH_TEST_CLIMATEBERT=1 to load the real model")
class RealClimateBERT(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        detectors.reset_cache()
        cls.det, cls.info = detectors.get_detector("climatebert", use_cache=False)

    @classmethod
    def tearDownClass(cls):
        detectors.reset_cache()

    def test_the_published_model_loads_on_cpu(self):
        self.assertEqual(self.info["detector"], "climatebert")
        self.assertFalse(self.info["fallback"])
        self.assertEqual(self.info["model_id"], MODEL)
        self.assertEqual(self.info["device"], "cpu")
        self.assertTrue(self.info["versions"]["torch"])

    def test_real_inference_on_the_demo_sentences(self):
        import server
        for case in server.DEMO_CASES:
            keep, prob = self.det.score(case["text"])
            self.assertTrue(keep, case["id"])
            self.assertGreaterEqual(prob, detectors.DEFAULT_THRESHOLD)

    def test_demo_verdicts_match_the_rule_detector(self):
        """The detector only selects sentences; the evidence engine must reach the same verdicts."""
        import server
        rules, model = GreenTruth(detector_preference="rule_based"), GreenTruth(detector_preference="climatebert")
        demo_report = (server.DEMO_TEXT, "Bakken")
        for text, field in [(c["text"], c["field"]) for c in server.DEMO_CASES] + [demo_report]:
            a, b = rules.analyze(text, field), model.analyze(text, field)
            self.assertEqual(b["detector"]["detector"], "climatebert")
            self.assertEqual([c["text"] for c in a["claims"]], [c["text"] for c in b["claims"]], field)
            self.assertEqual([c["verdict"] for c in a["claims"]], [c["verdict"] for c in b["claims"]], field)
            self.assertEqual([c.get("analysis") for c in a["claims"]], [c.get("analysis") for c in b["claims"]], field)


if __name__ == "__main__":
    unittest.main()
