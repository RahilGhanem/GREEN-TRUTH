"""
Evidence provenance: where every number came from.

Rule for the whole system: no observation reaches the interface without the
dataset, provider, official URL, licence and access date attached to it. A
verdict a reader cannot trace back to a source is not evidence, it is an
assertion.

The metadata below is transcribed from the dataset documentation already cited
in the project README and `data/real/README.md`. Nothing here is invented; the
access date is read from the `source` column the pipeline notebook writes into
the CSV, and falls back to "unknown" rather than to a guess.
"""

from dataclasses import dataclass, asdict, field as dc_field
from typing import Any, Dict, List, Optional

from .schema import OBSERVED, ESTIMATED, PROJECTED


# --------------------------------------------------------------------------
# Dataset registry
# --------------------------------------------------------------------------
# One entry per real observation channel actually wired into the application.
# Adding a dataset here without adding a provider in evidence.py does nothing —
# that is deliberate, so this file cannot advertise a source we do not read.

DATASETS = {
    "worldbank_gfmr_flaring": {
        "id": "worldbank_gfmr_flaring",
        "name": "World Bank Global Gas Flaring Tracker",
        "provider": "World Bank — Global Flaring and Methane Reduction (GFMR) Partnership",
        "produced_with": ("Earth Observation Group, Payne Institute, "
                          "Colorado School of Mines / NOAA"),
        "measurement_type": "VIIRS-based gas flaring volume estimate",
        "instrument": "VIIRS (Visible Infrared Imaging Radiometer Suite), Suomi-NPP / NOAA-20",
        "official_url": ("https://www.worldbank.org/en/programs/"
                         "gasflaringreduction/global-flaring-data"),
        "documentation_url": ("https://www.worldbank.org/en/programs/"
                              "gasflaringreduction/global-flaring-data"),
        "licence": "Public data published by the World Bank; check the portal terms before redistribution.",
        "temporal_resolution": "annual",
        "temporal_coverage": "2012-2024",
        "spatial_resolution": ("individual detected flare locations, aggregated here "
                               "to named fields by radius"),
        "geographic_coverage": "global",
        "variables_used": ["flare location (lat/lon)", "annual flared volume (billion m3)"],
        "unit": "billion m3 flared per year",
        "access_requirements": "none — public download, no account",
        "processing": ("Individual flare locations matched to a named field when within "
                       "that field's match radius, then summed per field per year "
                       "(notebooks/03_real_satellite_data_pipeline.ipynb)."),
        "limitations": [
            "A flare detected near a field is consistent with activity there; it is "
            "not proof that a particular operator caused it.",
            "Radius-based grouping is coarse and can include or exclude nearby flares "
            "at the field boundary.",
            "VIIRS has a detection threshold: very small flares may be missed, so "
            "volumes are estimates rather than metered values.",
            "Annual resolution cannot resolve within-year timing.",
        ],
    },
    "worldbank_gfmr_country": {
        "id": "worldbank_gfmr_country",
        "name": "World Bank Global Gas Flaring Tracker — country totals",
        "provider": "World Bank — Global Flaring and Methane Reduction (GFMR) Partnership",
        "produced_with": ("Earth Observation Group, Payne Institute, "
                          "Colorado School of Mines / NOAA"),
        "measurement_type": "VIIRS-based national flaring total",
        "instrument": "VIIRS, Suomi-NPP / NOAA-20",
        "official_url": ("https://www.worldbank.org/en/programs/"
                         "gasflaringreduction/global-flaring-data"),
        "documentation_url": ("https://www.worldbank.org/en/programs/"
                              "gasflaringreduction/global-flaring-data"),
        "licence": "Public data published by the World Bank; check the portal terms before redistribution.",
        "temporal_resolution": "annual",
        "temporal_coverage": "2012-2024",
        "spatial_resolution": "national total",
        "geographic_coverage": "global",
        "variables_used": ["country", "annual flared volume (billion m3)"],
        "unit": "billion m3 flared per year",
        "access_requirements": "none — public download, no account",
        "processing": "Country totals taken as published.",
        "limitations": [
            "A national total covers every operator and field in the country, so it "
            "cannot be attributed to one company or site.",
            "Useful as a context layer and a coarse cross-check, not as per-field evidence.",
        ],
    },
}

# Channels that are documented but NOT wired in, computed from what is actually
# on disk. Declaring an absence is as important as declaring a source: a reader
# should be able to see what GreenTruth could not check, not just what it could.

def unavailable_channels():
    """Observation channels that are documented but not usable right now."""
    from . import methane as methane_mod
    out = {}

    ch4 = methane_mod.MethaneEvidence()
    if not ch4.available:
        out["sentinel5p_methane"] = dict(
            name=methane_mod.DATASET["name"],
            provider=methane_mod.DATASET["provider"],
            official_url=methane_mod.DATASET["official_url"],
            why_unavailable=(
                "data/real/methane_by_field_s5p.csv is absent. Producing it needs "
                "a free Earth Engine account and notebook 03 Part B."),
            if_enabled=(
                "Would add a genuinely independent instrument: a different "
                "satellite measuring a different quantity. At ~7 km it is "
                "regional, never per-facility, and would not issue a verdict."))
    else:
        poor = [f for f in ch4.monthly if not ch4.usable(f)]
        if poor:
            out["sentinel5p_methane_partial"] = dict(
                name=methane_mod.DATASET["name"] + " (partial coverage)",
                provider=methane_mod.DATASET["provider"],
                official_url=methane_mod.DATASET["official_url"],
                why_unavailable=(
                    f"Loaded, but {len(poor)} of {len(ch4.monthly)} fields have too "
                    f"few usable TROPOMI retrievals for a trend "
                    f"(below {methane_mod.MIN_COMPLETENESS:.0%} of possible months): "
                    + ", ".join(sorted(poor)) + ". Retrievals fail over water, "
                    "under cloud and over low-albedo surfaces."),
                if_enabled=("For those fields the flaring result has no independent "
                            "instrument, and the sufficiency report says so."))

    # Channels with no pipeline at all — named so the gap is explicit.
    out["deforestation"] = dict(
        name="Forest loss (e.g. Hansen Global Forest Change)",
        provider="University of Maryland / Google Earth Engine",
        official_url=("https://developers.google.com/earth-engine/datasets/catalog/"
                      "UMD_hansen_global_forest_change_2023_v1_11"),
        why_unavailable="No pipeline is implemented. Deforestation claims return 'no signal to check'.",
        if_enabled="Would support land-use claims, which GreenTruth cannot check today.")
    return out


# Kept as a module-level snapshot for callers that want it eagerly.
UNAVAILABLE_CHANNELS = unavailable_channels()


@dataclass
class EvidenceRecord:
    """One observation, with everything needed to trace it back to its source."""

    dataset_id: str
    dataset_name: str
    provider: str
    measurement_type: str
    official_url: str
    licence: str
    unit: str
    value_provenance: str = OBSERVED         # observed | estimated | projected
    years: List[int] = dc_field(default_factory=list)
    values: List[float] = dc_field(default_factory=list)
    access_date: Optional[str] = None
    spatial_resolution: Optional[str] = None
    temporal_resolution: Optional[str] = None
    processing: Optional[str] = None
    limitations: List[str] = dc_field(default_factory=list)
    field_id: Optional[str] = None
    field_name: Optional[str] = None
    coordinates: Optional[Dict[str, float]] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def dataset_meta(dataset_id: str) -> Dict[str, Any]:
    """Registry lookup. Unknown ids raise rather than returning a plausible blank."""
    if dataset_id not in DATASETS:
        raise KeyError(
            f"Unknown dataset '{dataset_id}'. Register it in provenance.DATASETS "
            "and wire a provider in evidence.py before citing it."
        )
    return DATASETS[dataset_id]


def build_record(dataset_id, series, field_id=None, field_name=None,
                 coordinates=None, access_date=None,
                 value_provenance=OBSERVED) -> EvidenceRecord:
    """Wrap an annual {year: value} series in its provenance."""
    meta = dataset_meta(dataset_id)
    years = sorted(series)
    return EvidenceRecord(
        dataset_id=meta["id"],
        dataset_name=meta["name"],
        provider=meta["provider"],
        measurement_type=meta["measurement_type"],
        official_url=meta["official_url"],
        licence=meta["licence"],
        unit=meta["unit"],
        value_provenance=value_provenance,
        years=years,
        values=[round(float(series[y]), 6) for y in years],
        access_date=access_date,
        spatial_resolution=meta["spatial_resolution"],
        temporal_resolution=meta["temporal_resolution"],
        processing=meta["processing"],
        limitations=list(meta["limitations"]),
        field_id=field_id,
        field_name=field_name,
        coordinates=coordinates,
    )


# --------------------------------------------------------------------------
# Evidence chain
# --------------------------------------------------------------------------
# The chain is the auditable spine of a result: every step from the sentence in
# the report to the verdict, each one carrying what it used and what it could
# not establish. It is built from objects that already exist — it never
# reconstructs or re-derives a value for display.

def build_chain(claim, field_info, record, analysis, sufficiency, verdict,
                corroboration=None, methane=None) -> List[Dict[str, Any]]:
    """Ordered, clickable evidence chain. Each node is self-describing."""
    from . import metrics as metrics_mod
    from .schema import VERDICT_LABELS

    chain: List[Dict[str, Any]] = []

    chain.append(dict(
        step="report", label="Report text", status="ok",
        detail=claim.source_text or claim.raw_text,
        meta=dict(detector=claim.detector, detector_score=claim.detector_score),
    ))

    chain.append(dict(
        step="claim", label="Atomic claim", status="ok",
        detail=claim.raw_text,
        meta=dict(claim_type=claim.claim_type,
                  slot_coverage=claim.extract_confidence,
                  slot_coverage_kind=claim.extract_confidence_kind,
                  filled=claim.extracted_slots, missing=claim.missing_slots),
    ))

    chain.append(dict(
        step="metric", label="Metric",
        status="ok" if claim.metric_supported else "unavailable",
        detail=metrics_mod.label(claim.metric) if claim.metric else "not identified",
        meta=dict(metric=claim.metric, has_observation_channel=claim.metric_supported,
                  reason=None if claim.metric_supported
                  else metrics_mod.unsupported_reason(claim.metric)),
    ))

    if field_info:
        chain.append(dict(
            step="facility", label="Facility / field", status="ok",
            detail=field_info.get("name"),
            meta=dict(field_id=field_info.get("id"), country=field_info.get("country"),
                      match_radius_km=field_info.get("match_radius_km")),
        ))
        chain.append(dict(
            step="location", label="Coordinates", status="ok",
            detail=f"{field_info.get('lat')}, {field_info.get('lon')}",
            meta=dict(lat=field_info.get("lat"), lon=field_info.get("lon")),
        ))
    else:
        chain.append(dict(step="facility", label="Facility / field", status="unresolved",
                          detail="No field resolved", meta={}))

    if record is not None:
        chain.append(dict(
            step="dataset", label="Observation dataset", status="ok",
            detail=record.dataset_name,
            meta=dict(provider=record.provider, official_url=record.official_url,
                      licence=record.licence, measurement_type=record.measurement_type,
                      spatial_resolution=record.spatial_resolution,
                      temporal_resolution=record.temporal_resolution,
                      processing=record.processing, access_date=record.access_date,
                      limitations=record.limitations),
        ))
        chain.append(dict(
            step="observations", label="Observation period", status="ok",
            detail=(f"{record.years[0]}-{record.years[-1]} "
                    f"({len(record.years)} annual observations)" if record.years else "none"),
            meta=dict(years=record.years, values=record.values, unit=record.unit,
                      value_provenance=record.value_provenance),
        ))
    else:
        chain.append(dict(step="dataset", label="Observation dataset", status="unavailable",
                          detail="No observation series available", meta={}))

    if analysis:
        chain.append(dict(
            step="analysis", label="Derived comparison",
            status="ok" if analysis.get("observed_change") is not None else "unavailable",
            detail=analysis.get("summary", ""),
            meta=analysis,
        ))
        if analysis.get("interval") is not None:
            chain.append(dict(
                step="uncertainty", label="Uncertainty",
                status="ok",
                detail=analysis.get("interval_summary", ""),
                meta=dict(interval=analysis.get("interval"),
                          interval_kind=analysis.get("interval_kind"),
                          interval_note=analysis.get("interval_note")),
            ))

    if corroboration is not None:
        chain.append(dict(
            step="corroboration", label="Second source (national scale)",
            status=("conflict" if corroboration.get("is_conflict")
                    else "ok" if corroboration.get("available") else "unavailable"),
            detail=corroboration.get("detail", ""),
            meta=corroboration,
        ))

    if methane is not None:
        chain.append(dict(
            step="independent_instrument",
            label="Independent instrument (Sentinel-5P methane)",
            status=("conflict" if methane.get("relationship") ==
                    "flaring_down_methane_up"
                    else "ok" if methane.get("available") else "unavailable"),
            detail=methane.get("detail", ""),
            meta=methane,
        ))

    if sufficiency:
        chain.append(dict(
            step="sufficiency", label="Evidence sufficiency",
            status="ok" if sufficiency.get("sufficient") else "insufficient",
            detail=sufficiency.get("summary", ""),
            meta=sufficiency,
        ))

    chain.append(dict(
        step="verdict", label="Verdict", status="ok",
        detail=VERDICT_LABELS.get(verdict, verdict),
        meta=dict(verdict=verdict),
    ))
    return chain
