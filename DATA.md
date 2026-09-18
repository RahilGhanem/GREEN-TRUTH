# GreenTruth — Data

Every observation GreenTruth shows comes from one of the public datasets below. There is
**no synthetic or generated environmental data** anywhere in the application: if a real
file is absent, the interface says the evidence is unavailable and shows nothing in its
place. The technical, auto-generated registry (row counts, year ranges, independence rules)
is [data/DATASETS.md](data/DATASETS.md) / `data/dataset_registry.json`.

## Five kinds of value — never blurred

| Category | What it is | Examples in GreenTruth | How the interface shows it |
|---|---|---|---|
| **Observed data** | a value taken from a source dataset | annual flared volume at a field; monthly methane column; a country's annual total | solid green line and dots; labelled *observed* |
| **Derived data** | arithmetic on observed values | % change between two years; field share of the national total; methane anomaly (field minus background) | numbers labelled with the years and the operation |
| **Model output** | produced by a trained model or a rule | "is this sentence a claim?" (ClimateBERT probability, or the rule decision); the structured claim record | labelled with the detector that produced it |
| **Projection** | extrapolation to a future year | the 2012–2024 linear trend extended to a 2030 target | dashed blue line with a hatched band; labelled *projected* — never drawn like an observation |
| **Uncertainty** | a range around a derived or projected value | 90% residual-bootstrap interval on a change; 90% projection band | interval bar and decision regions; labelled *90% interval* — never called "confidence" |

A **verdict** is a consistency statement built from the categories above ("the observed
change is consistent with the claimed change") — never a statement about intent, honesty
or who caused a change.

---

## 1. World Bank Global Gas Flaring Tracker — field series (primary evidence)

| | |
|---|---|
| **Name** | Global Gas Flaring Tracker — individual flare locations, 2012–2024 (July 2025 release) |
| **Source** | World Bank Global Flaring and Methane Reduction (GFMR) Partnership, produced with the Earth Observation Group, Payne Institute, Colorado School of Mines / NOAA — <https://www.worldbank.org/en/programs/gasflaringreduction/global-flaring-data> |
| **Purpose** | the only channel that issues verdicts |
| **Instrument** | VIIRS (Suomi-NPP / NOAA-20): flared volume estimated from radiant heat at detected flares |
| **Time range** | annual, 2012–2024 (13 years) |
| **Spatial resolution** | individual flare detections, grouped to 12 named fields by a match radius of 60–200 km |
| **Access** | direct download of the published .xlsx, no account |
| **Licence** | public World Bank data; check the portal terms before redistribution. The derived CSVs are therefore not committed. |
| **Processing** | `notebooks/03_real_satellite_data_pipeline.ipynb` sums flares within each field's radius per year → `data/real/flaring_by_field.csv` (156 rows) |
| **Limitations** | a flare near a field is consistent with activity there, not proof of who caused it; radius grouping is coarse at field edges; small flares can fall below the detection threshold, so volumes are estimates, not metered values; annual resolution hides within-year timing |

## 2. World Bank Global Gas Flaring Tracker — country totals (cross-scale context)

| | |
|---|---|
| **Name** | Flare volume and intensity estimates, 2012–2024 — national totals |
| **Source** | same programme and page as above |
| **Purpose** | compares the field's change with its country's change over the same window |
| **Time range / scale** | annual, 2012–2024 · national totals for 99 countries |
| **Access / licence** | as above |
| **Processing** | totals used as published → `data/real/flaring_by_country.csv` (1,287 rows); spelling aliases mapped explicitly (e.g. Russia → Russian Federation) |
| **Limitations** | **same instrument as the field series — not independent.** Agreement is weaker evidence than two sensors; disagreement reflects spatial scope (a field is a small part of a national footprint), not measurement error |

## 3. Sentinel-5P / TROPOMI methane (independent instrument)

| | |
|---|---|
| **Name** | Sentinel-5P OFFL L3 CH4 (`COPERNICUS/S5P/OFFL/L3_CH4`) |
| **Source** | Copernicus / ESA, accessed through Google Earth Engine — <https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S5P_OFFL_L3_CH4> |
| **Purpose** | a different satellite measuring a different quantity; flags when methane moves against flaring |
| **Time range** | monthly means, 2019–2024 |
| **Spatial resolution** | ~7 km pixels, averaged over each field's radius — a **regional** signal |
| **Access** | free Google Earth Engine account and Cloud project (notebook 03, Part B) |
| **Licence** | Copernicus Sentinel data, free and open; attribution required |
| **Processing** | monthly field means → `data/real/methane_by_field_s5p.csv` (640 rows). The app averages years with ≥ 6 retrieved months and compares the **background-referenced anomaly** (field minus the mean of the other fields), because the raw column rises everywhere with global methane (+40 to +45 ppb over 2019–2024 in the background) |
| **Coverage** | usable (≥ 60% of possible months) for 9 of 12 fields; refused, not interpolated, for Cantarell (28%), Niger Delta (24%) and Lake Maracaibo (12%) — retrievals fail over water, cloud and dark surfaces |
| **Limitations** | cannot be attributed to any operator or flare stack; unrelated regional sources (agriculture, wetlands, landfill, other operators) can dominate; "flaring down, methane up" is the pattern venting would produce **and** the pattern unrelated sources would produce — flagged, never interpreted as wrongdoing |

## 4. ClimateBERT environmental-claims dataset (model training and evaluation)

| | |
|---|---|
| **Name** | `climatebert/environmental_claims` — 2,647 expert-annotated sentences from corporate reports and earnings calls |
| **Source** | Stammbach, Webersinke, Bingler, Kraus, Leippold, *A Dataset for Detecting Real-World Environmental Claims*, arXiv:2209.00507 — <https://huggingface.co/datasets/climatebert/environmental_claims> |
| **Purpose** | fine-tunes and evaluates the claim detector (`Rahilgh/greentruth-claim-detector`) |
| **Access / licence** | Hugging Face Hub, no token · CC BY-NC-SA 4.0 (non-commercial; the model inherits it) |
| **Processing** | notebook 01 (fine-tuning), notebook 02 (evaluation on the 265-sentence test split) |
| **Limitations** | English, listed-company text; a claim label says a sentence *is a claim*, not whether it is true |

## 5. Zero Routine Flaring by 2030 (claim-side reference)

| | |
|---|---|
| **Source** | World Bank — <https://www.worldbank.org/en/programs/gasflaringreduction/zero-routine-flaring-by-2030> |
| **Purpose** | the kind of public commitment GreenTruth is built to assess (a target year and a target value) |
| **Use** | reference only — GreenTruth does not ingest the endorser list and does not assume any organisation's membership. The demo claims are written for the demo. |

## 6. Natural Earth 1:110m country outlines (basemap)

Public domain (<https://www.naturalearthdata.com/downloads/110m-cultural-vectors/>),
committed as `data/geo/world_110m.json` with coordinates rounded to 2 decimals. Used only to
draw the map; **no value is derived from it**.

## Field reference

`data/facilities_international.json` — approximate public centroids for 12 major flaring
regions (Permian Basin, Bakken, Priobskoye / West Siberia, Rumaila / Basra, South Pars /
Asaluyeh, Hassi Messaoud, Hassi R'Mel, Niger Delta, Lake Maracaibo, Sirte Basin, Tengiz,
Cantarell / Campeche), each with a match radius. It makes no claim about any operator.

## Present but deliberately unused

`data/real/flaring_by_operator.csv` (14,694 rows) is produced by notebook 03 but not used:
operator names cannot be matched to the monitored fields without a guess that could
attribute flaring to the wrong company.
