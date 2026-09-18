"""
Build data/dataset_registry.json and data/DATASETS.md.

    python3 scripts/build_dataset_registry.py

Documents every dataset the project actually uses. Row counts, entity counts and
year ranges are read from the files on disk, so the registry cannot drift from
reality; the descriptive metadata (provider, licence, resolution, limitations) is
transcribed from each dataset's own documentation.

One rule this file exists to enforce: **a dataset is only marked independent when
it comes from a different instrument.** The field-level and country-level flaring
series both derive from the same VIIRS programme, so they are recorded as sharing
an instrument, and nothing in the project may describe their agreement as
independent corroboration.
"""

import csv
import json
import os
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
JSON_OUT = ROOT / "data" / "dataset_registry.json"
MD_OUT = ROOT / "data" / "DATASETS.md"

VIIRS = "VIIRS (Suomi-NPP / NOAA-20)"
TROPOMI = "TROPOMI (Sentinel-5P)"


def file_facts(rel, key_col, year_col="year"):
    p = ROOT / rel
    if not p.exists():
        return dict(present=False, path=rel)
    rows = list(csv.DictReader(p.open(encoding="utf-8")))
    years = sorted({int(r[year_col]) for r in rows
                    if r.get(year_col, "").strip().isdigit()})
    return dict(
        present=True, path=rel, rows=len(rows),
        columns=list(rows[0].keys()),
        entities=len({r[key_col] for r in rows if r.get(key_col)}),
        year_min=years[0] if years else None,
        year_max=years[-1] if years else None,
        bytes=p.stat().st_size,
        source_label=next((r["source"] for r in rows if r.get("source")), None),
        file_modified=date.fromtimestamp(p.stat().st_mtime).isoformat(),
    )


DATASETS = [
    {
        "id": "worldbank_gfmr_flaring_field",
        "name": "World Bank Global Gas Flaring Tracker — individual flare locations",
        "provider": "World Bank, Global Flaring and Methane Reduction (GFMR) Partnership",
        "produced_with": ("Earth Observation Group, Payne Institute for Public Policy, "
                          "Colorado School of Mines, with NOAA"),
        "instrument": VIIRS,
        "instrument_family": "viirs_gfmr",
        "official_url": ("https://www.worldbank.org/en/programs/gasflaringreduction/"
                         "global-flaring-data"),
        "documentation_url": ("https://www.worldbank.org/en/programs/"
                              "gasflaringreduction/global-flaring-data"),
        "licence": ("Published publicly by the World Bank, with the attribution \"Flare gas "
                    "volumes - NOAA, the Payne Institute at the Colorado School of Mines, "
                    "World Bank/GFMR\" and no separate licence stated. This project commits "
                    "only the derived per-field and per-country CSVs the app reads, with that "
                    "attribution; the raw downloads are not committed."),
        "measures": "Flared gas volume inferred from radiant heat at detected flare sites",
        "variables": ["flare latitude", "flare longitude", "annual flared volume (BCM)"],
        "spatial_resolution": ("Individual flare detections; aggregated here to named "
                              "fields by a per-field match radius (60–200 km)"),
        "temporal_resolution": "annual",
        "geographic_coverage": "global",
        "access_method": "direct HTTPS download of the published .xlsx, no account",
        "processing": ("notebooks/03: flares within a field's match radius are summed "
                       "per field per year."),
        "role_in_greentruth": "PRIMARY EVIDENCE for gas-flaring claims",
        "limitations": [
            "A flare near a field is consistent with activity there; it does not "
            "establish that a particular operator caused it.",
            "Radius grouping is coarse and can include or exclude flares near a boundary.",
            "VIIRS has a detection threshold, so small flares may be missed and "
            "volumes are estimates rather than metered values.",
            "Annual resolution cannot resolve within-year timing.",
        ],
        "file": "data/real/flaring_by_field.csv",
        "_facts": ("data/real/flaring_by_field.csv", "field"),
    },
    {
        "id": "worldbank_gfmr_flaring_country",
        "name": "World Bank Global Gas Flaring Tracker — country totals",
        "provider": "World Bank, Global Flaring and Methane Reduction (GFMR) Partnership",
        "produced_with": ("Earth Observation Group, Payne Institute, "
                          "Colorado School of Mines, with NOAA"),
        "instrument": VIIRS,
        "instrument_family": "viirs_gfmr",
        "official_url": ("https://www.worldbank.org/en/programs/gasflaringreduction/"
                         "global-flaring-data"),
        "documentation_url": ("https://www.worldbank.org/en/programs/"
                              "gasflaringreduction/global-flaring-data"),
        "licence": "Published publicly by the World Bank.",
        "measures": "National annual flared gas volume",
        "variables": ["country", "annual flared volume (BCM)"],
        "spatial_resolution": "national total",
        "temporal_resolution": "annual",
        "geographic_coverage": "global",
        "access_method": "direct HTTPS download of the published .xlsx, no account",
        "processing": "Country totals used as published.",
        "role_in_greentruth": ("CROSS-SCALE CONTEXT. Same instrument as the field "
                               "series, so agreement is NOT independent corroboration."),
        "limitations": [
            "Aggregates every operator and sector in the country, so it cannot be "
            "attributed to one company or site.",
            "Shares the VIIRS instrument and processing chain with the field series; "
            "their agreement is weaker evidence than two instruments would give.",
        ],
        "file": "data/real/flaring_by_country.csv",
        "_facts": ("data/real/flaring_by_country.csv", "country"),
    },
    {
        "id": "sentinel5p_ch4",
        "name": "Sentinel-5P / TROPOMI methane (OFFL L3 CH4)",
        "provider": "Copernicus / ESA, accessed through Google Earth Engine",
        "produced_with": "ESA / Copernicus; GEE collection COPERNICUS/S5P/OFFL/L3_CH4",
        "instrument": TROPOMI,
        "instrument_family": "tropomi_s5p",
        "official_url": ("https://developers.google.com/earth-engine/datasets/catalog/"
                         "COPERNICUS_S5P_OFFL_L3_CH4"),
        "documentation_url": "https://sentinels.copernicus.eu/web/sentinel/missions/sentinel-5p",
        "licence": ("Copernicus Sentinel data, free and open under the Copernicus "
                    "licence; attribution required."),
        "measures": "Column-averaged dry-air mixing ratio of methane (XCH4)",
        "variables": ["field", "year", "month", "ch4_ppb"],
        "spatial_resolution": "~7 km ground pixel, averaged over the field radius",
        "temporal_resolution": "monthly mean of daily overpasses",
        "geographic_coverage": "global, 2019 onward",
        "access_method": ("Google Earth Engine — needs a free account and a Cloud "
                          "project id for ee.Initialize (notebook 03 Part B)"),
        "processing": ("Monthly means per field; annual means computed in "
                       "greentruth/methane.py from months with >=6 retrievals, then "
                       "referenced against a background proxy (the mean of the other "
                       "monitored fields) to remove the global trend."),
        "role_in_greentruth": ("INDEPENDENT INSTRUMENT. A different satellite "
                               "measuring a different quantity — the only genuinely "
                               "independent cross-check in the system."),
        "limitations": [
            "Regional, not per-facility: a ~7 km column cannot be attributed to one "
            "operator or flare stack.",
            "Dominated by the global background (~1900 ppb); a field's own "
            "contribution is a small perturbation, which is why the anomaly is used.",
            "Retrievals fail over water, under cloud and over low-albedo surfaces, so "
            "coverage is uneven: 9 of 12 fields usable, 3 refused.",
            "Methane and flaring are different quantities. Flaring destroys methane "
            "and venting releases it, so the channels can legitimately diverge.",
        ],
        "file": "data/real/methane_by_field_s5p.csv",
        "_facts": ("data/real/methane_by_field_s5p.csv", "field"),
    },
    {
        "id": "worldbank_gfmr_flaring_operator",
        "name": "World Bank Global Gas Flaring Tracker — operator totals",
        "provider": "World Bank, GFMR Partnership",
        "instrument": VIIRS,
        "instrument_family": "viirs_gfmr",
        "official_url": ("https://www.worldbank.org/en/programs/gasflaringreduction/"
                         "global-flaring-data"),
        "licence": "Published publicly by the World Bank.",
        "measures": "Flared gas volume attributed to named operators",
        "variables": ["operator", "year", "volume"],
        "spatial_resolution": "operator aggregate",
        "temporal_resolution": "annual",
        "geographic_coverage": "global",
        "access_method": "direct HTTPS download, no account",
        "processing": "None — loaded but not used.",
        "role_in_greentruth": "NOT USED",
        "not_used_reason": ("Operator names in this sheet cannot be reliably matched "
                            "to the named fields GreenTruth monitors. Using it would "
                            "require a name-matching step that could silently "
                            "mis-attribute flaring to the wrong company."),
        "limitations": ["Unresolved entity linkage; see not_used_reason."],
        "file": "data/real/flaring_by_operator.csv",
        "_facts": ("data/real/flaring_by_operator.csv", "operator"),
    },
    {
        "id": "climatebert_environmental_claims",
        "name": "climatebert/environmental_claims",
        "provider": "Stammbach, Webersinke, Bingler, Kraus, Leippold (ACL 2023)",
        "instrument": "n/a — text corpus",
        "instrument_family": "text",
        "official_url": "https://huggingface.co/datasets/climatebert/environmental_claims",
        "documentation_url": "https://arxiv.org/abs/2209.00507",
        "licence": "CC BY-NC-SA 4.0 (non-commercial)",
        "measures": ("Whether a sentence from a corporate disclosure is an "
                     "environmental claim"),
        "variables": ["text", "label"],
        "spatial_resolution": "n/a",
        "temporal_resolution": "n/a",
        "geographic_coverage": "listed-company disclosures, English",
        "access_method": "Hugging Face datasets / datasets-server HTTP API, no token",
        "processing": "Test split used as published for evaluation (notebook 02).",
        "role_in_greentruth": "Training and evaluation data for the claim detector",
        "limitations": [
            "English, listed-company financial and sustainability text; domain shift "
            "is likely elsewhere.",
            "Labels whether a sentence IS a claim, not whether the claim is true.",
            "The detector was fine-tuned on its train split, so evaluation on its "
            "test split is in-domain.",
        ],
        "file": None,
        "_facts": None,
        "n_test": 265,
    },
    {
        "id": "natural_earth_110m",
        "name": "Natural Earth 1:110m Cultural Vectors — Admin 0 Countries",
        "provider": "Natural Earth",
        "instrument": "n/a — cartographic boundaries",
        "instrument_family": "basemap",
        "official_url": ("https://www.naturalearthdata.com/downloads/"
                         "110m-cultural-vectors/"),
        "documentation_url": "https://www.naturalearthdata.com/about/terms-of-use/",
        "licence": "Public domain. No permission or attribution required.",
        "measures": "Country boundary polygons",
        "variables": ["name", "iso", "geometry"],
        "spatial_resolution": "1:110m",
        "temporal_resolution": "static",
        "geographic_coverage": "global",
        "access_method": "committed to the repository (public domain, 169 KB)",
        "processing": ("Coordinates rounded to 2 dp (~1 km) and duplicate points "
                       "removed to reduce payload. No boundary redrawn."),
        "role_in_greentruth": ("Map backdrop only. No analysis depends on it and no "
                               "reported value is derived from it."),
        "limitations": ["Cartographic only; carries no environmental measurement."],
        "file": "data/geo/world_110m.json",
        "_facts": None,
    },
]


def main():
    out = []
    for d in DATASETS:
        rec = {k: v for k, v in d.items() if not k.startswith("_")}
        if d.get("_facts"):
            rel, key = d["_facts"]
            rec["file_facts"] = file_facts(rel, key)
        rec["date_accessed"] = (rec.get("file_facts", {}) or {}).get(
            "file_modified", date.today().isoformat())
        rec["date_accessed_note"] = ("local file timestamp, a proxy for when the "
                                     "pipeline notebook was run")
        out.append(rec)

    fams = {}
    for r in out:
        fams.setdefault(r["instrument_family"], []).append(r["id"])
    shared = {k: v for k, v in fams.items() if len(v) > 1}

    registry = dict(
        generated_by="scripts/build_dataset_registry.py",
        generated_on=date.today().isoformat(),
        independence_rule=(
            "Two datasets are independent only if they come from different "
            "instruments. Datasets sharing an instrument_family share an "
            "instrument and a processing chain, so their agreement must never be "
            "described as independent corroboration."),
        shared_instrument_families=shared,
        datasets=out,
    )
    JSON_OUT.write_text(json.dumps(registry, indent=2), encoding="utf-8")

    # ---- markdown ----
    L = ["# Real datasets used by GreenTruth", "",
         f"Generated by `scripts/build_dataset_registry.py` on {registry['generated_on']}.",
         "Row counts and year ranges are read from the files on disk; descriptive",
         "metadata is transcribed from each dataset's own documentation.", "",
         "## Independence", "",
         registry["independence_rule"], ""]
    for fam, ids in shared.items():
        L.append(f"* **`{fam}`** is shared by: {', '.join('`' + i + '`' for i in ids)} "
                 f"— these are **not** independent of each other.")
    L += ["", "---", ""]

    for r in out:
        L.append(f"## {r['name']}")
        L.append("")
        ff = r.get("file_facts") or {}
        rows = [("Provider", r["provider"]),
                ("Instrument", r["instrument"]),
                ("Role in GreenTruth", r["role_in_greentruth"]),
                ("Measures", r["measures"]),
                ("Variables", ", ".join(r["variables"])),
                ("Spatial resolution", r["spatial_resolution"]),
                ("Temporal resolution", r["temporal_resolution"]),
                ("Geographic coverage", r["geographic_coverage"]),
                ("Access method", r["access_method"]),
                ("Licence", r["licence"]),
                ("Official URL", r["official_url"]),
                ("Documentation", r.get("documentation_url", "—")),
                ("Processing", r["processing"]),
                ("File", r.get("file") or "—"),
                ("Date accessed", f"{r['date_accessed']} ({r['date_accessed_note']})")]
        if ff.get("present"):
            rows.insert(3, ("Loaded", f"{ff['rows']:,} rows, {ff['entities']} entities, "
                                      f"{ff['year_min']}–{ff['year_max']}"))
        elif r.get("n_test"):
            rows.insert(3, ("Loaded", f"test split n = {r['n_test']}"))
        L.append("| | |")
        L.append("|---|---|")
        for k, v in rows:
            L.append(f"| **{k}** | {v} |")
        L.append("")
        if r.get("not_used_reason"):
            L.append(f"> **Not used.** {r['not_used_reason']}")
            L.append("")
        L.append("**Limitations**")
        L.append("")
        for lim in r["limitations"]:
            L.append(f"* {lim}")
        L += ["", "---", ""]

    MD_OUT.write_text("\n".join(L), encoding="utf-8")
    print(f"wrote {JSON_OUT.relative_to(ROOT)}")
    print(f"wrote {MD_OUT.relative_to(ROOT)}")
    print(f"  {len(out)} datasets; shared instrument families: {shared}")


if __name__ == "__main__":
    main()
