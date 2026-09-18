"""
Measured experimental results — the single door through which a number enters.

Every metric GreenTruth displays comes from here, and everything here is read
from files produced by notebook runs:

    evaluation/experiment_registry.json    built by scripts/build_experiment_registry.py
                                           from `notebooks/executed/results/`
    evaluation/rule_baseline_metrics.json  built by scripts/eval_rule_detector.py

Nothing in this module computes a metric. If a file is absent or a field is
missing, the accessor returns `None` and the interface shows "not measured"
rather than a plausible-looking substitute. That is the whole point: the project
spent a long time with a model card quoting someone else's F1, and this module
exists so that cannot happen again.
"""

import json
import os
from pathlib import Path

BASE = Path(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REGISTRY_FILE = BASE / "evaluation" / "experiment_registry.json"
RULE_FILE = BASE / "evaluation" / "rule_baseline_metrics.json"
ABLATION_FILE = BASE / "evaluation" / "ablation_results.json"
CASES_FILE = BASE / "evaluation" / "07_case_study.json"

NOT_MEASURED = "not measured"


def _load(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return None


class Measured:
    """Read-only view over the experiment outputs."""

    def __init__(self, registry_file=REGISTRY_FILE, rule_file=RULE_FILE,
                 ablation_file=ABLATION_FILE, cases_file=CASES_FILE):
        self.registry = _load(registry_file) or {}
        self.rule = _load(rule_file) or {}
        self.ablation = (_load(ablation_file) or {}).get("summary")
        self.cases = _load(cases_file)

    # -- availability ----------------------------------------------------

    @property
    def available(self):
        return bool(self.registry)

    def status(self):
        return {k: (self.registry.get(k) or {}).get("status", "NOT RUN")
                for k in ("notebook_02", "notebook_03", "notebook_05")}

    # -- notebook 02: claim detection ------------------------------------

    def detector_metrics(self):
        """
        Measured detector performance, both arms, or None.

        The transformer numbers come from the Colab run; the rule-based numbers
        are reproduced by scripts/eval_rule_detector.py because that arm returned
        null in the notebook. Both are on the same verified 265-row test split.
        """
        nb = self.registry.get("notebook_02") or {}
        if nb.get("status") != "completed":
            return None
        t = nb.get("transformer") or {}
        rb = (self.rule.get("metrics") or {}) if self.rule else {}
        out = dict(
            dataset=nb.get("dataset"),
            model_id=nb.get("model_id"),
            n_test=nb.get("n_test"),
            positive_rate=nb.get("positive_rate"),
            roc_auc=nb.get("roc_auc"),
            brier=nb.get("brier"),
            shipped_threshold=nb.get("shipped_threshold"),
            best_threshold=nb.get("best_threshold"),
            best_threshold_macro_f1=nb.get("best_threshold_macro_f1"),
            transformer=t or None,
            rule_based=rb or None,
        )
        if t and rb:
            out["macro_f1_gain"] = round(t["macro_f1"] - rb["macro_f1"], 4)
            out["claim_recall_gain"] = round(t["claim_recall"] - rb["recall_claim"], 4)
        return out

    def detector_headline(self):
        """One-line summary for the interface, or None if never measured."""
        m = self.detector_metrics()
        if not m or not m.get("transformer"):
            return None
        t = m["transformer"]
        return (f"macro-F1 {t['macro_f1']:.3f}, claim recall {t['claim_recall']:.3f} "
                f"(n={m['n_test']})")

    # -- notebook 05: uncertainty calibration ----------------------------

    SHIPPED_METHOD = "A. bootstrap (shipped)"

    def calibration(self):
        nb = self.registry.get("notebook_05") or {}
        return nb if nb.get("status") == "completed" else None

    def shipped_interval_calibration(self):
        """Measured behaviour of the interval `verdict.py` actually produces."""
        cal = self.calibration()
        if not cal:
            return None
        m = (cal.get("methods") or {}).get(self.SHIPPED_METHOD)
        if not m:
            return None
        return dict(
            method=self.SHIPPED_METHOD,
            nominal=cal.get("nominal_coverage"),
            marginal_coverage=m.get("marginal_coverage"),
            median_width=m.get("median_width"),
            mean_abs_conditional_deviation=m.get("mean_abs_conditional_deviation"),
            conditional_range=[m.get("conditional_coverage_min"),
                               m.get("conditional_coverage_max")],
            coverage_by_gap=m.get("coverage_by_gap") or {},
            n_fields=cal.get("n_fields"),
            n_observations=cal.get("n_observations"),
            protocol=cal.get("protocol"),
        )

    def coverage_for_gap(self, year_gap):
        """
        Measured empirical coverage of the shipped interval at a specific
        year-gap, or None if that gap was not tested.

        This is what lets a verdict say "at a 5-year gap this interval covered
        93.8% of the time in leave-one-field-out testing" instead of asserting a
        nominal 90% that was never checked at that horizon.
        """
        s = self.shipped_interval_calibration()
        if not s or year_gap is None:
            return None
        return s["coverage_by_gap"].get(str(int(year_gap)))

    def calibration_comparison(self):
        """All three methods side by side, for the research page."""
        cal = self.calibration()
        if not cal:
            return None
        rows = []
        for name, m in (cal.get("methods") or {}).items():
            rows.append(dict(
                method=name,
                marginal_coverage=m.get("marginal_coverage"),
                median_width=m.get("median_width"),
                mean_abs_conditional_deviation=m.get("mean_abs_conditional_deviation"),
                conditional_min=m.get("conditional_coverage_min"),
                conditional_max=m.get("conditional_coverage_max"),
                is_shipped=(name == self.SHIPPED_METHOD)))
        return sorted(rows, key=lambda r: r["method"])

    # -- notebook 03: datasets -------------------------------------------

    def datasets(self):
        nb = self.registry.get("notebook_03") or {}
        return (nb.get("datasets") or {}) if nb.get("status") == "completed" else {}

    def methane_coverage(self, field_id=None):
        d = self.datasets().get("methane_by_field_s5p")
        if not d:
            return None
        if field_id is None:
            return d
        return (d.get("per_field_coverage") or {}).get(field_id)

    # -- for the API -----------------------------------------------------

    def summary(self):
        """Everything the research page needs, in one payload."""
        det = self.detector_metrics()
        cal = self.shipped_interval_calibration()
        return dict(
            available=self.available,
            status=self.status(),
            detector=det,
            interval=cal,
            calibration_methods=self.calibration_comparison(),
            datasets={k: {kk: vv for kk, vv in v.items()
                          if kk not in ("per_field_coverage",)}
                      for k, v in self.datasets().items()},
            ablation=self.ablation,
            case_studies=self.cases,
            provenance=dict(
                registry=str(REGISTRY_FILE.name),
                built_from=self.registry.get("source_directory"),
                integrity_rule=self.registry.get("integrity_rule"),
            ),
        )


MEASURED = Measured()
