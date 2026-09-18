# GreenTruth — Measured Results

Every number here was produced by an executed notebook or evaluation script and re-read
from the files listed under **Source**. Nothing is estimated, and nothing is quoted from a
paper. Detailed analysis: [docs/RESEARCH_RESULTS.md](docs/RESEARCH_RESULTS.md).

> **There is no end-to-end verification accuracy in this document.** No adjudicated corpus
> of true/false flaring claims exists, so what is measured is each component and how the
> evidence stack changes the system's behaviour.

## Claim detection

Held-out test split of `climatebert/environmental_claims`, **n = 265** sentences
(positive rate 0.253), decision threshold 0.5. Both arms on the identical split.

| Metric | ClimateBERT (`Rahilgh/greentruth-claim-detector`) | Rule-based fallback |
|---|---|---|
| Accuracy | **0.9057** | 0.7774 |
| Macro precision | **0.8659** | 0.7181 |
| Macro recall | **0.9023** | 0.6091 |
| Macro F1 | **0.8813** | 0.6217 |
| Claim precision | **0.7692** | 0.6429 |
| Claim recall | **0.8955** | 0.2687 |
| Claim F1 | **0.8276** | 0.3789 |
| Confusion matrix `[[TN, FP], [FN, TP]]` | `[[180, 18], [7, 60]]` | `[[188, 10], [49, 18]]` |

ClimateBERT ROC AUC 0.9691, Brier score 0.0734. A threshold of 0.25 scored macro F1 0.9020,
but it was chosen on the test split, so it is diagnostic only and is **not used**.

**In-domain only:** the weights were fine-tuned on this dataset's training split. This is the
dataset's standard protocol, not evidence of transfer to other corpora or languages.

*Source:* `notebooks/executed/02_claim_detector_evaluation.ipynb` →
`notebooks/executed/results/02_detector_metrics.json` → `evaluation/experiment_registry.json`.
Rule-based arm: `scripts/eval_rule_detector.py` → `evaluation/rule_baseline_metrics.json`
(re-run for the final build from a fresh download of the same split; identical result).

## Uncertainty

Leave-one-field-out across **12 fields** and **936** (field, year-pair) observations: each
field's interval is scored using the other 11. Nominal level 90%.

| Method | Empirical coverage | Median interval width | Mean conditional deviation |
|---|---|---|---|
| **A. Residual bootstrap — shipped** | **0.9071** | **0.781** | 0.0493 |
| B. Split conformal | 0.8921 | 1.161 | 0.0342 |
| C. Gap-conditional conformal | 0.8974 | 1.187 | 0.0102 |

Other nominal levels (coverage / median width):

| Nominal | A. bootstrap | B. split conformal | C. gap-conditional |
|---|---|---|---|
| 0.80 | 0.8045 / 0.643 | 0.7970 / 0.759 | 0.8024 / 0.790 |
| 0.90 | 0.9071 / 0.781 | 0.8921 / 1.161 | 0.8974 / 1.187 |
| 0.95 | 0.9583 / 0.902 | 0.9434 / 1.668 | 0.9487 / 1.672 |

Coverage of the shipped interval **by year gap** (baseline → outcome):

| Gap (years) | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Coverage | 0.958 | 0.886 | **0.833** | **0.833** | 0.938 | 0.941 | 0.931 | 0.883 | 0.958 | 0.944 | 0.958 | 1.000 |

The bootstrap reaches nominal coverage overall at about two-thirds of the conformal width,
so it is kept — but it under-covers at 3–4-year gaps. Every verdict therefore quotes the
coverage measured at **its own** year gap, not the nominal 90%.

*Source:* `notebooks/executed/05_uncertainty_calibration.ipynb` →
`notebooks/executed/results/05_calibration.json` → `evaluation/experiment_registry.json`.

## Abstention (ablation)

**518 probe claims** built from real observed windows across the 12 fields (every window of
3+ years with a 5–90% observed change; the claim asserts a round figure near that change).
Probes are not corporate claims, and every observation they meet is real.

| Configuration | Adds | Can assess against evidence | Abstention |
|---|---|---|---|
| A | text only (structured claim) | 0% | — |
| B | + geography (field, coordinates) | 0% | — |
| C | + Earth observation (real series) | 100% | — |
| D | + temporal comparison (point estimate) | 100% | **0%** — a verdict for every claim |
| E | + uncertainty (interval decides) | 100% | **91.7%** |
| F | + methane, national scale, sufficiency | 100% | 91.7% |

**D vs E is the result.** D issues a verdict for all 518 claims. E withholds **475 of them
(91.7%)** because the interval spans materially different outcomes. Verdicts E still issues:
23 supported, 13 partially supported, 7 contradicted.

This is **not** an accuracy or success rate. A withheld verdict is not a wrong verdict; it
records that thirteen annual observations rarely settle a short claim. It depends on claim
length:

| Claim window (years) | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 |
|---|---|---|---|---|---|---|---|---|---|---|
| Probes | 101 | 85 | 78 | 64 | 51 | 49 | 38 | 25 | 17 | 10 |
| Abstention | 95.0% | 92.9% | 97.4% | 96.9% | 96.1% | 91.8% | 73.7% | 76.0% | 76.5% | 80.0% |
| Median interval width | 0.805 | 0.793 | 0.811 | 0.762 | 0.737 | 0.733 | 0.689 | 0.608 | 0.604 | 0.621 |

*Source:* `scripts/run_ablation.py` (wrapped by `notebooks/06_ablation_study.ipynb`, executed
for the final build) → `evaluation/ablation_results.json`. Re-running reproduces it exactly.

## Cross-source disagreement

In the full system (F), the sources consulted for a claim disagree on **30.1%** of
assessed claims:

| Synthesis state | Share |
|---|---|
| Agreement | 51.0% |
| Same direction, different magnitude | 18.9% |
| Cross-scale divergence (field vs national) | 28.8% |
| Cross-sensor tension (flaring vs methane) | 1.2% |
| Both | 0.2% |

Sufficiency levels across the probes: 0% sufficient, 8.3% partially sufficient, 91.7%
insufficient — nothing reaches *sufficient*, because attribution to an operator is a
permanent limit of these instruments. The independent methane instrument was available for
only 8.1% of probes: most probe windows start before 2019, and Sentinel-5P starts in 2019.

For the fixed 2019→2024 window, field vs national flaring: **7 fields corroborate**, 2 move
in the same direction with a different magnitude, **3 diverge** (Rumaila −18% vs Iraq +1%,
Tengiz +14% vs Kazakhstan −26%, Cantarell −7% vs Mexico +28%).

## Case studies

Both run through the same `GreenTruth.analyze` call the interface uses.

| | Niger Delta | Permian Basin |
|---|---|---|
| Claim (written for the demo) | reduced routine flaring 40% by 2023 from 2012 | reduced routine flaring 25% from 2019 |
| Observed | 6.72 → 3.87 bcm/yr, **−42%** (2012→2023) | 7.65 → 5.43 bcm/yr, **−29%** (2019→2024, outcome year assumed = latest) |
| 90% interval | −44% to −13% (one boundary crossed → borderline) | **−25% to +127%** (three decision regions) |
| Measured coverage at this gap | 0.958 (11-year gap) | 0.938 (5-year gap) |
| Verdict | **Supported** | **Abstain** |
| Sufficiency | Partially sufficient | Insufficient |
| Evidence ceiling | single-instrument consistency only | no conclusion can be drawn |
| Methane | unavailable — 24% of months retrieved | anomaly **+12.1 ppb** (raw +52.5, background +40.4) while flaring fell → cross-sensor tension |

*Source:* `notebooks/executed/07_end_to_end_case_study.ipynb` → `evaluation/07_case_study.json`.

A third interface case, the 2030 pledge in the demo text (Bakken), is computed live by the
app on the same data: last observation 2.29 bcm/yr (2024), projected 2030 value 1.94 with a
90% band of 0.21–3.84, target 0 → **not on observed trajectory** (required −0.38 bcm/yr per
year vs an observed trend of −0.13).

Notebook 04 applies the same protocol to every field over 2012–2024
(`evaluation/04_verification_per_field.csv`): 10 abstain, 1 supported (Tengiz),
1 partially supported (Niger Delta). Methane is unavailable for all twelve windows there,
by construction: they start in 2012 and Sentinel-5P starts in 2019.

## What these results DO demonstrate

- The fine-tuned detector finds environmental claims far more completely than the rule
  fallback on this dataset (claim recall 0.8955 vs 0.2687).
- The shipped interval covers the realised change at close to its nominal rate overall
  (0.9071 vs 0.90), with measured under-coverage at 3–4-year gaps.
- Letting the interval decide changes the system's behaviour substantially: on real windows,
  most short claims cannot be settled by thirteen annual observations.
- Independent views of the same field frequently disagree, so reporting them side by side
  (rather than averaging) matters.
- The pipeline reaches different outcomes on different real evidence — it is not wired to
  agree.

## What these results DO NOT demonstrate

- **No end-to-end verification accuracy.** No adjudicated true/false claim corpus exists.
- **No causal attribution.** Nothing shows why flaring changed at a location.
- **No operator responsibility.** VIIRS and TROPOMI observe locations and atmospheric
  columns, not companies.
- **No universal environmental verification.** Only gas flaring has a complete channel.
- **No out-of-domain detector performance.** Detection metrics are in-domain and English-only.
- **No coverage guarantee.** Twelve geographic units can reveal miscalibration, not certify
  its absence.
