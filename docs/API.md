# GreenTruth API

Standard library only. No authentication, no API key, no rate limit.
All responses are JSON, UTF-8, `Cache-Control: no-store`.

```bash
python3 server.py 8000      # http://localhost:8000
```

CORS is off by default (same-origin). Set `GREENTRUTH_CORS_ORIGIN` to serve the
frontend from a different origin in development.

---

## `GET /api/health`

```json
{
  "status": "ok",
  "has_real_data": true,
  "n_fields": 12,
  "n_observations": 156,
  "detector": {"detector": "rule_based", "fallback": true, "reason": "…"}
}
```

Use `has_real_data` to tell "running" from "running with evidence".

---

## `GET /api/meta`

Fields, unit, coverage and the detector in use. `companies` is the legacy name
for the field display names and is kept for backward compatibility.

```json
{
  "companies": ["Permian Basin", "Bakken", "…"],
  "fields":    ["Permian Basin", "Bakken", "…"],
  "unit": "billion m3 flared per year",
  "has_real_data": true,
  "claim_source": "Public flaring commitments come from …",
  "coverage": {
    "n_fields": 12, "n_observations": 156,
    "year_min": 2012, "year_max": 2024, "n_countries": 99,
    "source_label": "World Bank Global Gas Flaring Tracker (VIIRS) — REAL",
    "data_file_modified": "2026-09-17",
    "data_file_modified_note": "local file timestamp; a proxy for when the pipeline notebook was run, not a dataset release date"
  },
  "detector": {"detector": "rule_based", "fallback": true, "reason": "…"},
  "unavailable_channels": {"sentinel5p_methane_partial": {"why_unavailable": "…", "if_enabled": "…"}},
  "verdict_vocabulary": [{"id": "abstain", "label": "Abstain / uncertain",
                          "meaning": "Observations exist, but …", "is_abstention": true}]
}
```

`unavailable_channels` is the same block `/api/analyze` returns, available before
any analysis runs. `verdict_vocabulary` is read from `schema.py`, so a client never
re-declares the verdict wording.

---

## `GET /api/fields`

Every monitored field with real coordinates and observation coverage.

```json
{"fields": [{
  "id": "us_bakken", "name": "Bakken", "country": "United States",
  "lat": 47.8, "lon": -103.3, "match_radius_km": 150,
  "n_observations": 13, "year_min": 2012, "year_max": 2024,
  "first_value": 4.1566, "latest_value": 2.29274,
  "unit": "billion m3 flared per year",
  "country_series_key": "United States", "has_country_series": true, "n_country_years": 13
}], "unit": "billion m3 flared per year"}
```

`country_series_key` is the national series the field is cross-checked against
(`null` when none resolves); the same two keys are on each `/api/map` feature.

---

## `GET /api/fields/{id}/observations`

One field's real annual series with full provenance. `404` for an unknown id.

```json
{
  "field": {"id": "us_bakken", "name": "Bakken", "...": "..."},
  "has_data": true,
  "observations": {
    "dataset_id": "worldbank_gfmr_flaring",
    "dataset_name": "World Bank Global Gas Flaring Tracker",
    "provider": "World Bank — Global Flaring and Methane Reduction (GFMR) Partnership",
    "measurement_type": "VIIRS-based gas flaring volume estimate",
    "official_url": "https://www.worldbank.org/en/programs/gasflaringreduction/global-flaring-data",
    "licence": "Public data published by the World Bank; …",
    "unit": "billion m3 flared per year",
    "value_provenance": "observed",
    "years":  [2012, "…", 2024],
    "values": [4.1566, "…", 2.29274],
    "spatial_resolution": "individual detected flare locations, aggregated here to named fields by radius",
    "temporal_resolution": "annual",
    "processing": "Individual flare locations matched to a named field …",
    "limitations": ["A flare detected near a field is consistent with activity there; …"],
    "coordinates": {"lat": 47.8, "lon": -103.3},
    "access_date": "2026-09-17"
  }
}
```

`value_provenance` is always one of `observed` / `estimated` / `projected` /
`uncertain`. Never render a `projected` value in the style of an `observed` one.

---

## `GET /api/map`

GeoJSON `FeatureCollection` of the monitored fields, each with its full annual
series so the year slider needs no further requests.

```json
{"type": "FeatureCollection",
 "features": [{
   "type": "Feature",
   "geometry": {"type": "Point", "coordinates": [-103.3, 47.8]},
   "properties": {"id": "us_bakken", "name": "Bakken", "country": "United States",
                  "years": [2012, "…"], "values": [4.1566, "…"],
                  "latest_year": 2024, "latest_value": 2.29274, "has_data": true}}],
 "source": {"dataset": "World Bank Global Gas Flaring Tracker", "url": "…"}}
```

## `GET /api/basemap`

Natural Earth 1:110m country outlines (public domain), served from disk so the
map works offline. See `data/geo/README.md`.

## `GET /api/demo`

```json
{"text": "We reduced routine gas flaring by 40% …", "is_demo": true,
 "suggested_field": "Bakken",
 "note": "Demo claim written to exercise the pipeline. It is not a quotation from any real company report. The evidence it is checked against is real."}
```

---

## `POST /api/analyze`

```json
{"text": "We reduced routine gas flaring by 40% from 2019 levels and will eliminate routine flaring by 2030.",
 "company": "Bakken"}
```

`text` is required. `company` is a field display name, id or country; omit it and
GreenTruth tries to detect one from the text. Body limit 1 MB.

Errors: `400` empty/invalid body · `413` too large · `500` analysis failed
(message is a type name only — no stack trace is returned).

### Response

```json
{
  "company": "Bakken",
  "field": {"id": "us_bakken", "name": "Bakken", "lat": 47.8, "lon": -103.3, "…": "…"},
  "field_candidates": ["Bakken"],
  "field_ambiguous": false,
  "detector": {"detector": "rule_based", "fallback": true, "reason": "…"},
  "coverage": { "…": "…" },
  "unavailable_channels": {"sentinel5p_methane": {"why_unavailable": "…", "if_enabled": "…"}},
  "summary": {
    "total": 4, "with_sufficient_evidence": 1, "needing_more_evidence": 3,
    "abstentions": 3, "future_commitments": 2,
    "by_verdict": {"abstain": 1, "trajectory_inconsistent": 1, "no_signal": 2}
  },
  "claims": [ "…" ]
}
```

There is deliberately **no overall score**. A scalar would hide exactly the
distinction the project exists to make.

### A claim

```json
{
  "id": "C01",
  "text": "We reduced routine gas flaring by 40% from 2019 levels",
  "verdict": "abstain",
  "verdict_label": "Abstain / uncertain",
  "verdict_meaning": "Observations exist, but the uncertainty interval cannot reliably distinguish between the competing interpretations of the claim.",
  "is_abstention": true,
  "rationale": "Observed 63% lower in 2024 than 2019 … But the 90% interval runs from -70% to 88% …",

  "claim": {
    "claim_type": "historical_reduction",
    "claim_type_label": "Historical reduction",
    "metric": "gas_flaring", "metric_supported": true,
    "claimed_change_percent": -40.0,
    "baseline_year": 2019, "comparison_year": null,
    "commitment_year": null, "target_value": null,
    "scope": "routine", "direction": "reduce",
    "extract_confidence": 0.75,
    "extract_confidence_kind": "slot_coverage_ratio",
    "extracted_slots": ["metric", "claimed_change_percent", "baseline_year"],
    "missing_slots": ["comparison_year"],
    "extraction_notes": ["…"],
    "detector": "rule_based", "detector_score": null
  },

  "analysis": {
    "baseline_year": 2019, "comparison_year": 2024,
    "baseline_value": 6.168277, "comparison_value": 2.29274,
    "observed_change": -0.628288, "claimed_change": -0.4,
    "interval": [-0.699184, 0.884876],
    "interval_kind": "residual_bootstrap_90",
    "interval_note": "Residual bootstrap around the fitted annual trend … not a calibrated confidence interval.",
    "flat_band": 0.05,
    "region_low": 0, "region_high": 3, "region_span": 3,
    "interval_spans_decision_regions": true,
    "decision_margin": 0.289,
    "decision_margin_kind": "heuristic: distance from the nearest decision boundary, in interval half-widths. Not a probability and not calibrated.",
    "assumptions": ["outcome year taken as 2024 (latest observation)"]
  },

  "trajectory": null,

  "sufficiency": {
    "sufficient": false,
    "summary": "Evidence insufficient: The 90% interval (-70% to +88%) spans materially different outcomes …",
    "n_pass": 6, "n_warn": 2, "n_fail": 1,
    "reasons": ["attribution_limitation", "no_independent_corroboration", "uncertainty_too_large"],
    "blocking_reasons": ["uncertainty_too_large"],
    "checks": [{"key": "metric", "label": "Claim metric identified",
                "status": "pass", "symbol": "✓", "detail": "Identified as Gas flaring."}]
  },

  "evidence_chain": [{"step": "report", "label": "Report text", "status": "ok",
                      "detail": "…", "meta": {"…": "…"}}],
  "evidence": { "…same shape as /api/fields/{id}/observations…" }
}
```

### Verdicts

| value | meaning |
|---|---|
| `supported` | observed change consistent with the claim |
| `partially_supported` | change in the claimed direction, smaller than claimed |
| `contradicted` | observed change not consistent with the claim |
| `insufficient_evidence` | observations do not cover what the claim asserts |
| `no_signal` | no observation channel for this metric |
| `abstain` | observations exist; the interval cannot decide |
| `needs_clarification` | claim not resolvable without guessing |
| `trajectory_consistent` | pledge: on a path toward the target |
| `trajectory_uncertain` | pledge: cannot distinguish |
| `trajectory_inconsistent` | pledge: not on a path toward the target |

The last five are `is_abstention: true` — legitimate "we do not know" outcomes,
not failures. Verdicts are consistency statements about observations; they are
never statements about intent or honesty.

### Trajectory block (commitments only)

```json
{"feasible": true, "verdict": "trajectory_inconsistent",
 "reasoning": "Extrapolating the observed 2012-2024 trend, the entire 90% projection interval at 2030 (0.21 to 3.84) lies above the target of 0.00.",
 "method": "ordinary least squares on the annual series, extrapolated …",
 "method_caveat": "Linear extrapolation cannot anticipate policy changes …",
 "observed":  [{"year": 2012, "value": 4.1566, "provenance": "observed"}],
 "projected": [{"year": 2025, "value": 2.17, "lower": 1.1, "upper": 3.2, "provenance": "projected"}],
 "required":  [{"year": 2025, "value": 1.91, "provenance": "required"}],
 "target": {"year": 2030, "value": 0.0, "basis": "absolute", "provenance": "target"},
 "projection_at_target": {"value": 1.93598, "lower": 0.212118, "upper": 3.844591},
 "observed_annual_rate": -0.125088, "required_annual_rate": -0.382123}
```

When `feasible` is `false` the block carries only `reason` and a
`trajectory_uncertain` verdict.

---

## Notes for clients

- **Never display a `projected` value in the style of an `observed` one.** Every
  point carries `provenance` precisely so this is easy to get right.
- **There is no `confidence` field.** Nothing here is calibrated; do not
  synthesise a percentage from `decision_margin`.
- **`abstain` is a success.** Render it as a result, not as an error.
- **Surface `field_ambiguous`.** When true, the analysed field was one of several
  candidates and the choice was not evidence-based.
- **Honour `detector.fallback`.** If true, no model inference ran.
