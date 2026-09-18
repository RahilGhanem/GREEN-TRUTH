"""
Compound-claim decomposition: one sentence -> one or more atomic `Claim` objects.

Why this module exists
----------------------
A single sentence routinely carries several independently checkable assertions:

    "We reduced routine gas flaring by 40% from 2019 levels
     and will eliminate routine flaring by 2030."

Treated as one claim, the trailing "by 2030" is read as the *outcome year* of the
historical reduction, so the engine tries to evaluate 2019 -> 2030 against a
series that ends in 2024 and returns "insufficient evidence". The two halves are
individually verifiable; only their conflation is not.

Decomposing first fixes that, and it is also what makes the rest of the pipeline
honest: a past result and a future pledge need different evidence and different
verdict vocabularies, so they must not share a record.

What this module does NOT do
----------------------------
It does not judge claims, retrieve evidence, or score confidence. It converts
text into `schema.Claim` records and records what it could not fill, so the
sufficiency engine downstream can explain the gap rather than guess.

`extract_confidence` here is a deterministic slot-coverage ratio, exactly as
`schema.py` documents it: the fraction of the slots this claim type needs that
were filled from explicit words in the text. It is not a probability and it is
never presented as one.
"""

import re

from . import metrics
from .schema import (
    Claim,
    CLAIM_ABSOLUTE_VALUE,
    CLAIM_AMBIGUOUS,
    CLAIM_FUTURE_COMMITMENT,
    CLAIM_HISTORICAL_INCREASE,
    CLAIM_HISTORICAL_REDUCTION,
    CLAIM_UNSUPPORTED_METRIC,
)

# --------------------------------------------------------------------------
# Sentence / clause splitting
# --------------------------------------------------------------------------

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+(?=[A-Z0-9])")

# Tokens that can legitimately start a new clause. A bare comma only splits when
# the text after it begins with one of these, so "Rumaila, Basra and West Qurna"
# stays a noun list while "..., cut methane by 30%" becomes its own clause.
_CLAUSE_STARTER = (
    r"(?:and\s+|then\s+)?(?:we|it|they|our|the\s+company|will|shall|"
    r"cut|cuts|reduced|reduce|reduces|eliminated|eliminate|eliminates|"
    r"increased|increase|achieved|achieve|delivered|deliver|halved|halve|"
    r"lowered|lower|decreased|decrease|slashed|slash|grew|grow|rose|raised|"
    r"maintained|maintain|aims?|plans?|intends?|targets?|commits?|committed|"
    r"pledges?|pledged|expects?|has|have|had|is|are|was|were)\b"
)

# Clause separators. Order matters: the longer, more explicit ones first.
_CLAUSE_SPLIT = re.compile(
    r"(?:;"
    r"|\s+and\s+also\s+|\s+as\s+well\s+as\s+|,\s+and\s+|\s+and\s+"
    r"|\s+while\s+|\s+whereas\s+|\s+but\s+|\s+although\s+"
    rf"|,\s+(?={_CLAUSE_STARTER}))",
    re.I,
)

# A fragment that only sets the time frame ("In 2023", "Since 2019") belongs to
# the clause that FOLLOWS it, not the one before. Merging it backwards, or
# dropping it, would silently lose the year the claim depends on.
_TEMPORAL_LEAD = re.compile(
    r"^(?:in|since|between|from|by|during|over|across|through)\b", re.I
)

# "between 2019 and 2024" must survive clause splitting, so the inner "and" is
# masked before splitting and restored afterwards.
_BETWEEN = re.compile(r"\bbetween\s+(20\d\d)\s+and\s+(20\d\d)\b", re.I)
_AND_MASK = "\x00AND\x00"

# A fragment is only a real clause if it carries its own verb or its own number;
# otherwise it is part of a list ("Hassi R'Mel and Hassi Messaoud") and is
# re-joined to the fragment before it.
_CLAUSE_EVIDENCE = re.compile(
    r"\b(?:will|shall|aims?|plans?|intends?|targets?|targeting|commits?|"
    r"committed|pledges?|pledged|expects?|reduced|reduce|cut|cuts|eliminated|"
    r"eliminate|halved|halve|lowered|lower|decreased|decrease|achieved|achieve|"
    r"delivered|deliver|slashed|slash|increased|increase|grew|grow|rose|raised|"
    r"maintained|maintain|investing|invest|developing|develop|expanding|"
    r"deploying|building|scaling|transitioning|advancing|"
    r"we|it|they|our|is|are|was|were|has|have|had|remains?)\b"
    r"|\d",
    re.I,
)


def split_sentences(text):
    """Split into sentences, keeping headings (lines with no end punctuation)
    separate so a title never gets glued onto the first real sentence."""
    out = []
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        for part in _SENTENCE_SPLIT.split(line):
            part = " ".join(part.split())
            if part:
                out.append(part)
    return out


def split_clauses(sentence):
    """Split one sentence into candidate clauses.

    Fragments without a verb or a digit are merged back into the preceding
    fragment, which keeps noun lists ("Rumaila and Basra") intact.
    """
    masked = _BETWEEN.sub(
        lambda m: f"between {m.group(1)}{_AND_MASK}{m.group(2)}", sentence
    )
    raw = [p.strip(" ,;") for p in _CLAUSE_SPLIT.split(masked)]
    raw = [p for p in raw if p]

    # Pass 1: a fragment with no verb and no number is part of a list, not a
    # clause of its own. Re-join it to the fragment before it.
    merged = []
    for part in raw:
        if merged and not _CLAUSE_EVIDENCE.search(part):
            merged[-1] = merged[-1] + " and " + part
        else:
            merged.append(part)

    # Pass 2: attach a leading time phrase to the clause it qualifies.
    out = []
    carry = ""
    for part in merged:
        is_lead = (
            _TEMPORAL_LEAD.match(part)
            and metrics.primary_metric(part) is None
            and not _PERCENT.search(part)
        )
        if is_lead:
            carry = (carry + " " + part).strip()
            continue
        out.append((carry + " " + part).strip() if carry else part)
        carry = ""
    if carry:                      # trailing time phrase: attach to the last clause
        if out:
            out[-1] = out[-1] + " " + carry
        else:
            out.append(carry)

    return [p.replace(_AND_MASK, " and ") for p in out] or [sentence]


# --------------------------------------------------------------------------
# Tense / modality
# --------------------------------------------------------------------------

# Forward-looking markers. "by 2030" alone is NOT one of these: a historical
# claim can also say "by 2023", so the year is never what decides the tense.
_FUTURE = re.compile(
    r"\b(?:will|shall|going\s+to|aims?\s+to|aim\s+to|plans?\s+to|plan\s+to|"
    r"intends?\s+to|intend\s+to|targets?\s+to|seeks?\s+to|expects?\s+to|"
    r"commits?\s+to|committed\s+to|pledges?\s+to|pledged\s+to|"
    r"on\s+track\s+to|working\s+to|by\s+20\d\d\s+we\s+will)\b",
    re.I,
)
# Bare commitment nouns: "our 2030 target", "a commitment to zero flaring".
_FUTURE_NOUN = re.compile(
    r"\b(?:target|targets|goal|goals|commitment|commitments|pledge|pledges|"
    r"ambition|ambitions|roadmap)\b",
    re.I,
)
# Present-progressive / ongoing-action commitments. These state that something
# is being done, without a number or a target year. They ARE claims — a reader
# would treat them as such — so dropping them silently understates what a report
# asserted. They are captured here and then reported as having no compatible
# observation channel, which is a statement about GreenTruth, not about the claim.
_ONGOING = re.compile(
    r"\b(?:investing|invest|investment|investments|developing|develop|"
    r"expanding|expand|deploying|deploy|building|build|scaling|scale|"
    r"transitioning|transition|rolling\s+out|increasing|advancing)\b",
    re.I,
)

_PAST = re.compile(
    r"\b(?:reduced|cut|eliminated|halved|lowered|decreased|achieved|delivered|"
    r"phased\s+out|slashed|brought\s+down|increased|grew|rose|raised|"
    r"has\s+\w+ed|have\s+\w+ed|had\s+\w+ed|was|were|since)\b",
    re.I,
)

_REDUCE = re.compile(
    r"\b(?:reduc\w*|cut|cuts|lower\w*|decreas\w*|eliminat\w*|halv\w*|"
    r"phas\w*\s+out|slash\w*|brought\s+down|bring\s+down|down)\b",
    re.I,
)
_INCREASE = re.compile(r"\b(?:increas\w*|grow|grew|grown|rose|risen|raised|up)\b", re.I)

_ZERO_TARGET = re.compile(
    r"\b(?:zero\s+routine\s+flaring|zero\s+flaring|zero\s+routine|net[-\s]?zero|"
    r"eliminat\w*|end\s+(?:all\s+)?routine|phase\s+out)\b",
    re.I,
)

# --------------------------------------------------------------------------
# Quantities
# --------------------------------------------------------------------------

_PERCENT = re.compile(r"(\d{1,3}(?:\.\d+)?)\s*(?:%|per\s*cent|percent)", re.I)
_BY_YEAR = re.compile(r"\bby\s+(20\d\d)\b", re.I)
_IN_YEAR = re.compile(r"\b(?:in|during|for|reached)\s+(20\d\d)\b", re.I)
_BASELINE = re.compile(
    r"(?:from\s+(?:a\s+|our\s+|the\s+)?(20\d\d)\s*(?:levels?|baseline|base)?"
    r"|compared\s+(?:to|with)\s+(20\d\d)"
    r"|(?:vs\.?|versus|against)\s+(?:a\s+)?(20\d\d)"
    r"|(20\d\d)\s+baseline"
    r"|relative\s+to\s+(20\d\d)"
    r"|since\s+(20\d\d))",
    re.I,
)
_BETWEEN_YEARS = re.compile(r"\bbetween\s+(20\d\d)\s+and\s+(20\d\d)\b", re.I)
_ABSOLUTE = re.compile(
    r"(\d+(?:\.\d+)?)\s*(bcm|billion\s+cubic\s+met(?:re|er)s?|million\s+tonnes?|"
    r"tonnes?|kt|mt|m3|cubic\s+met(?:re|er)s?)\b",
    re.I,
)


def extract_quantities(clause):
    """Pull every number this clause states. Any of them may be absent."""
    low = clause.lower()

    percent = None
    m = _PERCENT.search(clause)
    if m:
        percent = float(m.group(1))
    if percent is None and re.search(r"\bhalv\w*", low):
        percent = 50.0

    direction = None
    if _REDUCE.search(clause):
        direction = "reduce"
    elif _INCREASE.search(clause):
        direction = "increase"

    by_year = None
    m = _BY_YEAR.search(clause)
    if m:
        by_year = int(m.group(1))

    in_year = None
    m = _IN_YEAR.search(clause)
    if m:
        in_year = int(m.group(1))

    baseline_year = None
    m = _BASELINE.search(clause)
    if m:
        baseline_year = int(next(g for g in m.groups() if g))

    between = _BETWEEN_YEARS.search(clause)
    if between:
        baseline_year = int(between.group(1))
        in_year = int(between.group(2))

    absolute_value, unit = None, None
    m = _ABSOLUTE.search(clause)
    if m:
        absolute_value = float(m.group(1))
        unit = " ".join(m.group(2).lower().split())

    scope = None
    if "routine" in low:
        scope = "routine"
    elif "total" in low or "overall" in low:
        scope = "total"

    return dict(
        percent=percent,
        direction=direction,
        by_year=by_year,
        in_year=in_year,
        baseline_year=baseline_year,
        absolute_value=absolute_value,
        unit=unit,
        scope=scope,
        zero_target=bool(_ZERO_TARGET.search(clause)),
    )


# --------------------------------------------------------------------------
# Classification
# --------------------------------------------------------------------------

def classify(clause, q):
    """Decide the claim type of one clause.

    Tense decides first, because the same year phrase means different things in
    a past result and a pledge. Only then does the shape of the number matter.
    """
    is_future = bool(_FUTURE.search(clause))
    if not is_future and _FUTURE_NOUN.search(clause) and q["by_year"]:
        is_future = True
    is_past = bool(_PAST.search(clause))

    # "will" beats a past-tense verb appearing elsewhere in the same clause.
    if is_future and not (is_past and not _FUTURE.search(clause)):
        return CLAIM_FUTURE_COMMITMENT

    if q["percent"] is not None and q["direction"] == "reduce":
        return CLAIM_HISTORICAL_REDUCTION
    if q["percent"] is not None and q["direction"] == "increase":
        return CLAIM_HISTORICAL_INCREASE
    if q["absolute_value"] is not None:
        return CLAIM_ABSOLUTE_VALUE
    if is_past and q["direction"] == "reduce":
        return CLAIM_HISTORICAL_REDUCTION
    if is_past and q["direction"] == "increase":
        return CLAIM_HISTORICAL_INCREASE
    if _ONGOING.search(clause):
        # "we are investing in X": a stated commitment to activity, with no
        # quantity and no deadline. Typed as a commitment so it is not confused
        # with a measured result.
        return CLAIM_FUTURE_COMMITMENT
    return CLAIM_AMBIGUOUS


# Slots each claim type needs before it can be checked without guessing.
_REQUIRED_SLOTS = {
    CLAIM_HISTORICAL_REDUCTION: ["metric", "claimed_change_percent",
                                 "baseline_year", "comparison_year"],
    CLAIM_HISTORICAL_INCREASE: ["metric", "claimed_change_percent",
                                "baseline_year", "comparison_year"],
    CLAIM_ABSOLUTE_VALUE: ["metric", "claimed_value", "unit", "comparison_year"],
    CLAIM_FUTURE_COMMITMENT: ["metric", "commitment_year", "target_value"],
    CLAIM_AMBIGUOUS: ["metric"],
    CLAIM_UNSUPPORTED_METRIC: ["metric"],
}

_EVIDENCE_REQUIREMENTS = {
    CLAIM_HISTORICAL_REDUCTION: [
        "An observation series for the metric",
        "Observations covering the baseline year",
        "Observations covering the comparison year",
    ],
    CLAIM_HISTORICAL_INCREASE: [
        "An observation series for the metric",
        "Observations covering the baseline year",
        "Observations covering the comparison year",
    ],
    CLAIM_ABSOLUTE_VALUE: [
        "An observation series for the metric",
        "Observations in the stated year",
        "A unit that matches the observation series",
    ],
    CLAIM_FUTURE_COMMITMENT: [
        "An observation series for the metric",
        "Enough historical observations to estimate a trend",
        "A stated target year",
    ],
    CLAIM_AMBIGUOUS: ["A resolvable metric, period and location"],
    CLAIM_UNSUPPORTED_METRIC: ["An observation channel for this metric"],
}


def _build(clause, sentence, q, metric, inherited_metric=False):
    """Assemble one `schema.Claim` from a clause and its extracted numbers."""
    ctype = classify(clause, q)
    if metric is not None and not metrics.is_supported(metric):
        # Keep the semantic type, but record that no channel exists. The verdict
        # layer needs both facts: what was claimed, and that we cannot observe it.
        pass

    c = Claim(raw_text=clause, source_text=sentence, claim_type=ctype)
    c.metric = metric
    c.metric_supported = metrics.is_supported(metric) if metric else False
    c.scope = q["scope"]
    c.direction = q["direction"]
    c.unit = q["unit"]

    if ctype == CLAIM_FUTURE_COMMITMENT:
        c.target_commitment = True
        c.commitment_year = q["by_year"] or q["in_year"]
        if q["zero_target"]:
            c.target_value = 0.0
        elif q["percent"] is not None:
            # "reduce by 40% by 2030" -> a relative target, not an absolute one
            c.claimed_change_percent = (
                -q["percent"] if q["direction"] != "increase" else q["percent"]
            )
        elif q["absolute_value"] is not None:
            c.target_value = q["absolute_value"]
        c.baseline_year = q["baseline_year"]
    else:
        c.baseline_year = q["baseline_year"]
        # For a historical claim "by 2023" is the OUTCOME year, not a pledge year.
        c.comparison_year = q["in_year"] or q["by_year"]
        if q["percent"] is not None:
            c.claimed_change_percent = (
                -q["percent"] if q["direction"] != "increase" else q["percent"]
            )
        elif q["zero_target"] and ctype in (CLAIM_HISTORICAL_REDUCTION,):
            c.claimed_change_percent = -100.0
        if q["absolute_value"] is not None:
            c.claimed_value = q["absolute_value"]

    # slot bookkeeping -> extract_confidence (a coverage ratio, not a probability)
    required = _REQUIRED_SLOTS.get(ctype, ["metric"])
    filled, missing = [], []
    for slot in required:
        if getattr(c, slot, None) is not None:
            filled.append(slot)
        else:
            missing.append(slot)
    c.extracted_slots = filled
    c.missing_slots = missing
    c.extract_confidence = round(len(filled) / len(required), 3) if required else 0.0
    c.evidence_requirements = list(_EVIDENCE_REQUIREMENTS.get(ctype, []))

    if inherited_metric:
        c.extraction_notes.append(
            f"Metric '{metrics.label(metric)}' was inherited from the preceding "
            "clause in the same sentence; this clause did not name it."
        )
    if ctype == CLAIM_FUTURE_COMMITMENT:
        if (_ONGOING.search(clause) and q["by_year"] is None
                and q["percent"] is None and q["absolute_value"] is None):
            # "we are investing in renewable energy": an activity statement with
            # no quantity and no deadline. There is nothing numeric to project,
            # so do not imply a trajectory assessment that will not happen.
            c.extraction_notes.append(
                "States ongoing activity with no quantity and no deadline, so "
                "there is no numeric target to assess against observations."
            )
        else:
            c.extraction_notes.append(
                "Forward-looking commitment: it states an intention, so it cannot "
                "be true or false yet and is assessed against the observed "
                "trajectory."
            )
    if q["by_year"] and ctype != CLAIM_FUTURE_COMMITMENT:
        c.extraction_notes.append(
            f"'by {q['by_year']}' read as the outcome year of a completed change."
        )
    return c


# --------------------------------------------------------------------------
# Public entry point
# --------------------------------------------------------------------------

def build_claims(text, detector="rules", candidate_filter=None):
    """
    Text -> list of atomic `schema.Claim`.

    `candidate_filter` is an optional callable `sentence -> (bool, score)` used
    to let a learned detector decide which sentences are environmental claims.
    When it is None, a sentence qualifies if it mentions a known metric. Either
    way the decomposition and slot extraction below are identical, so a claim's
    structure never depends on which detector found it.
    """
    claims = []
    for sentence in split_sentences(text):
        score = None
        if candidate_filter is not None:
            keep, score = candidate_filter(sentence)
            if not keep:
                continue
        elif metrics.primary_metric(sentence) is None:
            continue

        last_metric = None
        for clause in split_clauses(sentence):
            q = extract_quantities(clause)
            m = metrics.primary_metric(clause)
            inherited = False
            if m is None and last_metric is not None:
                m, inherited = last_metric, True
            if m is None:
                continue
            last_metric = m

            # A clause with no number and no achievement verb is framing, not a
            # checkable claim ("reducing flaring is central to our roadmap").
            has_number = any(q[k] is not None for k in
                             ("percent", "by_year", "in_year", "absolute_value"))
            if not (has_number or _PAST.search(clause) or _FUTURE.search(clause)
                    or _ONGOING.search(clause)):
                continue

            c = _build(clause, sentence, q, m, inherited_metric=inherited)
            c.detector = detector
            c.detector_score = score
            claims.append(c)
    return claims
