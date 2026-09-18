"""
Ablation study over GreenTruth's evidence stack.

    python3 scripts/run_ablation.py

What this measures, and what it does NOT
-----------------------------------------
There is no adjudicated corpus of true/false flaring claims, so **this is not an
accuracy ablation and no configuration below reports accuracy.** Fabricating
ground truth to produce one would make every number meaningless.

What can be measured honestly is how each layer of the stack changes the system's
*behaviour*: how often it can find compatible evidence, how wide its uncertainty
is, how often it declines to answer, and — the number that matters most — how
many confident-looking verdicts the uncertainty layer prevents.

Probe claims
------------
Claims are constructed from real observed windows: for a field whose flaring
actually changed by X% between two years, the probe claim asserts a round figure
near X%. These are **probe claims, not corporate claims** — nobody published
them. They exist to exercise the pipeline uniformly across all 12 fields, and
they are labelled as probes everywhere they surface. Every observation they are
checked against is real.

Configurations
--------------
    A  text only ........................ claim parsed into a structured record
    B  + geography ...................... facility resolved to real coordinates
    C  + Earth observation .............. flaring series retrieved
    D  + temporal ....................... change measured across the window
    E  + uncertainty .................... interval computed, abstention enabled
    F  full ............................. + methane, cross-scale, sufficiency

Output: evaluation/ablation_results.json
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from greentruth import GreenTruth                                   # noqa: E402
from greentruth import conflict as conflict_mod                     # noqa: E402
from greentruth import sufficiency as suff_mod                      # noqa: E402
from greentruth.decompose import build_claims                       # noqa: E402
from greentruth.schema import (                                     # noqa: E402
    ABSTAIN, ABSTENTION_VERDICTS, CONTRADICTED, PARTIALLY_SUPPORTED, SUPPORTED)
from greentruth.verdict import bootstrap_change                     # noqa: E402

OUT = ROOT / "evaluation" / "ablation_results.json"
MIN_WINDOW = 3          # probe windows of at least 3 years


def build_probes(gt):
    """One probe claim per (field, window) with a real, non-trivial change."""
    probes = []
    for fid, info in gt.evidence.fields.items():
        s = gt.evidence.series_for(fid)
        if not s:
            continue
        years = sorted(s)
        for b in years:
            for e in years:
                if e - b < MIN_WINDOW or not s[b]:
                    continue
                obs = (s[e] - s[b]) / s[b]
                pct = round(abs(obs) * 100)
                if pct < 5 or pct > 90:
                    continue
                direction = "reduced" if obs < 0 else "increased"
                claimed = max(5, int(round(pct / 5.0) * 5))   # a round figure near it
                probes.append(dict(
                    field_id=fid, field=info["name"], baseline=b, comparison=e,
                    observed_change=obs, claimed_pct=claimed,
                    text=(f"We {direction} routine gas flaring by {claimed}% "
                          f"by {e} from {b} levels."),
                    is_probe=True))
    return probes


def run():
    gt = GreenTruth(detector_preference="rule_based")
    probes = build_probes(gt)
    print(f"{len(probes)} probe claims across {len({p['field_id'] for p in probes})} "
          f"real fields\n")

    rows = []
    for i, p in enumerate(probes, 1):
        if i % 100 == 0:
            print(f"  {i}/{len(probes)}")
        rec = dict(p)

        # ---- A: text only -------------------------------------------------
        claims = build_claims(p["text"], detector="rule_based")
        rec["A_parsed"] = bool(claims)
        if not claims:
            rows.append(rec)
            continue
        c = claims[0]
        rec["A_has_metric"] = c.metric is not None
        rec["A_slot_coverage"] = c.extract_confidence
        rec["A_fully_specified"] = not c.missing_slots

        # ---- B: + geography ----------------------------------------------
        fi = gt.evidence.field_info(p["field_id"])
        rec["B_facility_resolved"] = fi is not None
        rec["B_has_coordinates"] = bool(fi and fi.get("lat") is not None)

        # ---- C: + Earth observation ---------------------------------------
        series = gt.evidence.series_for(p["field_id"])
        rec["C_evidence_available"] = bool(series)
        rec["C_n_observations"] = len(series)

        # ---- D: + temporal -------------------------------------------------
        b, e = p["baseline"], p["comparison"]
        has_window = b in series and e in series and bool(series[b])
        rec["D_window_covered"] = has_window
        if has_window:
            rec["D_observed_change"] = (series[e] - series[b]) / series[b]
            # Verdict a system WITHOUT uncertainty would issue: the point estimate
            # compared to the claim, with no interval to stop it.
            claimed = -p["claimed_pct"] / 100.0 if "reduced" in p["text"] \
                else p["claimed_pct"] / 100.0
            oc = rec["D_observed_change"]
            met = (oc <= claimed) if claimed < 0 else (oc >= claimed)
            rec["D_point_verdict"] = SUPPORTED if met else PARTIALLY_SUPPORTED
            rec["D_issues_verdict"] = True
        else:
            rec["D_issues_verdict"] = False

        # ---- E: + uncertainty ----------------------------------------------
        if has_window:
            ys = sorted(series)
            vals = [series[y] for y in ys]
            lo, hi = bootstrap_change(ys, vals, ys.index(b), ys.index(e))
            if lo is not None:
                rec["E_interval"] = [lo, hi]
                rec["E_width"] = hi - lo

        # ---- F: the full stack, through the real pipeline -------------------
        res = gt.analyze(p["text"], p["field"])
        if res["claims"]:
            fc = res["claims"][0]
            rec["F_verdict"] = fc["verdict"]
            rec["F_abstained"] = fc["is_abstention"]
            s = fc["sufficiency"]
            rec["F_sufficiency_level"] = s["level"]
            rec["F_n_structural_limits"] = len(s.get("structural_limitations", []))
            sy = fc.get("synthesis") or {}
            rec["F_synthesis_state"] = sy.get("state")
            rec["F_n_sources"] = sy.get("n_sources", 0)
            rec["F_has_independent"] = sy.get("has_independent_instrument", False)
            ch4 = fc.get("methane") or {}
            rec["F_methane_available"] = bool(ch4.get("available"))
            ic = fc.get("interval_calibration") or {}
            rec["F_measured_coverage"] = ic.get("measured_coverage_at_this_gap")
        rows.append(rec)

    return summarise(rows), rows


def pct(n, d):
    return round(n / d, 4) if d else None


def summarise(rows):
    n = len(rows)
    parsed = [r for r in rows if r.get("A_parsed")]
    windowed = [r for r in rows if r.get("D_window_covered")]
    withE = [r for r in rows if r.get("E_width") is not None]
    withF = [r for r in rows if r.get("F_verdict")]

    abstained = [r for r in withF if r.get("F_abstained")]
    # The headline: verdicts the point estimate would have issued, that the
    # uncertainty layer stopped.
    prevented = [r for r in withF
                 if r.get("D_issues_verdict") and r.get("F_verdict") == ABSTAIN]

    configs = {
        "A_text_only": dict(
            name="A — text only",
            adds="claim parsed into a structured record",
            claims_parsed=pct(len(parsed), n),
            fully_specified=pct(sum(1 for r in parsed if r.get("A_fully_specified")),
                                len(parsed)),
            mean_slot_coverage=round(
                sum(r.get("A_slot_coverage", 0) for r in parsed) / max(len(parsed), 1), 4),
            can_assess_against_evidence=0.0,
            note="No evidence is consulted, so nothing can be assessed physically."),
        "B_plus_geography": dict(
            name="B — + geographic context",
            adds="facility resolved to real coordinates",
            facility_resolved=pct(sum(1 for r in parsed if r.get("B_facility_resolved")),
                                  len(parsed)),
            has_coordinates=pct(sum(1 for r in parsed if r.get("B_has_coordinates")),
                                len(parsed)),
            can_assess_against_evidence=0.0,
            note="A location is now known, but no observation has been retrieved."),
        "C_plus_earth_observation": dict(
            name="C — + Earth observation",
            adds="real flaring series retrieved",
            evidence_available=pct(sum(1 for r in parsed if r.get("C_evidence_available")),
                                   len(parsed)),
            mean_observations_per_field=round(
                sum(r.get("C_n_observations", 0) for r in parsed) / max(len(parsed), 1), 1),
            can_assess_against_evidence=pct(
                sum(1 for r in parsed if r.get("C_evidence_available")), len(parsed)),
            note="Evidence exists, but nothing has been compared over time yet."),
        "D_plus_temporal": dict(
            name="D — + temporal analysis",
            adds="change measured across the claim window",
            window_covered=pct(len(windowed), len(parsed)),
            issues_a_verdict=pct(len(windowed), len(parsed)),
            abstention_rate=0.0,
            note=("A verdict is issued from the point estimate alone. Nothing here "
                  "can decline to answer — which is the gap E closes.")),
        "E_plus_uncertainty": dict(
            name="E — + uncertainty",
            adds="bootstrap interval; abstention becomes possible",
            interval_computed=pct(len(withE), len(windowed)),
            mean_interval_width=round(
                sum(r["E_width"] for r in withE) / max(len(withE), 1), 4),
            median_interval_width=round(
                sorted(r["E_width"] for r in withE)[len(withE) // 2], 4) if withE else None,
            abstention_rate=pct(len(abstained), len(withF)),
            unsupported_verdicts_prevented=len(prevented),
            unsupported_verdict_prevention_rate=pct(len(prevented), len(windowed)),
            note=("The headline of this ablation: without the interval, every one of "
                  "these would have been answered from the point estimate.")),
        "F_full_system": dict(
            name="F — full system",
            adds="methane, cross-scale, sufficiency, conflict, evidence ceiling",
            mean_sources_consulted=round(
                sum(r.get("F_n_sources", 0) for r in withF) / max(len(withF), 1), 2),
            independent_instrument_rate=pct(
                sum(1 for r in withF if r.get("F_has_independent")), len(withF)),
            methane_available_rate=pct(
                sum(1 for r in withF if r.get("F_methane_available")), len(withF)),
            sufficiency_levels={
                lvl: pct(sum(1 for r in withF if r.get("F_sufficiency_level") == lvl),
                         len(withF))
                for lvl in (suff_mod.SUFFICIENT, suff_mod.PARTIALLY_SUFFICIENT,
                            suff_mod.INSUFFICIENT)},
            fully_sufficient_rate=pct(
                sum(1 for r in withF
                    if r.get("F_sufficiency_level") == suff_mod.SUFFICIENT), len(withF)),
            synthesis_states={
                st: pct(sum(1 for r in withF if r.get("F_synthesis_state") == st),
                        len(withF))
                for st in (conflict_mod.AGREEMENT, conflict_mod.PARTIAL,
                           conflict_mod.CROSS_SCALE_DIVERGENCE,
                           conflict_mod.CROSS_SENSOR_TENSION,
                           conflict_mod.MULTIPLE_TENSIONS,
                           conflict_mod.SINGLE_SOURCE)},
            cross_source_disagreement_rate=pct(
                sum(1 for r in withF if r.get("F_synthesis_state") in (
                    conflict_mod.CROSS_SCALE_DIVERGENCE,
                    conflict_mod.CROSS_SENSOR_TENSION,
                    conflict_mod.MULTIPLE_TENSIONS)), len(withF)),
            abstention_rate=pct(len(abstained), len(withF)),
            note=("Disagreement between sources is surfaced rather than averaged "
                  "away. No configuration here reports accuracy.")),
    }

    verdicts = {}
    for r in withF:
        verdicts[r["F_verdict"]] = verdicts.get(r["F_verdict"], 0) + 1

    # Abstention is not uniform: a 3-year window on a noisy annual series is
    # mostly noise, while a decade of change is not. Breaking the rate down by
    # window length turns "the system abstains a lot" into something actionable.
    by_window = {}
    for r in withF:
        w = r["comparison"] - r["baseline"]
        b = by_window.setdefault(w, dict(n=0, abstained=0, widths=[]))
        b["n"] += 1
        b["abstained"] += 1 if r.get("F_abstained") else 0
        if r.get("E_width") is not None:
            b["widths"].append(r["E_width"])
    window_table = {}
    for w in sorted(by_window):
        b = by_window[w]
        ws = sorted(b["widths"])
        window_table[str(w)] = dict(
            n=b["n"],
            abstention_rate=pct(b["abstained"], b["n"]),
            median_interval_width=round(ws[len(ws) // 2], 4) if ws else None)

    return dict(
        n_probe_claims=n,
        n_fields=len({r["field_id"] for r in rows}),
        configurations=configs,
        verdict_distribution=verdicts,
        abstention_by_window_length=window_table,
        headline=dict(
            unsupported_verdicts_prevented=len(prevented),
            of_verdicts_a_point_estimate_would_issue=len(windowed),
            prevention_rate=pct(len(prevented), len(windowed)),
            abstention_rate=pct(len(abstained), len(withF)),
            cross_source_disagreement_rate=pct(
                sum(1 for r in withF if r.get("F_synthesis_state") in (
                    conflict_mod.CROSS_SCALE_DIVERGENCE,
                    conflict_mod.CROSS_SENSOR_TENSION,
                    conflict_mod.MULTIPLE_TENSIONS)), len(withF))),
        integrity=dict(
            ground_truth_available=False,
            accuracy_reported=False,
            why=("No adjudicated corpus of true/false flaring claims exists. This "
                 "ablation measures system behaviour — evidence availability, "
                 "uncertainty width, abstention, cross-source agreement — and "
                 "deliberately reports no accuracy metric."),
            probe_claims=("Claims are constructed from real observed windows to "
                          "exercise the pipeline uniformly. They are probes, not "
                          "corporate claims. All observations are real.")),
    )


def main():
    summary, rows = run()
    OUT.write_text(json.dumps(dict(summary=summary, n_rows=len(rows)), indent=2),
                   encoding="utf-8")

    print("\n" + "=" * 74)
    print("ABLATION — measured system properties (NOT accuracy)")
    print("=" * 74)
    print(f"{summary['n_probe_claims']} probe claims across {summary['n_fields']} real fields\n")
    for key, c in summary["configurations"].items():
        print(f"{c['name']}")
        print(f"   adds: {c['adds']}")
        for k, v in c.items():
            if k in ("name", "adds", "note"):
                continue
            print(f"   {k:38s} {v}")
        print(f"   note: {c['note']}")
        print()
    h = summary["headline"]
    print("=" * 74)
    print("HEADLINE")
    print("=" * 74)
    print(f"  Verdicts a point estimate would have issued : "
          f"{h['of_verdicts_a_point_estimate_would_issue']}")
    print(f"  Prevented by the uncertainty layer          : "
          f"{h['unsupported_verdicts_prevented']} "
          f"({h['prevention_rate']:.1%})" if h["prevention_rate"] is not None else "")
    print(f"  Overall abstention rate                     : {h['abstention_rate']}")
    print(f"  Cross-source disagreement rate              : "
          f"{h['cross_source_disagreement_rate']}")
    print(f"\nverdicts: {summary['verdict_distribution']}")
    print(f"\nwrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
