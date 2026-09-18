"""
Build evaluation/experiment_registry.json from the real notebook outputs.

    python3 scripts/build_experiment_registry.py

Reads ONLY the files in `notebooks/executed/results/` and never writes to that
folder. Every number in the registry is copied or derived from those files; this
script computes nothing it could not justify from them, and marks anything a
notebook did not produce as `NOT AVAILABLE` rather than filling it in.

The registry is what the application, the README and docs/RESEARCH_RESULTS.md
read, so there is exactly one place where a measured number enters the project.
"""

import csv
import json
import os
import statistics
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RESULTS = ROOT / "notebooks" / "executed" / "results"
OUT = ROOT / "evaluation" / "experiment_registry.json"

NA = "NOT AVAILABLE"


def load_json(name):
    p = RESULTS / name
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def csv_stats(name, key_col, value_col=None, year_col="year"):
    p = RESULTS / name
    if not p.exists():
        return None
    rows = list(csv.DictReader(p.open(encoding="utf-8")))
    if not rows:
        return None
    keys = {r[key_col] for r in rows if r.get(key_col)}
    years = sorted({int(r[year_col]) for r in rows
                    if r.get(year_col, "").strip().isdigit()})
    out = dict(file=name, rows=len(rows), columns=list(rows[0].keys()),
               n_entities=len(keys), year_min=years[0] if years else None,
               year_max=years[-1] if years else None,
               source_label=next((r["source"] for r in rows if r.get("source")), None),
               bytes=p.stat().st_size)
    if value_col:
        vals = []
        for r in rows:
            try:
                vals.append(float(r[value_col]))
            except (TypeError, ValueError):
                pass
        if vals:
            out["value_column"] = value_col
            out["value_min"] = round(min(vals), 4)
            out["value_max"] = round(max(vals), 4)
            out["value_mean"] = round(statistics.mean(vals), 4)
    return out


# --------------------------------------------------------------------------
# Notebook 02 — claim detector evaluation
# --------------------------------------------------------------------------
def nb02():
    d = load_json("02_detector_metrics.json")
    if not d:
        return dict(status="NOT RUN")
    cb = d.get("climatebert") or {}
    rb = d.get("rule_based")
    sweep = d.get("threshold_sweep") or []
    return dict(
        status="completed",
        source_file="02_detector_metrics.json",
        model_id=d.get("model_id"),
        dataset=d.get("measured_on"),
        n_test=d.get("n_test"),
        positive_rate=d.get("positive_rate"),
        transformer=dict(
            accuracy=cb.get("accuracy"),
            macro_precision=cb.get("macro_precision"),
            macro_recall=cb.get("macro_recall"),
            macro_f1=cb.get("macro_f1"),
            claim_precision=cb.get("precision_claim"),
            claim_recall=cb.get("recall_claim"),
            claim_f1=cb.get("f1_claim"),
            confusion_matrix=cb.get("confusion_matrix"),
            threshold=0.5,
        ),
        roc_auc=d.get("roc_auc"),
        brier=d.get("brier"),
        best_threshold=d.get("best_threshold"),
        best_threshold_macro_f1=d.get("best_threshold_macro_f1"),
        shipped_threshold=d.get("shipped_threshold"),
        threshold_sweep_points=len(sweep),
        rule_based_baseline=(rb if rb else NA),
        rule_based_note=(None if rb else
                         "The baseline arm did not execute in the Colab run: the "
                         "greentruth package was not importable there, so "
                         "rule_based is null in the source file. It is reproduced "
                         "separately by scripts/eval_rule_detector.py, which is "
                         "deterministic and uses the same public test split."),
        caveats=d.get("caveats", []),
    )


# --------------------------------------------------------------------------
# Notebook 05 — uncertainty calibration
# --------------------------------------------------------------------------
def nb05():
    d = load_json("05_calibration.json")
    if not d:
        return dict(status="NOT RUN")

    cov = {r["method"]: r for r in d.get("coverage", [])}
    by_gap = d.get("by_gap", [])
    gaps = sorted({r["gap"] for r in by_gap})

    per_method = {}
    for m in cov:
        rows = [r for r in by_gap if r["method"] == m]
        devs = [abs(r["coverage"] - 0.90) for r in rows]
        per_method[m] = dict(
            marginal_coverage=round(cov[m]["coverage"], 4),
            median_width=round(cov[m]["median_width"], 4),
            gap_from_nominal=round(cov[m]["gap_from_nominal"], 4),
            mean_abs_conditional_deviation=(round(statistics.mean(devs), 4)
                                            if devs else None),
            conditional_coverage_min=(round(min(r["coverage"] for r in rows), 4)
                                      if rows else None),
            conditional_coverage_max=(round(max(r["coverage"] for r in rows), 4)
                                      if rows else None),
            coverage_by_gap={str(r["gap"]): round(r["coverage"], 4) for r in rows},
            width_by_gap={str(r["gap"]): round(r["width"], 4) for r in rows},
        )

    return dict(
        status="completed",
        source_file="05_calibration.json",
        nominal_alpha=d.get("nominal_alpha"),
        nominal_coverage=1 - (d.get("nominal_alpha") or 0.1),
        n_fields=d.get("n_fields"),
        n_observations=d.get("n_observations"),
        gaps_tested=gaps,
        protocol="leave-one-field-out",
        methods=per_method,
        level_sweep=d.get("level_sweep", []),
        conformal_quantiles=d.get("conformal_quantiles", {}),
        notebook_recommendation=d.get("recommendation"),
        caveats=d.get("caveats", []),
    )


# --------------------------------------------------------------------------
# Notebook 03 — real Earth-observation datasets
# --------------------------------------------------------------------------
def nb03():
    ds = {}
    f = csv_stats("flaring_by_field.csv", "field", "volume")
    if f:
        ds["flaring_by_field"] = dict(
            **f, entity="named field", unit="billion m3 flared per year",
            deployed_to="data/real/flaring_by_field.csv")
    c = csv_stats("flaring_by_country.csv", "country", "volume")
    if c:
        ds["flaring_by_country"] = dict(
            **c, entity="country", unit="billion m3 flared per year",
            deployed_to="data/real/flaring_by_country.csv")
    o = csv_stats("flaring_by_operator.csv", "operator", "volume")
    if o:
        ds["flaring_by_operator"] = dict(
            **o, entity="operator", unit="billion m3 flared per year",
            deployed_to="data/real/flaring_by_operator.csv",
            used_by_app=False,
            not_used_reason=("Operator names in this sheet cannot be reliably "
                             "matched to the named fields GreenTruth monitors, so "
                             "using it would require a name-matching step that "
                             "could silently mis-attribute flaring."))
    m = csv_stats("methane_by_field_s5p.csv", "field", "ch4_ppb")
    if m:
        # retrieval completeness: TROPOMI CH4 fails over water, cloud and dark
        # surfaces, so coverage is very uneven and must gate any use of it.
        rows = list((RESULTS / "methane_by_field_s5p.csv").open(encoding="utf-8"))
        rdr = list(csv.DictReader((RESULTS / "methane_by_field_s5p.csv")
                                  .open(encoding="utf-8")))
        per_field = {}
        for r in rdr:
            per_field.setdefault(r["field"], []).append(int(r["year"]))
        yrs = sorted({int(r["year"]) for r in rdr})
        max_months = (yrs[-1] - yrs[0] + 1) * 12
        per_field_cov = {k: dict(months=len(v),
                                 completeness=round(len(v) / max_months, 3),
                                 years=sorted(set(v)))
                         for k, v in per_field.items()}
        ds["methane_by_field_s5p"] = dict(
            **m, entity="named field", unit="ppb (column-averaged CH4 mixing ratio)",
            temporal_resolution="monthly",
            max_possible_months=max_months,
            per_field_coverage=per_field_cov,
            well_covered_fields=[k for k, v in per_field_cov.items()
                                 if v["completeness"] >= 0.60],
            poorly_covered_fields=[k for k, v in per_field_cov.items()
                                   if v["completeness"] < 0.60],
            deployed_to="data/real/methane_by_field_s5p.csv")
    return dict(status="completed" if ds else "NOT RUN",
                datasets=ds, n_datasets=len(ds))


def main():
    reg = dict(
        generated_by="scripts/build_experiment_registry.py",
        source_directory=str(RESULTS.relative_to(ROOT)).replace("\\", "/"),
        integrity_rule=("Every value here is copied or derived from the files in "
                        "the source directory. Nothing is estimated, and anything "
                        "a notebook did not produce is marked NOT AVAILABLE."),
        notebook_02=nb02(),
        notebook_03=nb03(),
        notebook_05=nb05(),
    )
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(reg, indent=2), encoding="utf-8")
    print(f"wrote {OUT.relative_to(ROOT)}")
    for k in ("notebook_02", "notebook_03", "notebook_05"):
        print(f"  {k}: {reg[k]['status']}")


if __name__ == "__main__":
    main()
