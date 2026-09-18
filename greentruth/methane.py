"""
Sentinel-5P / TROPOMI methane — the one genuinely independent instrument.

Unlike the field-vs-country check in `corroboration.py`, which compares two views
derived from the SAME VIIRS programme, this is a different satellite measuring a
different physical quantity: the column-averaged atmospheric CH4 mixing ratio.
Agreement here means more than agreement there.

The science that makes naive corroboration wrong
------------------------------------------------
It is tempting to say "flaring fell, so methane should fall too". That is
backwards often enough to be dangerous:

  * Flaring COMBUSTS methane, converting CH4 to CO2. Efficient flaring therefore
    *reduces* methane emissions. More flaring can mean less methane.
  * The alternative to flaring is often VENTING — releasing the gas unburned.
    A field that stops flaring and starts venting shows falling flaring and
    RISING methane. That is the worst real-world outcome, and it looks like
    success on the flaring channel alone.
  * So "flaring down + methane down" and "flaring down + methane up" mean very
    different things, and only the second is detectable by adding this channel.

That asymmetry is exactly why this channel is worth having, and exactly why it
must never be reduced to a simple agree/disagree flag.

What TROPOMI can and cannot support here
----------------------------------------
  * ~7 km ground resolution: this is a REGIONAL signal, not a facility measurement.
  * The column is dominated by the global background (~1900 ppb). A single field
    contributes a small perturbation on top of it, so a few-ppb change is not
    attributable to one operator.
  * Retrievals fail over water, under cloud, and over low-albedo surfaces, so
    coverage is very uneven. Measured completeness (notebook 03): 9 of 12 fields
    at >=60% of possible months; Niger Delta, Cantarell and Lake Maracaibo far
    below that, the latter two with no data before 2022.

Everything below therefore gates on measured retrieval completeness and reports
a regional trend with an explicit non-attribution statement. It never issues a
verdict and never overrides the flaring result.
"""

import csv
import os
from collections import defaultdict

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REAL_METHANE = os.path.join(BASE, "data", "real", "methane_by_field_s5p.csv")

# Minimum share of possible months in a year before that year's mean is used.
MIN_MONTHS_PER_YEAR = 6
# Minimum overall retrieval completeness before the channel is offered at all.
MIN_COMPLETENESS = 0.60
# A change in the regional column smaller than this is treated as flat. The
# background is ~1900 ppb and interannual regional variation is small, so this
# is deliberately tight in relative terms.
FLAT_BAND_PPB = 5.0

# Relationship classes. Note these describe the OBSERVED PATTERN, never a cause.
BOTH_DOWN = "both_down"
FLARING_DOWN_METHANE_UP = "flaring_down_methane_up"
FLARING_UP_METHANE_DOWN = "flaring_up_methane_down"
BOTH_UP = "both_up"
METHANE_FLAT = "methane_flat"
UNAVAILABLE = "unavailable"

LABELS = {
    BOTH_DOWN: "Methane also fell",
    FLARING_DOWN_METHANE_UP: "Methane rose while flaring fell",
    FLARING_UP_METHANE_DOWN: "Methane fell while flaring rose",
    BOTH_UP: "Methane also rose",
    METHANE_FLAT: "Regional methane essentially flat",
    UNAVAILABLE: "Methane cross-check unavailable",
}

DATASET = dict(
    id="sentinel5p_ch4",
    name="Sentinel-5P / TROPOMI methane (OFFL L3 CH4)",
    provider="Copernicus / ESA, accessed via Google Earth Engine",
    measurement_type="column-averaged dry-air CH4 mixing ratio",
    instrument="TROPOMI aboard Sentinel-5P",
    official_url=("https://developers.google.com/earth-engine/datasets/catalog/"
                  "COPERNICUS_S5P_OFFL_L3_CH4"),
    licence=("Copernicus Sentinel data, free and open under the Copernicus "
             "licence; attribution required."),
    unit="ppb",
    spatial_resolution="~7 km ground pixel, aggregated over a field radius",
    temporal_resolution="monthly mean of daily overpasses",
    temporal_coverage="2019-2024 in this deployment",
    processing=("Monthly means of the OFFL L3 CH4 product over each field's match "
                "radius (notebooks/03_real_satellite_data_pipeline.ipynb, Part B), "
                "then averaged to annual means here."),
    limitations=[
        "Regional, not per-facility: a ~7 km column cannot be attributed to one "
        "operator or one flare stack.",
        "Dominated by the global background (~1900 ppb); a field's own "
        "contribution is a small perturbation on top of it.",
        "Retrievals fail over water, under cloud and over low-albedo surfaces, so "
        "coverage is uneven and some fields have very few usable months.",
        "Methane and flaring are not the same quantity. Flaring destroys methane, "
        "and venting releases it, so the two channels can legitimately move in "
        "opposite directions.",
    ],
)


class MethaneEvidence:
    """Loads the real Sentinel-5P series, or reports plainly that it is absent."""

    def __init__(self, path=REAL_METHANE):
        self.path = path
        self.monthly = defaultdict(list)        # field -> [(year, month, ppb)]
        self.available = False
        self.source_label = None
        self._load()

    def _load(self):
        if not os.path.exists(self.path):
            return
        with open(self.path, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                try:
                    self.monthly[row["field"]].append(
                        (int(row["year"]), int(row["month"]), float(row["ch4_ppb"])))
                except (KeyError, ValueError, TypeError):
                    continue
                if self.source_label is None and row.get("source"):
                    self.source_label = row["source"].strip()
        self.available = any(self.monthly.values())

    # -- series ----------------------------------------------------------

    def annual(self, field_id):
        """
        {year: mean ppb} using only years with enough monthly retrievals.

        A year built from two cloudy months is not a year's mean, so it is
        dropped rather than averaged in.
        """
        buckets = defaultdict(list)
        for y, _m, v in self.monthly.get(field_id, []):
            buckets[y].append(v)
        return {y: sum(vs) / len(vs) for y, vs in buckets.items()
                if len(vs) >= MIN_MONTHS_PER_YEAR}

    def completeness(self, field_id):
        """Share of possible months actually retrieved, across the loaded span."""
        rows = self.monthly.get(field_id, [])
        if not rows:
            return 0.0
        years = {y for y, _, _ in rows}
        all_years = {y for f in self.monthly for y, _, _ in self.monthly[f]}
        span = (max(all_years) - min(all_years) + 1) if all_years else len(years)
        return len(rows) / (span * 12)

    def usable(self, field_id):
        return (self.available
                and self.completeness(field_id) >= MIN_COMPLETENESS
                and len(self.annual(field_id)) >= 2)

    # -- background referencing ------------------------------------------
    # Atmospheric methane is RISING GLOBALLY: roughly 1875 ppb in 2019 to about
    # 1930 ppb in 2024. Measured naively, every single monitored field shows
    # methane going up by +35 to +52 ppb over that window — which would read as
    # "flaring fell but methane rose" everywhere, i.e. venting everywhere. That
    # conclusion would be an artefact of the global trend, not a finding.
    #
    # So the field-level signal is the ANOMALY: how the field's column moved
    # relative to the background. The background is estimated here as the mean
    # across all usable monitored fields, which span four continents and are
    # therefore a reasonable proxy for the global trend. It is a proxy, and it is
    # labelled as one wherever it surfaces.

    def background_annual(self, exclude=None):
        """{year: mean ppb across usable fields}, used as a background proxy."""
        buckets = defaultdict(list)
        for fid in self.monthly:
            if fid == exclude or not self.usable(fid):
                continue
            for y, v in self.annual(fid).items():
                buckets[y].append(v)
        return {y: sum(vs) / len(vs) for y, vs in buckets.items() if len(vs) >= 3}

    def anomaly_annual(self, field_id):
        """{year: field ppb - background ppb}. The field-specific part."""
        ann = self.annual(field_id)
        # Exclude the field itself so it cannot pull its own reference.
        bg = self.background_annual(exclude=field_id)
        return {y: ann[y] - bg[y] for y in ann if y in bg}

    def coverage_report(self):
        return {f: dict(months=len(rows),
                        completeness=round(self.completeness(f), 3),
                        usable=self.usable(f),
                        years=sorted({y for y, _, _ in rows}))
                for f, rows in sorted(self.monthly.items())}

    # -- the cross-check -------------------------------------------------

    def cross_check(self, field_id, flaring_change, baseline_year, comparison_year,
                    field_name=None):
        """
        Compare the regional methane trend with the flaring change over the same
        window. Returns a descriptive block — never a verdict.
        """
        if not self.available:
            return dict(available=False, relationship=UNAVAILABLE,
                        label=LABELS[UNAVAILABLE],
                        detail=("No Sentinel-5P methane series is loaded. Run "
                                "notebooks/03_real_satellite_data_pipeline.ipynb "
                                "Part B (needs a free Earth Engine account) to "
                                "produce data/real/methane_by_field_s5p.csv."))

        comp = self.completeness(field_id)
        if comp < MIN_COMPLETENESS:
            return dict(available=False, relationship=UNAVAILABLE,
                        label=LABELS[UNAVAILABLE], completeness=round(comp, 3),
                        detail=(f"TROPOMI retrieved usable methane for only "
                                f"{comp:.0%} of the possible months at "
                                f"{field_name or field_id} — too sparse to read a "
                                f"trend. Retrievals fail over water, under cloud "
                                f"and over dark surfaces, which is why coverage "
                                f"varies so much between fields."))

        ann = self.annual(field_id)
        anom = self.anomaly_annual(field_id)
        bg = self.background_annual(exclude=field_id)
        missing = [y for y in (baseline_year, comparison_year) if y not in anom]
        if missing:
            return dict(available=False, relationship=UNAVAILABLE,
                        label=LABELS[UNAVAILABLE], completeness=round(comp, 3),
                        detail=(f"The methane series does not cover "
                                f"{', '.join(str(y) for y in missing)} with enough "
                                f"monthly retrievals (Sentinel-5P starts in 2019, "
                                f"and this field has usable years "
                                f"{sorted(ann)}). The flaring window cannot be "
                                f"matched."))

        m0, m1 = ann[baseline_year], ann[comparison_year]
        a0, a1 = anom[baseline_year], anom[comparison_year]
        raw_delta = m1 - m0
        bg_delta = bg[comparison_year] - bg[baseline_year]
        delta = a1 - a0                       # the field-specific part

        # The decision uses the ANOMALY, not the raw column, so the global
        # background rise cannot masquerade as a field-level signal.
        if abs(delta) <= FLAT_BAND_PPB:
            rel = METHANE_FLAT
        elif flaring_change is not None and flaring_change < 0:
            rel = BOTH_DOWN if delta < 0 else FLARING_DOWN_METHANE_UP
        elif flaring_change is not None and flaring_change > 0:
            rel = FLARING_UP_METHANE_DOWN if delta < 0 else BOTH_UP
        else:
            rel = METHANE_FLAT

        return dict(
            available=True,
            relationship=rel,
            label=LABELS[rel],
            detail=_explain(rel, delta, raw_delta, bg_delta, m0, m1,
                            baseline_year, comparison_year, flaring_change,
                            field_name),
            baseline_year=baseline_year,
            comparison_year=comparison_year,
            methane_baseline_ppb=round(m0, 2),
            methane_comparison_ppb=round(m1, 2),
            methane_change_ppb_raw=round(raw_delta, 2),
            background_change_ppb=round(bg_delta, 2),
            anomaly_baseline_ppb=round(a0, 2),
            anomaly_comparison_ppb=round(a1, 2),
            anomaly_change_ppb=round(delta, 2),
            uses_background_reference=True,
            background_method=("mean of the other monitored fields' annual column, "
                               "used as a proxy for the global background trend"),
            flaring_change=flaring_change,
            completeness=round(comp, 3),
            years_available=sorted(anom),
            independent_instrument=True,
            source=DATASET,
            attribution_warning=(
                "This is a regional atmospheric column at roughly 7 km, dominated "
                "by the background concentration. It indicates conditions around "
                "the field; it does not establish that any operator caused the "
                "change."),
        )


def _explain(rel, delta, raw_delta, bg_delta, m0, m1, y0, y1, flaring_change,
             field_name):
    fld = field_name or "this field"
    base = (f"Regional methane around {fld} went from {m0:.0f} to {m1:.0f} ppb "
            f"between {y0} and {y1} ({raw_delta:+.0f} ppb). Atmospheric methane is "
            f"rising globally, and the background across the other monitored fields "
            f"moved {bg_delta:+.0f} ppb over the same window, so the field-specific "
            f"part is {delta:+.0f} ppb. ")
    if rel == METHANE_FLAT:
        return base + ("Relative to the background this field did not move "
                       "materially, so the methane channel neither supports nor "
                       "challenges the flaring result. Note that the raw column "
                       "rose — reading that rise as a local emission increase would "
                       "be an artefact of the global trend.")
    if rel == BOTH_DOWN:
        return base + ("Flaring fell and the background-referenced methane anomaly fell too. That is the pattern "
                       "expected when less gas is being handled overall, and it is "
                       "the strongest corroboration this pair of instruments can "
                       "offer — though the methane signal remains regional.")
    if rel == FLARING_DOWN_METHANE_UP:
        return base + ("Flaring fell while methane rose faster than the background. This pattern is "
                       "consistent with gas being vented rather than flared — "
                       "venting releases methane, flaring burns it — but it is also "
                       "consistent with unrelated methane sources in the same "
                       "region, and at this resolution the two cannot be "
                       "separated. It is flagged because the flaring channel alone "
                       "would have read as unambiguous progress.")
    if rel == FLARING_UP_METHANE_DOWN:
        return base + ("Flaring rose while the methane anomaly fell. Because flaring "
                       "combusts methane, this combination is physically coherent "
                       "and does not indicate a measurement problem.")
    return base + ("Flaring rose and the methane anomaly rose with it, which is "
                   "consistent with more gas being handled overall.")
