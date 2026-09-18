"""
Cross-scale corroboration: does a second real measurement agree?

Until now `sufficiency.py` reported "no independent corroboration" as a permanent
limitation. That was true of the *field* channel in isolation, but the repository
already carries a second real series from the same programme at a different
spatial scale — national totals — and never used it.

    field  series   VIIRS flare detections within N km of a field centre
    country series  VIIRS-derived national total for the country containing it

Comparing them is a real cross-check, and it is the honest kind: the two are
**not** independent measurements of the same quantity, so the interesting output
is not "which is right" but "do they move together, and if not, what does that
tell us".

What a divergence does and does not mean
----------------------------------------
A field can fall while its country rises. That is NOT a contradiction and NOT
evidence that either number is wrong — the field is a small subset of the
national footprint, so flaring can move between fields, or other fields can grow,
while this one declines. The reverse also holds.

So this module never issues a verdict and never overrides the field result. It
classifies the relationship, states the spatial reason both readings can be
correct at once, and hands that to the sufficiency engine as context. A claim
whose field-level support is contradicted by every other field in the same
country is a weaker claim than one where the whole basin moved together — and a
reader deserves to see which they are looking at.

The genuinely independent cross-check — Sentinel-5P methane, a different
satellite — lives in `methane.py`. This module deals only with the same-instrument
comparison across spatial scales, and never describes it as independent.
"""

from . import provenance as provenance_mod

# Relationship between the two scales.
CORROBORATES = "corroborates"            # same direction, comparable magnitude
SAME_DIRECTION = "same_direction"        # same sign, magnitudes differ materially
DIVERGES = "diverges"                    # opposite signs — the interesting case
UNCONTESTED = "uncontested"              # no second series available
NOT_COMPARABLE = "not_comparable"        # years do not line up

LABELS = {
    CORROBORATES: "Corroborated at national scale",
    SAME_DIRECTION: "Same direction, different magnitude",
    DIVERGES: "Diverges from national trend",
    UNCONTESTED: "No second source available",
    NOT_COMPARABLE: "Not comparable",
}

# Country naming differs between the facility reference and the World Bank
# country sheet. These are spelling aliases for the SAME country, not
# approximate matches — each was checked against the country series.
COUNTRY_ALIASES = {
    "Iran": "Iran, Islamic Rep.",
    "Russia": "Russian Federation",
    "Venezuela": "Venezuela, RB",
}

# A field and its country are judged to "move together" when their fractional
# changes differ by less than this. It is a reporting threshold for the
# interface, not a statistical test.
MAGNITUDE_TOL = 0.25


def resolve_country_key(country, available):
    """Map a facility-reference country name onto the country-series spelling."""
    if not country:
        return None
    if country in available:
        return country
    alias = COUNTRY_ALIASES.get(country)
    if alias and alias in available:
        return alias
    return None


def compare_scales(field_series, country_series, baseline_year, comparison_year,
                   field_name=None, country_name=None, access_date=None):
    """
    Compare a field's change with its country's change over the same window.

    Returns a dict describing the relationship, both changes, the provenance of
    the second source, and an explanation of why the two can legitimately differ.
    Returns `available=False` when there is nothing to compare against.
    """
    if not country_series:
        return dict(available=False, relationship=UNCONTESTED,
                    label=LABELS[UNCONTESTED],
                    detail=("No national series is loaded for this field's country, "
                            "so the field measurement is not cross-checked."))

    missing = [y for y in (baseline_year, comparison_year)
               if y not in field_series or y not in country_series]
    if missing:
        return dict(available=False, relationship=NOT_COMPARABLE,
                    label=LABELS[NOT_COMPARABLE],
                    detail=(f"The national series does not cover "
                            f"{', '.join(str(y) for y in missing)}, so the two scales "
                            f"cannot be compared over this window."))

    fb, fc = float(field_series[baseline_year]), float(field_series[comparison_year])
    cb, cc = float(country_series[baseline_year]), float(country_series[comparison_year])
    if abs(fb) < 1e-12 or abs(cb) < 1e-12:
        return dict(available=False, relationship=NOT_COMPARABLE,
                    label=LABELS[NOT_COMPARABLE],
                    detail="A baseline value is zero, so a percentage change is undefined.")

    field_change = (fc - fb) / fb
    country_change = (cc - cb) / cb
    share_base = fb / cb if cb else None
    share_cmp = fc / cc if cc else None

    same_sign = (field_change >= 0) == (country_change >= 0)
    gap = abs(field_change - country_change)

    if not same_sign:
        rel = DIVERGES
    elif gap <= MAGNITUDE_TOL:
        rel = CORROBORATES
    else:
        rel = SAME_DIRECTION

    detail = _explain(rel, field_change, country_change, baseline_year,
                      comparison_year, field_name, country_name,
                      share_base, share_cmp)

    meta = provenance_mod.dataset_meta("worldbank_gfmr_country")
    return dict(
        available=True,
        relationship=rel,
        label=LABELS[rel],
        detail=detail,
        field_change=round(field_change, 6),
        country_change=round(country_change, 6),
        difference=round(field_change - country_change, 6),
        baseline_year=baseline_year,
        comparison_year=comparison_year,
        field_name=field_name,
        country_name=country_name,
        field_share_of_country_baseline=(round(share_base, 6) if share_base else None),
        field_share_of_country_comparison=(round(share_cmp, 6) if share_cmp else None),
        country_values={str(baseline_year): round(cb, 6),
                        str(comparison_year): round(cc, 6)},
        second_source=dict(
            dataset_name=meta["name"], provider=meta["provider"],
            measurement_type=meta["measurement_type"],
            official_url=meta["official_url"], licence=meta["licence"],
            spatial_resolution=meta["spatial_resolution"],
            unit=meta["unit"], access_date=access_date),
        caveat=(
            "These are not independent instruments. Both series come from the same "
            "VIIRS-based World Bank programme, at different spatial scales, so "
            "agreement is weaker evidence than two independent sensors would be, "
            "and disagreement reflects spatial aggregation rather than "
            "measurement error."),
        is_conflict=(rel == DIVERGES),
    )


def _explain(rel, fchange, cchange, y0, y1, field_name, country_name,
             share_base, share_cmp):
    f = f"{fchange * 100:+.0f}%"
    c = f"{cchange * 100:+.0f}%"
    fld = field_name or "the field"
    ctry = country_name or "its country"
    share = ""
    if share_base is not None and share_cmp is not None:
        share = (f" {fld} accounted for {share_base * 100:.1f}% of the national "
                 f"total in {y0} and {share_cmp * 100:.1f}% in {y1}.")

    if rel == CORROBORATES:
        return (f"Between {y0} and {y1}, {fld} changed by {f} and {ctry} as a whole "
                f"by {c}. The two scales move together, so the field-level reading "
                f"is consistent with the wider national trend.{share}")
    if rel == SAME_DIRECTION:
        return (f"Between {y0} and {y1}, {fld} changed by {f} while {ctry} as a whole "
                f"changed by {c}. Both moved in the same direction, but the field "
                f"changed substantially more than the national total — consistent "
                f"with a field-specific effect on top of the national trend.{share}")
    # DIVERGES
    return (f"Between {y0} and {y1}, {fld} changed by {f} while {ctry} as a whole "
            f"changed by {c} — opposite directions. This is NOT a contradiction: a "
            f"single field is a small part of a national footprint, so flaring can "
            f"fall at this field while rising elsewhere in the country, or the "
            f"reverse. It does mean the field-level change does not reflect a "
            f"country-wide shift, and any claim resting on it is narrower in scope "
            f"than a national figure would suggest.{share}")
