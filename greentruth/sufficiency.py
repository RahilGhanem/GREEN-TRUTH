"""
Evidence sufficiency: can the available observations actually support this claim?

This is a separate stage from the verdict on purpose. "Contradicted" and
"we cannot check this" are different statements about the world, and collapsing
them is the most common way an automated verification system misleads its reader.

The engine runs an explicit checklist and returns every check with its status,
so the interface can show the reader exactly which link in the chain is weak:

    PASS  the requirement is met
    WARN  met, but with a limitation that bounds how strong the conclusion can be
    FAIL  not met; an independent verification is not possible on this evidence

Two of the checks are permanent WARNs for this dataset, and that is honest rather
than pessimistic: VIIRS attributes a flare to a location, not to an operator, and
radius-based field grouping is coarse. Those limits do not disappear because a
number was computed, so they are surfaced on every flaring verdict.
"""

from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Optional

from . import metrics as metrics_mod
from .schema import (
    CLAIM_ABSOLUTE_VALUE,
    CLAIM_AMBIGUOUS,
    CLAIM_FUTURE_COMMITMENT,
)

PASS = "pass"
WARN = "warn"
FAIL = "fail"

STATUS_SYMBOL = {PASS: "✓", WARN: "⚠", FAIL: "✗"}

# Reason codes, so the interface and the tests agree on vocabulary.
NO_METRIC = "no_metric_identified"
NO_CHANNEL = "no_observation_channel"
NO_FACILITY = "facility_unresolved"
AMBIGUOUS_FACILITY = "facility_ambiguous"
NO_OBSERVATIONS = "no_observations"
NO_TEMPORAL_OVERLAP = "insufficient_temporal_overlap"
TOO_FEW_OBSERVATIONS = "too_few_observations"
TARGET_OUTSIDE_PERIOD = "target_outside_observed_period"
UNCERTAINTY_TOO_LARGE = "uncertainty_too_large"
ATTRIBUTION_LIMIT = "attribution_limitation"
NO_CORROBORATION = "no_independent_corroboration"
NO_INDEPENDENT_INSTRUMENT = "no_independent_instrument"
EVIDENCE_CONFLICT = "cross_scale_divergence"
METHANE_DIVERGENCE = "methane_pattern_divergence"
HAS_INDEPENDENT_INSTRUMENT = "independent_instrument_available"
CROSS_SENSOR_TENSION = "cross_sensor_tension"

# Three-level sufficiency verdict. "Can this claim be checked at all?" is a
# different question from "is the claim true?", and it has three honest
# answers, not two: the evidence can support a strong conclusion, it can
# support a qualified one, or it cannot support one.
SUFFICIENT = "SUFFICIENT"
PARTIALLY_SUFFICIENT = "PARTIALLY_SUFFICIENT"
INSUFFICIENT = "INSUFFICIENT"

# A limitation that bounds the strength of ANY conclusion, however clean the
# numbers are. Their presence is what separates SUFFICIENT from PARTIAL.
STRUCTURAL_LIMITS = frozenset({ATTRIBUTION_LIMIT, NO_INDEPENDENT_INSTRUMENT,
                              NO_CORROBORATION, AMBIGUOUS_FACILITY,
                              CROSS_SENSOR_TENSION, EVIDENCE_CONFLICT})

MIN_TREND_POINTS = 5


@dataclass
class Check:
    key: str
    label: str
    status: str
    detail: str

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["symbol"] = STATUS_SYMBOL[self.status]
        return d


def assess(claim, field_info, series, analysis=None, candidates=None,
           corroboration=None, methane=None) -> Dict[str, Any]:
    """
    Build the sufficiency report for one claim.

    `analysis` is the derived comparison (may be None if it could not be
    computed). `candidates` is the list of fields the claim could refer to when
    resolution was ambiguous. `corroboration` is the cross-scale comparison
    from corroboration.py, or None when no second series was available.
    """
    checks: List[Check] = []
    reasons: List[str] = []

    # ---- 1. is there a metric at all? ----------------------------------
    if claim.metric is None:
        checks.append(Check(
            "metric", "Claim metric identified", FAIL,
            "No environmental metric could be identified in this claim."))
        reasons.append(NO_METRIC)
    else:
        checks.append(Check(
            "metric", "Claim metric identified", PASS,
            f"Identified as {metrics_mod.label(claim.metric)}."))

    # ---- 2. do we have an observation channel for it? ------------------
    if claim.metric is None:
        checks.append(Check("channel", "Observation channel available", FAIL,
                            "No metric, so no channel can be selected."))
        reasons.append(NO_CHANNEL)
    elif not claim.metric_supported:
        checks.append(Check(
            "channel", "Observation channel available", FAIL,
            metrics_mod.unsupported_reason(claim.metric)))
        reasons.append(NO_CHANNEL)
    else:
        checks.append(Check(
            "channel", "Observation channel available", PASS,
            "Gas flaring is wired to the World Bank Global Gas Flaring Tracker "
            "(VIIRS)."))

    # ---- 3. facility resolution ---------------------------------------
    if field_info is None:
        checks.append(Check(
            "facility", "Facility identified", FAIL,
            "No field could be resolved from the claim or the selection."))
        reasons.append(NO_FACILITY)
    elif candidates and len(candidates) > 1:
        checks.append(Check(
            "facility", "Facility identified", WARN,
            f"{len(candidates)} fields match this claim "
            f"({', '.join(candidates[:4])}{'...' if len(candidates) > 4 else ''}). "
            f"Analysing {field_info.get('name')}; the choice is not evidence-based."))
        reasons.append(AMBIGUOUS_FACILITY)
    else:
        checks.append(Check(
            "facility", "Facility identified", PASS,
            f"{field_info.get('name')} ({field_info.get('country')}) at "
            f"{field_info.get('lat')}, {field_info.get('lon')}."))

    # ---- 4. observations exist ----------------------------------------
    years = sorted(series) if series else []
    if not years:
        checks.append(Check(
            "observations", "Observations available", FAIL,
            "No observation series is loaded for this field."))
        reasons.append(NO_OBSERVATIONS)
    else:
        checks.append(Check(
            "observations", "Observations available", PASS,
            f"{len(years)} annual observations, {years[0]}-{years[-1]}."))

    # ---- 5. temporal overlap ------------------------------------------
    if years:
        if claim.claim_type == CLAIM_FUTURE_COMMITMENT:
            ty = claim.commitment_year
            if ty is None:
                checks.append(Check(
                    "temporal", "Claim period covered by observations", FAIL,
                    "The commitment does not state a target year."))
                reasons.append(NO_TEMPORAL_OVERLAP)
            elif ty > years[-1]:
                # Expected and fine for a pledge — it is why we project.
                checks.append(Check(
                    "temporal", "Claim period covered by observations", WARN,
                    f"The target year {ty} lies beyond the observed period "
                    f"({years[0]}-{years[-1]}). The target cannot be verified; only "
                    f"the trajectory toward it can be assessed."))
                reasons.append(TARGET_OUTSIDE_PERIOD)
            else:
                checks.append(Check(
                    "temporal", "Claim period covered by observations", PASS,
                    f"Target year {ty} is inside the observed period."))
        else:
            need = [y for y in (claim.baseline_year, claim.comparison_year) if y]
            outside = [y for y in need if y < years[0] or y > years[-1]]
            if outside:
                checks.append(Check(
                    "temporal", "Claim period covered by observations", FAIL,
                    f"The claim refers to {', '.join(str(y) for y in outside)}, outside "
                    f"the observed period {years[0]}-{years[-1]}."))
                reasons.append(NO_TEMPORAL_OVERLAP)
            elif not need:
                checks.append(Check(
                    "temporal", "Claim period covered by observations", WARN,
                    "The claim states no years, so the full observed period "
                    f"({years[0]}-{years[-1]}) was used. This is an assumption, not "
                    "something the claim said."))
            else:
                checks.append(Check(
                    "temporal", "Claim period covered by observations", PASS,
                    f"Claim period {'-'.join(str(y) for y in need)} lies inside "
                    f"{years[0]}-{years[-1]}."))

    # ---- 6. enough points to say anything about a trend ---------------
    if years:
        if len(years) < MIN_TREND_POINTS:
            checks.append(Check(
                "sample", "Enough observations for a trend", FAIL,
                f"Only {len(years)} annual observations; at least "
                f"{MIN_TREND_POINTS} are needed to estimate a trend."))
            reasons.append(TOO_FEW_OBSERVATIONS)
        else:
            checks.append(Check(
                "sample", "Enough observations for a trend", PASS,
                f"{len(years)} annual observations."))

    # ---- 7. attribution: a permanent limitation of this measurement ----
    if claim.metric_supported and field_info is not None:
        checks.append(Check(
            "attribution", "Attribution to the claiming organisation", WARN,
            "VIIRS detects flares at a location. Flaring near a field is consistent "
            "with activity there, but it is not proof that a particular operator "
            "caused it, and several operators may work the same field. "
            f"Flares are grouped within {field_info.get('match_radius_km')} km of the "
            "field centre, which is coarse at field boundaries."))
        reasons.append(ATTRIBUTION_LIMIT)

    # ---- 8. measurement uncertainty -----------------------------------
    if analysis and analysis.get("interval") is not None:
        lo, hi = analysis["interval"]
        width = hi - lo
        if analysis.get("interval_spans_decision_regions"):
            checks.append(Check(
                "uncertainty", "Uncertainty small enough to decide", FAIL,
                f"The 90% interval ({lo:+.0%} to {hi:+.0%}) spans materially "
                "different outcomes, so the observations cannot distinguish between "
                "them. The system abstains rather than pick the point estimate."))
            reasons.append(UNCERTAINTY_TOO_LARGE)
        elif width > 0.5:
            checks.append(Check(
                "uncertainty", "Uncertainty small enough to decide", WARN,
                f"The 90% interval is wide ({lo:+.0%} to {hi:+.0%}); the conclusion "
                "is directional rather than precise."))
        else:
            checks.append(Check(
                "uncertainty", "Uncertainty small enough to decide", PASS,
                f"90% interval {lo:+.0%} to {hi:+.0%}."))
    elif claim.metric_supported and years:
        checks.append(Check(
            "uncertainty", "Uncertainty small enough to decide", WARN,
            "No interval could be computed for this claim."))

    # ---- 9. corroboration at a second spatial scale -------------------
    # Upgraded from a hardcoded warning: the national series really is compared
    # now. It is still only a WARN at best, because the two series come from the
    # same VIIRS programme and are therefore not independent instruments.
    if claim.metric_supported:
        # 9a. same-instrument, different spatial scale (field vs national)
        if corroboration and corroboration.get("available"):
            if corroboration["relationship"] == "diverges":
                reasons.append(EVIDENCE_CONFLICT)
            checks.append(Check(
                "corroboration", "Cross-scale corroboration (same instrument)", WARN,
                corroboration["detail"] + " " + corroboration["caveat"]))
        else:
            checks.append(Check(
                "corroboration", "Cross-scale corroboration (same instrument)", WARN,
                (corroboration or {}).get(
                    "detail", "No second series was available to cross-check this "
                              "field.")))
            reasons.append(NO_CORROBORATION)

        # 9b. a genuinely different instrument: Sentinel-5P methane
        if methane and methane.get("available"):
            rel = methane["relationship"]
            status = WARN if rel == "flaring_down_methane_up" else PASS
            if rel == "flaring_down_methane_up":
                reasons.append(METHANE_DIVERGENCE)
                reasons.append(CROSS_SENSOR_TENSION)
            reasons.append(HAS_INDEPENDENT_INSTRUMENT)
            checks.append(Check(
                "independent_instrument",
                "Independent instrument (Sentinel-5P methane)", status,
                methane["detail"] + " " + methane["attribution_warning"]))
        else:
            checks.append(Check(
                "independent_instrument",
                "Independent instrument (Sentinel-5P methane)", WARN,
                (methane or {}).get(
                    "detail",
                    "No independent instrument is available for this field, so the "
                    "flaring result is not corroborated by a different sensor.")))
            reasons.append(NO_INDEPENDENT_INSTRUMENT)

    failed = [c for c in checks if c.status == FAIL]
    warned = [c for c in checks if c.status == WARN]
    reason_set = set(reasons)

    # ---- the three-level verdict ---------------------------------------
    # Any FAIL blocks a conclusion outright. With no FAIL, the question is
    # whether the remaining limitations are structural — attribution, a missing
    # independent instrument, an ambiguous facility, or sources disagreeing.
    # Those bound how strong a conclusion can be even when every number is clean,
    # so they downgrade SUFFICIENT to PARTIALLY_SUFFICIENT rather than being
    # waved through as footnotes.
    structural = sorted(reason_set & STRUCTURAL_LIMITS)
    if failed:
        level = INSUFFICIENT
        summary = "Evidence insufficient: " + failed[0].detail
    elif structural:
        level = PARTIALLY_SUFFICIENT
        summary = (f"Evidence supports a qualified conclusion only: "
                   f"{len(structural)} structural "
                   f"limitation{'s' if len(structural) != 1 else ''} apply "
                   f"({', '.join(_readable(r) for r in structural)}).")
    else:
        level = SUFFICIENT
        summary = "Evidence supports a conclusion on every dimension checked."

    # The ceiling: the strongest statement this evidence can carry.
    if level == INSUFFICIENT:
        ceiling = "No conclusion can be drawn from the available observations."
    elif CROSS_SENSOR_TENSION in reason_set or EVIDENCE_CONFLICT in reason_set:
        ceiling = ("Sources disagree, so any conclusion applies to one measurement "
                   "and must be stated alongside the others.")
    elif NO_INDEPENDENT_INSTRUMENT in reason_set:
        ceiling = ("Single-instrument consistency only: the result is not "
                   "corroborated by a different sensor.")
    elif ATTRIBUTION_LIMIT in reason_set:
        ceiling = ("Regional consistency only: the observations describe activity "
                   "at this location, not the conduct of a named operator.")
    else:
        ceiling = "Consistency between the claim and the available observations."

    return dict(
        # -- three-level verdict -------------------------------------------
        level=level,
        level_label=level.replace("_", " ").title(),
        evidence_ceiling=ceiling,
        observable_vs_attributable=observable_vs_attributable(
            claim, analysis, field_info, level),
        # -- legacy boolean, kept so existing callers keep working ----------
        sufficient=(level != INSUFFICIENT),
        summary=summary,
        checks=[c.to_dict() for c in checks],
        n_pass=sum(1 for c in checks if c.status == PASS),
        n_warn=len(warned),
        n_fail=len(failed),
        reasons=sorted(reason_set),
        structural_limitations=structural,
        blocking_reasons=[r for r in sorted(reason_set) if r in {
            NO_METRIC, NO_CHANNEL, NO_FACILITY, NO_OBSERVATIONS,
            NO_TEMPORAL_OVERLAP, TOO_FEW_OBSERVATIONS, UNCERTAINTY_TOO_LARGE}],
    )


def observable_vs_attributable(claim, analysis, field_info, level):
    """
    Separate what the observations SHOW from what they could ATTRIBUTE.

    This is the distinction the whole project turns on. A satellite can establish
    that flaring at a location fell; it cannot establish that a named organisation
    caused the fall. Collapsing the two is how evidence systems overreach, so the
    two statements are produced separately and rendered separately.

    `attributable` is deliberately None for every flaring result: no configuration
    of VIIRS or TROPOMI supports operator-level attribution.
    """
    metric_label = metrics_mod.label(claim.metric) if claim.metric else "the metric"
    where = field_info.get("name") if field_info else "the selected field"

    if not analysis or analysis.get("observed_change") is None:
        observed = None
    else:
        pct = analysis["observed_change"] * 100
        observed = (f"{metric_label} at {where} changed {pct:+.0f}% between "
                    f"{analysis['baseline_year']} and {analysis['comparison_year']}, "
                    f"as measured by the observation dataset.")
        if level == INSUFFICIENT:
            observed += (" The uncertainty around that figure is too wide to "
                         "support a conclusion about the claim.")

    return dict(
        observable=observed,
        observable_is=("a measurement at a location over a period"
                       if observed else None),
        attributable=None,
        attributable_is="a statement about who caused it",
        not_attributable_because=(
            "VIIRS detects radiant heat at a location and Sentinel-5P measures an "
            "atmospheric column over roughly 7 km. Neither instrument observes an "
            "operator, a contract or a corporate boundary. Several operators may "
            "work the same field, and flares near a boundary may belong to a "
            "neighbouring one. Attribution would require permitting, production or "
            "contractual records, which are not Earth observation."),
        example_of_the_difference=dict(
            supported_by_evidence=(observed or
                                   "no measurement is available for this claim"),
            not_supported_by_evidence=(
                f"that any particular organisation caused the change at {where}"),
        ),
    )

_READABLE = {
    ATTRIBUTION_LIMIT: "attribution to an operator is not possible",
    NO_INDEPENDENT_INSTRUMENT: "no independent instrument",
    NO_CORROBORATION: "no second source",
    AMBIGUOUS_FACILITY: "facility ambiguous",
    CROSS_SENSOR_TENSION: "instruments disagree",
    EVIDENCE_CONFLICT: "spatial scales disagree",
}


def _readable(code):
    return _READABLE.get(code, code.replace("_", " "))
