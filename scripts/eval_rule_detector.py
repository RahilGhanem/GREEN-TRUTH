"""
Reproduce the rule-based baseline arm that notebook 02 could not run.

    python3 scripts/eval_rule_detector.py

Why this exists
---------------
Notebook 02 ran in Colab and measured the transformer, but its `rule_based` field
came back `null`: the `greentruth` package was not importable in that runtime, so
the baseline arm was skipped. That leaves the project's most important comparison
unanswered — the rule detector is what ships by default, so "how much does the
transformer actually buy?" is the question that matters.

This script answers it without re-running the notebook and without touching the
results folder:

  * it fetches the SAME public test split (265 rows) through the Hugging Face
    datasets-server HTTP API, which needs no `datasets` package and no token;
  * it runs `greentruth.detectors.RuleBasedDetector` — the exact class the
    application uses, not a re-implementation;
  * the rule detector is deterministic, so this is reproducible exactly.

The split identity is verified against notebook 02's own `n_test` before any
number is reported, so the two arms cannot silently be measured on different data.

Output: evaluation/rule_baseline_metrics.json
"""

import json
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from greentruth.detectors import RuleBasedDetector          # noqa: E402

DATASET = "climatebert/environmental_claims"
SPLIT = "test"
API = "https://datasets-server.huggingface.co/rows"
REGISTRY = ROOT / "evaluation" / "experiment_registry.json"
OUT = ROOT / "evaluation" / "rule_baseline_metrics.json"


def fetch_split(batch=100):
    rows, offset, total = [], 0, None
    while total is None or offset < total:
        q = urllib.parse.urlencode(dict(dataset=DATASET, config="default",
                                        split=SPLIT, offset=offset, length=batch))
        with urllib.request.urlopen(f"{API}?{q}", timeout=60) as r:
            d = json.loads(r.read())
        if "error" in d:
            raise RuntimeError(f"datasets-server: {d['error']}")
        total = d["num_rows_total"]
        rows += [(x["row"]["text"], int(x["row"]["label"])) for x in d["rows"]]
        offset += batch
        print(f"  fetched {len(rows)}/{total}")
    return rows


def metrics(y_true, y_pred):
    tp = sum(1 for t, p in zip(y_true, y_pred) if t == 1 and p == 1)
    tn = sum(1 for t, p in zip(y_true, y_pred) if t == 0 and p == 0)
    fp = sum(1 for t, p in zip(y_true, y_pred) if t == 0 and p == 1)
    fn = sum(1 for t, p in zip(y_true, y_pred) if t == 1 and p == 0)

    def prf(tp_, fp_, fn_):
        p = tp_ / (tp_ + fp_) if (tp_ + fp_) else 0.0
        r = tp_ / (tp_ + fn_) if (tp_ + fn_) else 0.0
        f = 2 * p * r / (p + r) if (p + r) else 0.0
        return p, r, f

    p1, r1, f1 = prf(tp, fp, fn)          # claim class
    p0, r0, f0 = prf(tn, fn, fp)          # not-claim class
    n = len(y_true)
    return dict(
        model="rule_based (shipped fallback)",
        accuracy=(tp + tn) / n,
        precision_claim=p1, recall_claim=r1, f1_claim=f1,
        precision_not_claim=p0, recall_not_claim=r0, f1_not_claim=f0,
        macro_precision=(p0 + p1) / 2, macro_recall=(r0 + r1) / 2,
        macro_f1=(f0 + f1) / 2,
        confusion_matrix=[[tn, fp], [fn, tp]],
        n=n)


def main():
    expected_n = None
    if REGISTRY.exists():
        reg = json.loads(REGISTRY.read_text(encoding="utf-8"))
        expected_n = reg.get("notebook_02", {}).get("n_test")

    print(f"fetching {DATASET} [{SPLIT}] via the datasets-server HTTP API…")
    rows = fetch_split()
    texts = [t for t, _ in rows]
    y_true = [l for _, l in rows]

    if expected_n is not None and len(rows) != expected_n:
        raise SystemExit(
            f"REFUSING TO REPORT: fetched {len(rows)} rows but notebook 02 measured "
            f"the transformer on {expected_n}. The two arms would not be comparable.")
    print(f"split verified: {len(rows)} rows, matches notebook 02's n_test\n")

    det = RuleBasedDetector()
    y_pred = [int(det.score(t)[0]) for t in texts]
    m = metrics(y_true, y_pred)

    out = dict(
        generated_by="scripts/eval_rule_detector.py",
        why=("Reproduces the baseline arm that notebook 02 left null because the "
             "greentruth package was not importable in its Colab runtime."),
        dataset=DATASET, split=SPLIT, n=len(rows),
        split_source="Hugging Face datasets-server HTTP API (no token required)",
        split_verified_against="notebook_02.n_test",
        detector_class="greentruth.detectors.RuleBasedDetector",
        deterministic=True,
        metrics=m,
        caveats=[
            "The rule detector was written for precision on flaring-style corporate "
            "text; this dataset spans the full breadth of environmental claims, so "
            "this is an out-of-design-scope evaluation and recall is expected to be "
            "low.",
            "Computed locally rather than in the notebook run. It is deterministic "
            "and uses the same verified split, so it is reproducible exactly.",
        ])
    OUT.write_text(json.dumps(out, indent=2), encoding="utf-8")

    print("=" * 62)
    print("RULE-BASED BASELINE — measured")
    print("=" * 62)
    for k in ("accuracy", "macro_precision", "macro_recall", "macro_f1",
              "precision_claim", "recall_claim", "f1_claim"):
        print(f"  {k:20s} {m[k]:.4f}")
    print(f"  confusion [[tn,fp],[fn,tp]] = {m['confusion_matrix']}")
    print(f"\nwrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
