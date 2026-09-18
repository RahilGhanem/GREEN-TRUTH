"""
Turn a structured claim plus a field's REAL annual flaring series into a verdict.

What changed from the first version, and why
--------------------------------------------
The original engine compared a point estimate to the claim and used the
bootstrap interval only to nudge a heuristic "confidence". That let it return
`supported` from an interval running from -70% to +90% — an interval that cannot
tell a large reduction from a near-doubling. The number looked decisive because
the point estimate was; the evidence was not.

Here the interval decides. The change axis is divided into four decision regions,
and the verdict depends on how many regions the interval touches:

    region 0  meets or beats the claimed reduction
    region 1  fell, but by less than claimed
    region 2  flat (within the noise band)
    region 3  rose

    interval inside one region      -> that verdict, stated plainly
    interval spans two neighbours   -> the point-estimate verdict, marked borderline
    interval spans three or more    -> ABSTAIN

Abstention is a first-class outcome, not a failure: "the observations cannot
distinguish these cases" is a true and useful statement, and it is the one the
old engine was unable to make.

On naming: there is no `confidence` field. The interval is a residual bootstrap
with no analytical coverage guarantee; its empirical coverage was measured
leave-one-field-out in notebooks/05_uncertainty_calibration.ipynb and is attached
to each verdict by pipeline.py. What is reported here is the interval itself and
`decision_margin` — the distance from the nearest decision boundary in interval
half-widths — explicitly labelled as a heuristic.

Known numerical property, deliberately left unchanged: each resample divides by
a resampled baseline (fitted value plus a residual). Where the residuals are
large relative to the fitted baseline, that denominator can approach zero and the
interval becomes extremely wide (for example Sirte Basin over 2012-2024). Such an
interval crosses from a fall to a rise, so it spans three or more decision regions
and the outcome is an abstention, not a verdict: across all 513 real probe windows
(3+ years, 5-90% change) 26 produce an interval wider than 300 points or reaching
below -100%, and all 26 abstain. Changing the estimator would invalidate the
coverage measured in notebook 05, so it is documented in docs/LIMITATIONS.md.
"""

import random

from . import metrics as metrics_mod
from . import trajectory as trajectory_mod
from .schema import (
    ABSTAIN,
    CLAIM_AMBIGUOUS,
    CLAIM_FUTURE_COMMITMENT,
    CONTRADICTED,
    INSUFFICIENT_EVIDENCE,
    NEEDS_CLARIFICATION,
    NO_SIGNAL,
    PARTIALLY_SUPPORTED,
    SUPPORTED,
    VERDICT_MEANINGS,
)

# A change smaller than this is treated as flat — below the level at which an
# annual VIIRS-derived volume difference is meaningful.
FLAT_BAND = 0.05
N_BOOT = 2000
SEED = 7
LEVEL = 0.90

REGION_LABELS = {
    0: "meets or beats the claimed reduction",
    1: "fell, but by less than claimed",
    2: "essentially flat",
    3: "rose",
}


def _ols(xs, ys):
    n = len(xs)
    xbar = sum(xs) / n
    ybar = sum(ys) / n
    sxx = sum((x - xbar) ** 2 for x in xs)
    if sxx == 0:
        return ybar, 0.0
    slope = sum((x - xbar) * (y - ybar) for x, y in zip(xs, ys)) / sxx
    return ybar - slope * xbar, slope


def bootstrap_change(years, values, idx_b, idx_t, n=N_BOOT, seed=SEED, level=LEVEL):
    """
    Interval on the fractional change between two years.

    Residual bootstrap around the fitted annual trend: the series is annual, so
    there is nothing to resample within a year. This is a description of the
    scatter around the trend, not a calibrated confidence interval, and it is
    labelled that way everywhere it surfaces.
    """
    b0, b1 = _ols(years, values)
    fitted = [b0 + b1 * y for y in years]
    resid = [v - f for v, f in zip(values, fitted)]
    rng = random.Random(seed)
    changes = []
    for _ in range(n):
        rb = rng.choice(resid)
        rt = rng.choice(resid)
        vb = fitted[idx_b] + rb
        vt = fitted[idx_t] + rt
        if abs(vb) > 1e-12:
            changes.append((vt - vb) / vb)
    if not changes:
        return None, None
    changes.sort()
    lo_q, hi_q = (1 - level) / 2, 1 - (1 - level) / 2
    return (changes[int(lo_q * (len(changes) - 1))],
            changes[int(hi_q * (len(changes) - 1))])


def _region(change, claimed):
    """Which decision region a fractional change falls in."""
    if claimed is not None and change <= claimed:
        return 0
    if change < -FLAT_BAND:
        return 1 if claimed is not None else 0
    if change <= FLAT_BAND:
        return 2
    return 3


def _pct(x):
    return f"{x * 100:.0f}%"


# --------------------------------------------------------------------------
# Main entry point
# --------------------------------------------------------------------------

def assess(claim, series, field_info=None):
    """
    Assess one structured `schema.Claim` against a real annual series.

    Returns a dict with the verdict, a rationale, the derived analysis (change,
    interval, decision regions) and, for commitments, the trajectory block.
    Retrieval and provenance are the caller's job; this function only reasons.
    """
    # ---- 1. no observation channel for this metric --------------------
    if claim.metric is None:
        return _result(NEEDS_CLARIFICATION,
                       "No environmental metric could be identified in this claim, so "
                       "there is nothing to retrieve observations for.")
    if not claim.metric_supported:
        return _result(NO_SIGNAL, metrics_mod.unsupported_reason(claim.metric))

    # ---- 2. claim too vague to check without guessing -----------------
    if claim.claim_type == CLAIM_AMBIGUOUS:
        return _result(NEEDS_CLARIFICATION,
                       "This clause mentions " + metrics_mod.label(claim.metric) +
                       " but states neither a quantity nor a period, so it cannot be "
                       "resolved to something checkable without guessing.")

    # ---- 3. no observations -------------------------------------------
    if not series and field_info is None:
        return _result(INSUFFICIENT_EVIDENCE,
                       "No monitored field could be identified for this claim, so "
                       "no observation series was retrieved. Select the field the "
                       "claim is about.")
    if not series:
        return _result(INSUFFICIENT_EVIDENCE,
                       "No real flaring series is loaded for this field. Run "
                       "notebooks/03_real_satellite_data_pipeline.ipynb to fetch the "
                       "public World Bank / VIIRS data into data/real/, then reload.")

    years = sorted(series)
    values = [float(series[y]) for y in years]

    # ---- 4. forward-looking commitment -> trajectory ------------------
    if claim.claim_type == CLAIM_FUTURE_COMMITMENT:
        traj = trajectory_mod.analyse(
            series,
            target_year=claim.commitment_year,
            target_value=claim.target_value,
            target_change_percent=claim.claimed_change_percent,
            baseline_year=claim.baseline_year,
            level=LEVEL)
        if not traj.get("feasible"):
            return _result(INSUFFICIENT_EVIDENCE, traj.get("reason", "Trajectory "
                           "could not be estimated."), trajectory=traj)
        rationale = (
            f"This is a commitment for {claim.commitment_year}, so it cannot be "
            f"true or false yet; what can be checked is the path so far. "
            f"{traj['reasoning']}")
        return _result(traj["verdict"], rationale, trajectory=traj)

    # ---- 5. historical claim ------------------------------------------
    baseline_year = claim.baseline_year or years[0]
    comparison_year = claim.comparison_year or years[-1]
    assumptions = []
    if claim.baseline_year is None:
        assumptions.append(f"baseline taken as {baseline_year} (earliest observation)")
    if claim.comparison_year is None:
        assumptions.append(f"outcome year taken as {comparison_year} (latest observation)")

    if baseline_year not in series or comparison_year not in series:
        return _result(INSUFFICIENT_EVIDENCE,
                       f"The claim points at {baseline_year}→{comparison_year}, but "
                       f"the observed series only covers {years[0]}–{years[-1]}.")
    if abs(series[baseline_year]) < 1e-12:
        return _result(INSUFFICIENT_EVIDENCE,
                       f"Observed flaring in the baseline year {baseline_year} is zero, "
                       "so a percentage change is undefined.")

    observed = (series[comparison_year] - series[baseline_year]) / series[baseline_year]
    idx_b, idx_t = years.index(baseline_year), years.index(comparison_year)
    ci_lo, ci_hi = bootstrap_change(years, values, idx_b, idx_t)

    claimed = (claim.claimed_change_percent / 100.0
               if claim.claimed_change_percent is not None else None)

    analysis = dict(
        baseline_year=baseline_year,
        comparison_year=comparison_year,
        baseline_value=round(series[baseline_year], 6),
        comparison_value=round(series[comparison_year], 6),
        observed_change=round(observed, 6),
        claimed_change=round(claimed, 6) if claimed is not None else None,
        interval=[round(ci_lo, 6), round(ci_hi, 6)] if ci_lo is not None else None,
        interval_kind=f"residual_bootstrap_{int(LEVEL * 100)}",
        interval_note=("Residual bootstrap around the fitted annual trend. It "
                       "describes scatter around that trend and carries no "
                       "analytical coverage guarantee, so it is not a calibrated "
                       "confidence interval. Its empirical coverage was measured "
                       "separately and is reported with each verdict."),
        # The half-width of the "essentially flat" region, so a client can draw
        # the exact decision regions this verdict used instead of re-declaring it.
        flat_band=FLAT_BAND,
        assumptions=assumptions,
    )
    analysis["summary"] = (
        f"Observed {_pct(abs(observed))} "
        f"{'lower' if observed < 0 else 'higher'} in {comparison_year} than "
        f"{baseline_year} ({analysis['baseline_value']} → "
        f"{analysis['comparison_value']}).")

    if ci_lo is None:
        analysis["interval_spans_decision_regions"] = False
        return _result(INSUFFICIENT_EVIDENCE,
                       "An uncertainty interval could not be computed from this "
                       "series, so no verdict is issued.", analysis=analysis)

    analysis["interval_summary"] = (
        f"{int(LEVEL * 100)}% interval {_pct(ci_lo)} to {_pct(ci_hi)}")

    # ---- the interval drives the decision ------------------------------
    r_lo = _region(ci_lo, claimed)
    r_hi = _region(ci_hi, claimed)
    r_point = _region(observed, claimed)
    span = abs(r_hi - r_lo)
    analysis.update(
        region_low=r_lo, region_high=r_hi, region_point=r_point,
        region_span=span,
        region_labels={str(k): v for k, v in REGION_LABELS.items()},
        interval_spans_decision_regions=bool(span >= 2),
    )

    half_width = max((ci_hi - ci_lo) / 2, 1e-9)
    boundary = claimed if claimed is not None else -FLAT_BAND
    analysis["decision_margin"] = round(abs(observed - boundary) / half_width, 3)
    analysis["decision_margin_kind"] = (
        "heuristic: distance from the nearest decision boundary, in interval "
        "half-widths. Not a probability and not calibrated.")

    if span >= 2:
        rationale = (
            f"{analysis['summary']} But the {int(LEVEL * 100)}% interval runs from "
            f"{_pct(ci_lo)} to {_pct(ci_hi)}, which spans "
            f"“{REGION_LABELS[min(r_lo, r_hi)]}” through "
            f"“{REGION_LABELS[max(r_lo, r_hi)]}”. The observations cannot "
            f"distinguish between those outcomes, so no verdict is issued on this "
            f"evidence.")
        if assumptions:
            rationale += " (" + "; ".join(assumptions) + ".)"
        return _result(ABSTAIN, rationale, analysis=analysis)

    verdict = _verdict_for_region(r_point, claimed)
    borderline = span == 1
    rationale = analysis["summary"] + " "
    if claimed is not None:
        rationale += f"The claim was a {_pct(abs(claimed))} reduction. "
    rationale += _region_reason(r_point, claimed)
    rationale += (f" The {int(LEVEL * 100)}% interval ({_pct(ci_lo)} to "
                  f"{_pct(ci_hi)}) ")
    rationale += ("straddles the decision boundary, so this conclusion is "
                  "borderline." if borderline else
                  "stays within a single decision region.")
    if assumptions:
        rationale += " (" + "; ".join(assumptions) + ".)"

    analysis["borderline"] = borderline
    return _result(verdict, rationale, analysis=analysis)


def _verdict_for_region(region, claimed):
    if claimed is None:
        return {0: SUPPORTED, 1: SUPPORTED, 2: INSUFFICIENT_EVIDENCE,
                3: CONTRADICTED}[region]
    return {0: SUPPORTED, 1: PARTIALLY_SUPPORTED, 2: CONTRADICTED,
            3: CONTRADICTED}[region]


def _region_reason(region, claimed):
    if claimed is None:
        return {
            0: "A reduction is observed, consistent with the claim.",
            1: "A reduction is observed, consistent with the claim.",
            2: "The change is within the flat band, so the claim cannot be "
               "confirmed either way.",
            3: "Flaring rose rather than fell, which is not consistent with the claim.",
        }[region]
    return {
        0: "The observed reduction meets or exceeds the claimed figure.",
        1: "Flaring fell, but by less than the claimed figure.",
        2: "Flaring was essentially flat, so the claimed reduction is not "
           "reflected in the observations.",
        3: "Flaring rose over the claimed period, which is not consistent with a "
           "reduction claim.",
    }[region]


def _result(verdict, rationale, analysis=None, trajectory=None):
    return dict(
        verdict=verdict,
        verdict_meaning=VERDICT_MEANINGS.get(verdict, ""),
        rationale=rationale,
        analysis=analysis,
        trajectory=trajectory,
    )
