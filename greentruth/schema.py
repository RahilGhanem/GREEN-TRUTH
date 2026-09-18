"""
Structured claim representation and the shared verdict vocabulary.

Everything downstream of text extraction speaks this schema. Keeping it in one
place is what lets the extraction, evidence, uncertainty and verdict stages be
swapped independently (see docs/ARCHITECTURE.md).

A note on `extract_confidence`. It is NOT a probability and not a calibrated
score. It is a deterministic *slot-coverage ratio*: the fraction of the slots a
claim of its type needs that were filled from explicit words in the text. It is
reported alongside `extract_confidence_kind` so nothing downstream can mistake
it for a statistical quantity.

On uncertainty more generally: the intervals in `verdict.py` and `trajectory.py`
are residual bootstraps with no analytical coverage guarantee, and they are
labelled as such everywhere they surface. The historical interval's empirical
coverage was measured leave-one-field-out (notebooks/05_uncertainty_calibration)
and each verdict reports the coverage measured at its own year gap. Conformal
alternatives were measured in the same notebook and not adopted (they were ~50%
wider for similar coverage). There is deliberately no `confidence` field anywhere
in the result, so nothing in the interface can imply a guarantee that does not
exist.
"""

from dataclasses import dataclass, field as dc_field, asdict
from typing import Optional, List, Dict, Any


# ---------------------------------------------------------------- claim types

CLAIM_HISTORICAL_REDUCTION = "historical_reduction"
CLAIM_HISTORICAL_INCREASE = "historical_increase"
CLAIM_ABSOLUTE_VALUE = "absolute_value"
CLAIM_FUTURE_COMMITMENT = "future_commitment"
CLAIM_UNSUPPORTED_METRIC = "unsupported_metric"
CLAIM_AMBIGUOUS = "ambiguous"

CLAIM_TYPES = (
    CLAIM_HISTORICAL_REDUCTION,
    CLAIM_HISTORICAL_INCREASE,
    CLAIM_ABSOLUTE_VALUE,
    CLAIM_FUTURE_COMMITMENT,
    CLAIM_UNSUPPORTED_METRIC,
    CLAIM_AMBIGUOUS,
)

# Human labels, used by the API and the interface.
CLAIM_TYPE_LABELS = {
    CLAIM_HISTORICAL_REDUCTION: "Historical reduction",
    CLAIM_HISTORICAL_INCREASE: "Historical increase",
    CLAIM_ABSOLUTE_VALUE: "Absolute value",
    CLAIM_FUTURE_COMMITMENT: "Future commitment",
    CLAIM_UNSUPPORTED_METRIC: "Unsupported metric",
    CLAIM_AMBIGUOUS: "Ambiguous",
}


# ------------------------------------------------------------------- verdicts

SUPPORTED = "supported"
PARTIALLY_SUPPORTED = "partially_supported"
CONTRADICTED = "contradicted"
INSUFFICIENT_EVIDENCE = "insufficient_evidence"
NO_SIGNAL = "no_signal"
ABSTAIN = "abstain"
NEEDS_CLARIFICATION = "needs_clarification"

# Commitment claims are not "supported/contradicted" — a future pledge cannot be
# true or false yet. They get trajectory-consistency outcomes instead.
TRAJECTORY_CONSISTENT = "trajectory_consistent"
TRAJECTORY_UNCERTAIN = "trajectory_uncertain"
TRAJECTORY_INCONSISTENT = "trajectory_inconsistent"

VERDICTS = (
    SUPPORTED, PARTIALLY_SUPPORTED, CONTRADICTED,
    INSUFFICIENT_EVIDENCE, NO_SIGNAL, ABSTAIN, NEEDS_CLARIFICATION,
    TRAJECTORY_CONSISTENT, TRAJECTORY_UNCERTAIN, TRAJECTORY_INCONSISTENT,
)

VERDICT_LABELS = {
    SUPPORTED: "Supported",
    PARTIALLY_SUPPORTED: "Partially supported",
    CONTRADICTED: "Contradicted",
    INSUFFICIENT_EVIDENCE: "Insufficient evidence",
    NO_SIGNAL: "No signal to check",
    ABSTAIN: "Abstain / uncertain",
    NEEDS_CLARIFICATION: "Claim requires clarification",
    TRAJECTORY_CONSISTENT: "On observed trajectory",
    TRAJECTORY_UNCERTAIN: "Trajectory uncertain",
    TRAJECTORY_INCONSISTENT: "Not on observed trajectory",
}

# Deliberately careful wording. These are consistency statements about
# observations, never statements about intent or honesty.
VERDICT_MEANINGS = {
    SUPPORTED:
        "The observed change is consistent with the claimed change.",
    PARTIALLY_SUPPORTED:
        "A change in the claimed direction is observed, but it is smaller "
        "than the claimed magnitude.",
    CONTRADICTED:
        "The observed change is not consistent with the claimed change.",
    INSUFFICIENT_EVIDENCE:
        "The available observations do not cover what the claim asserts.",
    NO_SIGNAL:
        "No measurable observation channel for this metric is wired into "
        "GreenTruth.",
    ABSTAIN:
        "Observations exist, but the uncertainty interval cannot reliably "
        "distinguish between the competing interpretations of the claim.",
    NEEDS_CLARIFICATION:
        "The claim could not be resolved to a single metric, location or "
        "period without guessing.",
    TRAJECTORY_CONSISTENT:
        "Historical observations are consistent with a trajectory toward the "
        "stated target.",
    TRAJECTORY_UNCERTAIN:
        "Historical observations cannot distinguish whether the target "
        "trajectory will be met.",
    TRAJECTORY_INCONSISTENT:
        "Historical observations are not consistent with a trajectory toward "
        "the stated target.",
}

# Outcomes that are a legitimate, successful "we don't know" rather than a
# failure. The interface presents them as such.
ABSTENTION_VERDICTS = frozenset({
    INSUFFICIENT_EVIDENCE, NO_SIGNAL, ABSTAIN, NEEDS_CLARIFICATION,
    TRAJECTORY_UNCERTAIN,
})


# ---------------------------------------------------------- value provenance

# Every number the system surfaces carries one of these labels, so an observed
# value can never be confused with a modelled or projected one.
OBSERVED = "observed"      # straight from the source dataset
ESTIMATED = "estimated"    # derived by a model/fit from observed values
PROJECTED = "projected"    # a future prediction
UNCERTAIN = "uncertain"    # evidence insufficient to state a value


@dataclass
class Claim:
    """One atomic, independently verifiable claim."""

    raw_text: str                                  # the clause as written
    source_text: str = ""                          # the sentence it came from
    claim_type: str = CLAIM_AMBIGUOUS

    metric: Optional[str] = None                   # canonical metric id
    metric_supported: bool = False

    location: Optional[str] = None                 # display name of the field
    location_id: Optional[str] = None              # facilities_international key
    location_candidates: List[str] = dc_field(default_factory=list)

    baseline_year: Optional[int] = None
    comparison_year: Optional[int] = None

    claimed_value: Optional[float] = None          # absolute claims
    claimed_change_percent: Optional[float] = None # signed: -40 means a 40% cut
    unit: Optional[str] = None

    target_commitment: bool = False
    commitment_year: Optional[int] = None
    target_value: Optional[float] = None

    scope: Optional[str] = None                    # "routine" | "total" | None
    direction: Optional[str] = None                # "reduce" | "increase" | None

    extract_confidence: float = 0.0
    extract_confidence_kind: str = "slot_coverage_ratio"
    extracted_slots: List[str] = dc_field(default_factory=list)
    missing_slots: List[str] = dc_field(default_factory=list)
    extraction_notes: List[str] = dc_field(default_factory=list)

    evidence_requirements: List[str] = dc_field(default_factory=list)
    detector: str = "rules"                        # "rules" | "climatebert"
    detector_score: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        d["claim_type_label"] = CLAIM_TYPE_LABELS.get(self.claim_type,
                                                      self.claim_type)
        return d

    # -- convenience used by the verdict engine ---------------------------

    @property
    def is_historical(self) -> bool:
        return self.claim_type in (CLAIM_HISTORICAL_REDUCTION,
                                   CLAIM_HISTORICAL_INCREASE)

    @property
    def needs_clarification(self) -> bool:
        return self.claim_type == CLAIM_AMBIGUOUS
