"""
Claim detection: which sentences in a report are environmental claims.

    ClaimDetector
    |- ClimateBERTDetector   fine-tuned transformer, loaded from the Hugging Face Hub
    \- RuleBasedDetector     vocabulary + achievement verbs, always available

The transformer is preferred when it can actually be loaded. It cannot be loaded
in a standard-library-only deployment, which is the deployment this project
promises, so the rule detector is a permanent first-class fallback rather than a
placeholder.

The rule that matters
---------------------
Whichever detector ran, the result says so:

    {"detector": "climatebert", "fallback": false}
    {"detector": "rule_based",  "fallback": true, "reason": "transformers not installed"}

The interface reads that field. Nothing anywhere claims a model inference that
did not happen — including in the failure path, where it would be easiest and
most tempting to stay quiet.

Enabling the model
------------------
    pip install "transformers>=4.45" torch
    export GREENTRUTH_DETECTOR=climatebert     # or leave unset for "auto"

`auto` (the default) tries the model once and falls back silently-but-reported.
`rule_based` forces the rules. `climatebert` forces the model and surfaces the
load error instead of falling back, which is what you want in a test.
"""

import os
import re

from . import metrics as metrics_mod

# The published model. Configurable so a fine-tuned replacement can be swapped in
# without editing code:
#
#     export GREENTRUTH_CLAIM_MODEL=Rahilgh/greentruth-claim-detector
#
# The model is PUBLIC, so ordinary inference needs no Hugging Face token. HF_TOKEN
# is only ever required to *publish*, and is read from the environment when it is.
DEFAULT_MODEL_ID = "Rahilgh/greentruth-claim-detector"
HF_MODEL_ID = os.environ.get("GREENTRUTH_CLAIM_MODEL") or DEFAULT_MODEL_ID

# Detection threshold for the transformer's positive class.
#
# Notebook 02 measured a sweep: 0.25 scored macro-F1 0.9020 against 0.8813 at 0.5.
# That better threshold is deliberately NOT shipped, because it was selected on the
# TEST split and using it would be tuning on the data the metric is reported from.
# Re-deriving it on a validation split is an open item (docs/LIMITATIONS.md, §9).
# Until then this stays at the trained head's default.
DEFAULT_THRESHOLD = 0.5


class ClaimDetector:
    """Interface: given a sentence, is it an environmental claim?"""

    name = "base"
    is_fallback = False

    def score(self, sentence):
        """-> (is_claim: bool, score: float|None)"""
        raise NotImplementedError

    def info(self):
        return dict(detector=self.name, fallback=self.is_fallback)


# --------------------------------------------------------------------------
# Rule-based
# --------------------------------------------------------------------------

_ACHIEVEMENT = re.compile(
    r"\b(?:reduced|cut|cuts|eliminated|halved|lowered|decreased|achieved|"
    r"delivered|phased\s+out|slashed|brought\s+down|increased|grew|rose|raised)\b",
    re.I,
)
_COMMITMENT = re.compile(
    r"\b(?:will|shall|aims?\s+to|plans?\s+to|intends?\s+to|targets?\s+to|"
    r"commits?\s+to|committed\s+to|pledges?\s+to|by\s+20\d\d)\b",
    re.I,
)
_NUMBER = re.compile(r"\d")


class RuleBasedDetector(ClaimDetector):
    """
    Transparent baseline: a sentence is a claim if it names a known metric AND
    carries either a number or an achievement/commitment verb.

    Favours precision over recall by design — rhetorical framing ("reducing
    flaring is central to our roadmap") is deliberately excluded, because a false
    positive here becomes a verdict about something nobody claimed.
    """

    name = "rule_based"
    is_fallback = True

    def __init__(self, reason=None):
        self.reason = reason

    def score(self, sentence):
        if metrics_mod.primary_metric(sentence) is None:
            return False, None
        has_signal = bool(
            _NUMBER.search(sentence)
            or _ACHIEVEMENT.search(sentence)
            or _COMMITMENT.search(sentence)
        )
        return has_signal, None

    def info(self):
        d = super().info()
        if self.reason:
            d["reason"] = self.reason
        return d


# --------------------------------------------------------------------------
# ClimateBERT
# --------------------------------------------------------------------------

class ClimateBERTDetector(ClaimDetector):
    """
    The fine-tuned model published at `Rahilgh/greentruth-claim-detector`.

    Loading is attempted once and never retried per-sentence, so a missing
    dependency costs one import error rather than one per call.
    """

    name = "climatebert"
    is_fallback = False

    def __init__(self, model_id=None, threshold=DEFAULT_THRESHOLD):
        # Resolved at construction, so changing the env var takes effect without
        # a reimport.
        self.model_id = (model_id or os.environ.get("GREENTRUTH_CLAIM_MODEL")
                         or DEFAULT_MODEL_ID)
        self.threshold = threshold
        self._tok = None
        self._model = None
        self._torch = None
        self._positive_index = 1
        self._positive_label = None
        self.load_error = None
        self._load()

    def _load(self):
        # transformers probes for TensorFlow and JAX at import time, which drags
        # in keras -> pandas -> pyarrow. On an environment where those C
        # extensions were built against a different NumPy, that probe raises and
        # the model becomes unloadable for a reason that has nothing to do with
        # the model. Torch is all this detector needs, so the probe is disabled.
        os.environ.setdefault("USE_TF", "0")
        os.environ.setdefault("USE_JAX", "0")
        try:
            import torch
            from transformers import (AutoModelForSequenceClassification,
                                      AutoTokenizer)
        except Exception as e:
            raise RuntimeError(
                f"transformers/torch not importable ({type(e).__name__}: "
                f"{str(e)[:160]}). Install with: "
                "pip install \"transformers>=4.45\" torch"
            ) from e

        # Deliberately NOT transformers.pipelines: importing it pulls in sklearn
        # and scipy, which this detector does not need and which are a common
        # source of NumPy ABI failures. The tokenizer and the model are enough.
        try:
            self._torch = torch
            self._tok = AutoTokenizer.from_pretrained(self.model_id)
            self._model = AutoModelForSequenceClassification.from_pretrained(
                self.model_id).eval()
            id2label = getattr(self._model.config, "id2label", {}) or {}
            self._positive_index = 1
            for idx, lab in id2label.items():
                s = str(lab).lower()
                if "claim" in s and "not" not in s:
                    self._positive_index = int(idx)
                    self._positive_label = lab
            if self._positive_label is None:
                self._positive_label = id2label.get(1, "LABEL_1")
        except Exception as e:
            raise RuntimeError(
                f"could not load '{self.model_id}': {type(e).__name__}: "
                f"{str(e)[:200]}"
            ) from e

    def score(self, sentence):
        torch = self._torch
        with torch.no_grad():
            enc = self._tok(sentence, truncation=True, max_length=256,
                            return_tensors="pt")
            logits = self._model(**enc).logits
            prob = float(torch.softmax(logits, dim=-1)[0, self._positive_index])
        return prob >= self.threshold, prob

    def info(self):
        d = super().info()
        d.update(model_id=self.model_id, threshold=self.threshold,
                 source="huggingface hub",
                 model_url=f"https://huggingface.co/{self.model_id}",
                 requires_token=False)
        return d


# --------------------------------------------------------------------------
# Selection
# --------------------------------------------------------------------------

_CACHE = {}


def get_detector(prefer=None, use_cache=True):
    """
    Return (detector, info).

    prefer: "auto" (default), "climatebert", or "rule_based".
    Reads GREENTRUTH_DETECTOR when `prefer` is None.

    In "auto" mode a failed model load is reported in `info["reason"]`, never
    hidden. In "climatebert" mode the failure is raised, so a test that means to
    exercise the model cannot silently pass on the fallback.
    """
    prefer = (prefer or os.environ.get("GREENTRUTH_DETECTOR") or "auto").lower()

    if use_cache and prefer in _CACHE:
        det = _CACHE[prefer]
        return det, det.info()

    if prefer == "rule_based":
        det = RuleBasedDetector()
    elif prefer == "climatebert":
        det = ClimateBERTDetector()          # raises on failure, by design
    else:
        try:
            det = ClimateBERTDetector()
        except Exception as e:
            det = RuleBasedDetector(reason=str(e))

    if use_cache:
        _CACHE[prefer] = det
    return det, det.info()


def reset_cache():
    """Drop cached detectors (used by tests that switch detectors)."""
    _CACHE.clear()
