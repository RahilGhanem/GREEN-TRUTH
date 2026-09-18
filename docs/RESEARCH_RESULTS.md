# GreenTruth — Research Results

Every number in this document was produced by a notebook run and is read from
`evaluation/experiment_registry.json`, built by `scripts/build_experiment_registry.py`
from `notebooks/executed/results/`. Nothing is estimated. Where a notebook did not
produce a value it is marked **NOT AVAILABLE** rather than filled in.

Reproduce the registry at any time:

```bash
python3 scripts/build_experiment_registry.py
python3 scripts/eval_rule_detector.py
```

---

## Research question

> Does grounding environmental claim verification in Earth-observation evidence
> improve verification reliability compared with text-only approaches?

**What this project can and cannot answer.** The question as posed needs a labelled
corpus of claims with adjudicated ground truth — "this claim is true / false" —
verified independently. **No such dataset exists for flaring claims, and this project
did not create one**, because creating one would mean inventing the labels.

So the honest scope is narrower, and it is what the results below support:

> **An abstention-first Earth-observation evidence framework for environmental
> claim verification**, with measured claim detection, measured interval coverage,
> a measured ablation of the evidence stack, and an explicit evidence-sufficiency
> mechanism that reports what the observations cannot support.

The contribution is the **protocol and its calibration**, not a verification
accuracy figure. Any claim to the latter would be manufactured.

---

## 1. Claim detection

**Setup.** `Rahilgh/greentruth-claim-detector` (DistilRoBERTa fine-tuned from
`climatebert/distilroberta-base-climate-f`), evaluated on the held-out test split of
`climatebert/environmental_claims` (Stammbach et al., ACL 2023).

* n = **265** sentences, positive rate **0.2528**
* Baseline: GreenTruth's own `RuleBasedDetector` — the fallback that ships by default
* Both arms on the identical split (verified against `n_test` before reporting)

### Measured results

| metric | ClimateBERT | rule fallback | gain |
|---|---|---|---|
| accuracy | **0.9057** | 0.7774 | +0.1283 |
| macro F1 | **0.8813** | 0.6217 | +0.2597 |
| claim precision | **0.7692** | 0.6429 | +0.1264 |
| claim recall | **0.8955** | 0.2687 | **+0.6269** |
| claim F1 | **0.8276** | 0.3789 | +0.4486 |

ROC AUC **0.9691** · Brier **0.0734** · confusion matrix (rows true, cols predicted)
`[[180, 18], [7, 60]]`.

### Reading

The decisive number is **claim recall: 0.896 vs 0.269**. The rule detector misses 49 of
67 real claims on this corpus. That is not a bug — it was written for flaring-style
corporate text and keys on a closed vocabulary, so a broad claim corpus is outside its
design scope. But it is the measured justification for making the transformer the
primary detector and keeping the rules only as an offline fallback.

**Threshold.** A threshold of 0.25 scored higher (macro F1 **0.9020** vs 0.8813 at 0.5).
It was selected on the **test** split, so it is diagnostic only and is **not shipped**.
The application still uses 0.5. Re-deriving it on a validation split is an open item.

### Caveats

* **In-domain.** These weights were fine-tuned on this dataset's train split, so this is
  the standard protocol for the dataset but not evidence of transfer.
* Detecting a claim is not judging it. These metrics say nothing about verification
  accuracy.
* The rule baseline was reproduced by `scripts/eval_rule_detector.py`, because the arm
  returned `null` in the Colab run (the `greentruth` package was not importable there).
  It is deterministic and uses the same verified split.

---

## 2. Uncertainty calibration

**Setup.** Notebook 05, leave-one-field-out across **12 fields**, **936**
(field, year-pair) observations, nominal **90%**.

Three interval constructions:

* **A. residual bootstrap** — what `verdict.py` ships
* **B. split conformal** — one global absolute-residual quantile
* **C. gap-conditional conformal** — a separate quantile per year-gap

### Measured results

| method | marginal coverage | median width | conditional drift | conditional range |
|---|---|---|---|---|
| **A. bootstrap (shipped)** | **0.9071** | **0.781** | 0.0493 | 0.833 – 1.000 |
| B. split conformal | 0.8921 | 1.161 | 0.0342 | 0.833 – 0.958 |
| C. gap-conditional conformal | 0.8974 | 1.187 | **0.0102** | 0.889 – 0.917 |

Level sweep (coverage / median width):

| nominal | A. bootstrap | B. split conformal | C. gap-conditional |
|---|---|---|---|
| 0.80 | 0.8045 / 0.643 | 0.7970 / 0.759 | 0.8024 / 0.790 |
| 0.90 | 0.9071 / 0.781 | 0.8921 / 1.161 | 0.8974 / 1.187 |
| 0.95 | 0.9583 / 0.902 | 0.9434 / 1.668 | 0.9487 / 1.672 |

### Reading — and a correction to the notebook's own recommendation

The notebook's `recommendation` field says **"C. gap-conditional conformal"**, chosen by
minimising |coverage − nominal|. **That rule ignores interval width, and the width
difference here is large.** The shipped bootstrap reaches 0.9071 against a 0.90 nominal
at a median width of **0.781**, while gap-conditional conformal reaches 0.8974 at
**1.187** — about **52% wider** for a marginal coverage difference of under half a
percentage point. At the 0.95 level the gap widens to 0.902 vs 1.672.

So the evidence does **not** support swapping to conformal, and this project does not.
Choosing the more sophisticated-sounding method against the measurement would be exactly
the failure mode the experiment was designed to prevent.

**But the conditional result is real and matters.** The bootstrap's coverage swings from
**0.833** at 3–4 year gaps to **1.000** at 12-year gaps — it under-covers short horizons
and over-covers long ones. Gap-conditional conformal is nearly flat (0.889–0.917,
drift 0.0102 vs 0.0493). Marginal calibration was hiding conditional miscalibration.

**What GreenTruth does about it.** The bootstrap is kept for its efficiency, and every
verdict now reports the **measured coverage at its own year-gap** rather than the nominal
figure it was never checked against. A verdict over a 5-year window says the interval
covered **93.8%** of the time in testing; a verdict over a 3-year window would report
83.3% and be flagged as under-covering. That is a more honest use of the measurement than
either ignoring it or swapping the estimator.

### Caveats (from the notebook, unchanged)

* 12 fields = 12 independent geographic units. Enough to measure miscalibration, not to
  certify a tight guarantee.
* Exchangeability is violated: annual series are autocorrelated and trending, so the
  conformal guarantee is approximate here.
* Quantiles were fitted on all fields; the coverage figures are leave-one-field-out.

---

## 3. Real Earth-observation datasets

All produced by notebook 03 and deployed to `data/real/`.

| dataset | rows | entities | years | used by app |
|---|---|---|---|---|
| `flaring_by_field.csv` | 156 | 12 fields | 2012–2024 | yes — primary evidence |
| `flaring_by_country.csv` | 1,287 | 99 countries | 2012–2024 | yes — cross-scale check |
| `methane_by_field_s5p.csv` | 640 | 12 fields (monthly) | 2019–2024 | yes — independent instrument |
| `flaring_by_operator.csv` | 14,694 | operators | 2012–2024 | **no** |

`flaring_by_operator.csv` is deliberately unused: operator names in that sheet cannot be
reliably matched to the monitored fields, and a name-matching step could silently
mis-attribute flaring to the wrong company.

### Sources

| | |
|---|---|
| **Flaring** | World Bank Global Gas Flaring Tracker, VIIRS-based, produced with the Earth Observation Group, Payne Institute, Colorado School of Mines / NOAA. Annual, 2012–2024, global. Public, no account. <https://www.worldbank.org/en/programs/gasflaringreduction/global-flaring-data> |
| **Methane** | Sentinel-5P / TROPOMI OFFL L3 CH4, Copernicus / ESA via Google Earth Engine. ~7 km, monthly means, 2019–2024. Free Earth Engine account required. <https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S5P_OFFL_L3_CH4> |
| **Detector dataset** | `climatebert/environmental_claims`, CC BY-NC-SA 4.0. <https://huggingface.co/datasets/climatebert/environmental_claims> |
| **Basemap** | Natural Earth 1:110m Admin 0, public domain. <https://www.naturalearthdata.com/downloads/110m-cultural-vectors/> |

---

## 4. Multi-source evidence

GreenTruth now carries three real views, and treats them as scientifically distinct:

### 4.1 Cross-scale corroboration — same instrument

Field-level VIIRS vs national-total VIIRS. **Not independent**: both derive from the same
World Bank / VIIRS programme at different spatial scales.

Measured across all 12 fields, 2019→2024:

| relationship | n | fields |
|---|---|---|
| corroborates | 7 | Hassi Messaoud, Hassi R'Mel, Sirte, Niger Delta, Priobskoye, Bakken, Permian |
| same direction, different magnitude | 2 | South Pars, Lake Maracaibo |
| **diverges** | 3 | **Rumaila (−18% vs +1%), Tengiz (+14% vs −26%), Cantarell (−7% vs +28%)** |

A divergence is **not** an error. A field is a small part of a national footprint, so
flaring can fall at one field while rising elsewhere in the country. The interface says
so explicitly.

### 4.2 Independent instrument — Sentinel-5P methane

A different satellite measuring a different physical quantity. This is the only genuinely
independent cross-check in the system.

**The correction that makes it usable.** Measured naively, *every* field's methane column
rises +35 to +52 ppb over 2019–2024 — which would read as "flaring fell but methane rose"
everywhere, i.e. venting everywhere. That is an artefact of the **global** methane rise.
The background proxy (mean of the other monitored fields) rises **+41.8 ppb** over the
same window, closely matching the known global trend. GreenTruth therefore compares the
**background-referenced anomaly**, not the raw column.

Measured, 2019→2024, background-referenced:

| field | flaring | raw CH4 | background | anomaly | pattern |
|---|---|---|---|---|---|
| **Permian Basin** | **−29%** | +52.5 | +40.4 | **+12.1** | **flaring down, methane up** |
| Tengiz | +14% | +50.5 | +40.7 | +9.8 | both up |
| Priobskoye | +0% | +49.1 | +40.8 | +8.2 | both up |
| Bakken | −63% | +45.9 | +41.2 | +4.6 | flat |
| Hassi Messaoud | −24% | +45.7 | +41.3 | +4.4 | flat |
| Rumaila | −18% | +42.6 | +41.6 | +1.0 | flat |
| Sirte | +39% | +41.1 | +41.8 | −0.7 | flat |
| Hassi R'Mel | −2% | +35.8 | +42.5 | −6.7 | both down |
| South Pars | +20% | +12.5 | +45.4 | −32.9 | flaring up, methane down |
| Cantarell, Niger Delta, Lake Maracaibo | — | — | — | — | **retrieval coverage too low** |

**Why the pattern matters.** Flaring *combusts* methane; venting releases it. So "flaring
down, methane up" is the signature of a possible shift from flaring to venting — the
outcome that looks like success on the flaring channel alone. **Permian is the one field
showing that pattern**, and GreenTruth flags it. It is a flag, not a finding: at ~7 km the
column cannot be attributed to any operator, and unrelated regional sources are an equally
consistent explanation.

**Coverage gate.** TROPOMI CH4 retrievals fail over water, under cloud and over
low-albedo surfaces. Measured completeness: 9 of 12 fields ≥ 67% of possible months;
Cantarell 28%, Niger Delta 24%, Lake Maracaibo 12% (open water). Those three are refused,
not interpolated.

---

## 5. Ablation — measured system properties

**Run:** `python3 scripts/run_ablation.py` (notebook 06 reproduces it in Colab).
**Result file:** `evaluation/ablation_results.json`.

**518 probe claims across 12 real fields.** Probe claims are
constructed from real observed windows so the pipeline can be exercised uniformly. Nobody
published them; they are labelled as probes everywhere. Every observation is real.

### This is not an accuracy ablation

No adjudicated corpus of true/false flaring claims exists, so **no configuration reports
accuracy**. What is measured is how each layer changes the system's behaviour.

| config | adds | can assess vs evidence | abstention | median interval |
|---|---|---|---|---|
| **A** text only | structured claim record | 0% | — | — |
| **B** + geography | facility + coordinates | 0% | — | — |
| **C** + Earth observation | real flaring series | 100% | — | — |
| **D** + temporal | change across the window | 100% | **0%** | — |
| **E** + uncertainty | interval; abstention possible | 100% | **91.7%** | 0.7541 |
| **F** full system | methane, cross-scale, sufficiency | 100% | 91.7% | 0.7541 |

### The headline

> Of the **518** verdicts a point-estimate system
> would have issued, the uncertainty layer prevented
> **475 (91.7%)**.

Configurations A–D have no mechanism to decline. D answers every claim from the point
estimate — which is what a system without an uncertainty layer does. E is the first
configuration that can say "these observations cannot tell these cases apart", and on this
data it says so most of the time.

This is the central measured result of the project, and it cuts both ways: it is evidence
that the abstention mechanism does real work, **and** evidence that 13 annual points rarely
settle a flaring claim.

### Abstention is not uniform

| window (years) | n | abstention | median interval width |
|---|---|---|---|
| 3 | 101 | 95.0% | 0.8051 |
| 4 | 85 | 92.9% | 0.7928 |
| 5 | 78 | 97.4% | 0.8106 |
| 6 | 64 | 96.9% | 0.7617 |
| 7 | 51 | 96.1% | 0.7367 |
| 8 | 49 | 91.8% | 0.7328 |
| 9 | 38 | 73.7% | 0.6885 |
| 10 | 25 | 76.0% | 0.608 |
| 11 | 17 | 76.5% | 0.6035 |
| 12 | 10 | 80.0% | 0.6213 |

Abstention falls from ~95–97% on 3–7 year windows to **74–80%** on 9–12 year windows, and
the interval narrows from 0.81 to 0.60. **Decidability is a function of claim length**, and
that is actionable: this evidence can speak to decade-scale claims far better than to
three-year ones.

### Cross-source behaviour (configuration F)

| state | share |
|---|---|
| agreement | 51.0% |
| same direction, different magnitude | 18.9% |
| **cross-scale divergence** | **28.8%** |
| **cross-sensor tension** | **1.2%** |
| multiple tensions | 0.2% |

Sources disagree on **30.1%** of assessed claims. Treating
any single source as definitive would therefore be unsafe roughly one time in three.

Sufficiency levels: **0.0%** fully sufficient,
**8.3%** partially,
**91.7%** insufficient. Nothing reaches SUFFICIENT,
because attribution is a permanent structural limit on this instrument.

The independent instrument was available for only **8.1%** of
probes — most probe windows begin before 2019, and Sentinel-5P starts in 2019. That is a
property of the window set, not missing data.

## 6. Error analysis

Observed failure modes, from real runs:

| mode | example | handling |
|---|---|---|
| **Wide interval** | Bakken 2019→2024: 90% interval −70% to +88% | **abstain** — the interval spans "meets the claim" through "rose" |
| **Cross-scale divergence** | Rumaila −18% field vs +1% national | flagged and explained as a scale effect |
| **Independent-instrument divergence** | Permian: flaring −29%, CH4 anomaly +12.1 ppb | flagged as possible venting; explicitly not attributed |
| **No instrument coverage** | Lake Maracaibo — 12% TROPOMI completeness | channel refused, sufficiency records it |
| **Unsupported metric** | "net zero by 2050" | *no signal to check*, with the reason |
| **Ambiguous facility** | "United States" → Permian + Bakken | ambiguity surfaced; choice flagged as not evidence-based |
| **Target beyond data** | "zero routine flaring by 2030" | projection with a band, never an observation |
| **Detector false positives** | 18 of 198 non-claims flagged (§1) | precision 0.769 on the claim class |
| **Detector false negatives** | 7 of 67 claims missed by the transformer; 49 by the rules | measured, §1 |

---

## 7. Limitations

**Attribution.** VIIRS detects a flare at a *location*. Flaring near a field is consistent
with activity there; it is not proof any operator caused it. TROPOMI is worse in this
respect — ~7 km, background-dominated. Neither channel supports operator-level attribution,
and GreenTruth never claims it does.

**Sample size.** 12 fields, 13 years. Enough to measure miscalibration; not enough to
certify a guarantee.

**Not independent, mostly.** Two of the three views share the VIIRS instrument. Only the
methane channel is independent, and it is available for 9 of 12 fields.

**Detection ≠ verification.** The detector metrics are in-domain and say nothing about
whether a verdict is correct.

**No verification ground truth.** The headline research question cannot be answered with
the data available. See §5.

**Uncalibrated conditionally.** The shipped interval under-covers at 3–4 year gaps
(0.833). Reported per verdict rather than hidden.

---

## 8. Future work

1. **Adjudicated verification labels** — the single thing blocking a real ablation.
2. **Re-derive the detection threshold on validation** and ship it (currently 0.5;
   0.25 scored better on test but is not shippable).
3. **Gap-conditional intervals where width permits** — the machinery and quantiles are
   already in `05_calibration.json`.
4. **More independent instruments** — the methane channel is the template; forest loss
   (Hansen) would extend coverage to land-use claims.
5. **Improve TROPOMI coverage** for water-adjacent fields, possibly with a larger
   averaging radius or a different product.

---

## Reproduction

```bash
# 1. notebooks (Colab, data downloads automatically, no manual upload)
#    02_claim_detector_evaluation.ipynb   -> 02_detector_metrics.json
#    03_real_satellite_data_pipeline.ipynb -> flaring_*.csv, methane_by_field_s5p.csv
#    05_uncertainty_calibration.ipynb     -> 05_calibration.json
# 2. place outputs in `notebooks/executed/results/`, CSVs also in data/real/
python3 scripts/build_experiment_registry.py    # -> evaluation/experiment_registry.json
python3 scripts/eval_rule_detector.py           # -> evaluation/rule_baseline_metrics.json
python3 scripts/build_dataset_registry.py       # -> data/DATASETS.md
python3 scripts/run_ablation.py                 # -> evaluation/ablation_results.json
python3 -m unittest discover -s tests           # 100 tests
python3 server.py                               # app at /  -> "Research" view (#research)
```
