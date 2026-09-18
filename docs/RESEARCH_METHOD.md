# GreenTruth — Research Method

How the experiments are set up, so someone else can judge whether the numbers mean what
the results page says they mean. Findings live in `docs/RESEARCH_RESULTS.md`; limits live
in `docs/LIMITATIONS.md`.

---

## 1. The problem, stated precisely

An organisation asserts something about the physical world:

> "We reduced routine gas flaring by 40% from 2019 levels."

Three separate questions follow, and conflating them is the usual failure mode:

1. **Is this a claim, and what exactly does it assert?** — an NLP problem
2. **Is there a measurement capable of speaking to it?** — an evidence-availability problem
3. **Given that measurement, what can be concluded?** — a statistical problem

GreenTruth treats them as three stages with three different failure modes, and reports
each one separately rather than collapsing them into a single confidence number.

---

## 2. Design commitments

These constrain every experiment in the project.

| commitment | consequence |
|---|---|
| **No synthetic environmental data, ever** | If real data is absent the system says so. There is no fallback path that invents observations — not even for a demo. |
| **Uncertainty decides, it does not decorate** | The interval selects the verdict. When it spans materially different outcomes the system abstains. |
| **No number is labelled more precisely than it was earned** | No `confidence` field exists. Intervals are labelled as uncalibrated bootstraps; the slot-coverage ratio is labelled as a ratio. |
| **Independence is a claim about instruments** | Two datasets are independent only if they come from different instruments. Enforced in `dataset_registry.json` via `instrument_family`. |
| **Absence is reported** | Unavailable channels are computed from disk and listed with reasons, not silently omitted. |
| **One door for metrics** | Everything displayed comes from `greentruth/measured.py`, which reads notebook outputs. Missing → `None` → "not measured". |

---

## 3. Experiment 1 — claim detection (notebook 02)

**Question.** How much does transformer-based detection improve over the rule-based
extractor that ships as the fallback?

**Data.** `climatebert/environmental_claims` (Stammbach et al., ACL 2023), held-out test
split, n = 265, positive rate 0.2528. Downloaded in-notebook; no manual upload.

**Arms.**
* `Rahilgh/greentruth-claim-detector` — DistilRoBERTa fine-tuned from
  `climatebert/distilroberta-base-climate-f`, decision threshold 0.5
* `greentruth.detectors.RuleBasedDetector` — the class the application actually uses, not
  a re-implementation

**Protocol.** Both arms score the identical split. The transformer arm ran in Colab. The
rule arm returned `null` there (the package was not importable in that runtime), so it is
reproduced by `scripts/eval_rule_detector.py`, which fetches the same split over the
Hugging Face datasets-server HTTP API and **refuses to report** unless the row count
matches notebook 02's `n_test`. The rule detector is deterministic, so this is exactly
reproducible.

**Metrics.** Accuracy, per-class and macro precision / recall / F1, confusion matrix,
ROC AUC, Brier score, a threshold sweep and a reliability diagram.

**Threat to validity.** In-domain: these weights were fine-tuned on this dataset's train
split. This is the dataset's standard protocol, not evidence of transfer.

---

## 4. Experiment 2 — uncertainty calibration (notebook 05)

**Question.** Does the interval the system ships actually cover at its nominal rate, and
would a conformal method do better?

**Data.** The real flaring series: 12 fields × 13 years. Every ordered year-pair with a
defined change gives one observation → **936** (field, year-pair) observations.

**Arms.**
* **A** residual bootstrap — what `verdict.py` ships
* **B** split conformal — one global absolute-residual quantile
* **C** gap-conditional conformal — a separate quantile per year-gap

**Protocol.** **Leave-one-field-out.** Quantiles are fitted on 11 fields and evaluated on
the held-out 12th, so no field calibrates its own interval. Nominal levels 0.80 / 0.90 /
0.95.

**Metrics.** Marginal empirical coverage, median interval width, and **conditional
coverage by year-gap** — reported because marginal calibration can hide conditional
miscalibration, which is exactly what happened.

**Selection rule, and a deliberate departure.** Notebook 05's own `recommendation` field
minimises |coverage − nominal| and therefore picks gap-conditional conformal. **That rule
ignores width.** The project does not follow it: the shipped bootstrap reaches nominal
coverage at roughly two-thirds the width, and a wider interval that covers equally well is
not an improvement. The conditional finding is kept and acted on differently — each
verdict reports the coverage measured at *its own* year-gap.

**Threat to validity.** 12 independent geographic units. Enough to detect miscalibration,
not to certify a guarantee. Conformal prediction assumes exchangeability, which
autocorrelated trending annual series violate, so its guarantee is approximate here.

---

## 5. Experiment 3 — ablation (notebook 06)

**Question.** What does each layer of the evidence stack contribute?

**Why this is not an accuracy ablation.** There is no adjudicated corpus of true/false
flaring claims. An accuracy table would rest on invented labels. So the ablation measures
**system behaviour** instead, and reports no accuracy metric anywhere.

**Probe claims.** For each field and each year-pair ≥ 3 years apart where the real change
is between 5% and 90%, one probe claim asserts a round figure near the observed change.
**518 probes across 12 fields.** These are probes, not corporate claims — nobody published
them — and they are labelled as such. Every observation they meet is real.

**Configurations.** A text only → B + geography → C + Earth observation → D + temporal →
E + uncertainty → F full system.

**The key contrast is D vs E.** Configuration D issues a verdict from the point estimate
with nothing able to stop it — a system without an uncertainty layer. E computes the
interval and abstains when it spans materially different outcomes. The count of verdicts
that changes between them is the measurable value of taking uncertainty seriously.

**Measures.** Evidence availability, window coverage, interval width, abstention rate,
**unsupported-verdict prevention**, cross-source agreement, independent-instrument
availability, sufficiency-level distribution — plus a breakdown of abstention by window
length, which turns "it abstains a lot" into a statement about which claims this evidence
can settle.

**Threat to validity.** Probe claims are constructed near the observed change, so they are
not adversarial. They test the machinery uniformly; they do not test robustness to
misleading claims.

---

## 6. Evidence model

Three real views, kept explicitly distinct:

| view | instrument | independence | role |
|---|---|---|---|
| Field flaring | VIIRS | — | primary evidence |
| National flaring | VIIRS | **shares an instrument** | cross-scale context |
| Methane anomaly | TROPOMI | **independent** | independent cross-check |

**Two kinds of disagreement, named differently on purpose:**

* **Cross-scale divergence** — field and country move oppositely. Both can be true at
  once; a field is a small part of a national footprint. This is scope context.
* **Cross-sensor tension** — flaring falls while the methane anomaly rises. Physically the
  signature of venting rather than flaring, and equally consistent with unrelated regional
  sources. This is a flag, never an accusation.

**Background referencing.** Atmospheric methane is rising globally, so the raw column
rises at every field. The field-specific signal is the **anomaly** against a background
proxy — the mean of the other monitored fields, which span four continents. Without this
correction every field reads as venting, which would be an artefact.

**No combined score.** Different units, instruments, footprints and failure modes.
Averaging them would produce a number with no physical meaning.

---

## 7. Decision procedure

The change axis is partitioned into four regions:

```
0  meets or beats the claimed reduction
1  fell, but by less than claimed
2  essentially flat (|change| <= 5%)
3  rose
```

| interval spans | outcome |
|---|---|
| one region | that verdict |
| two neighbouring regions | point-estimate verdict, flagged borderline |
| **three or more** | **abstain** |

Sufficiency is assessed separately across seven dimensions (identity, spatial, temporal,
measurement, attribution, independent evidence, uncertainty) and returns **SUFFICIENT /
PARTIALLY SUFFICIENT / INSUFFICIENT** plus an **evidence ceiling** — the strongest
statement the evidence can carry. Structural limits such as attribution downgrade a clean
result to PARTIALLY SUFFICIENT rather than passing as footnotes.

---

## 8. Execution record and result provenance

Where each experiment actually ran, and whether it was re-verified for the final build.

| Notebook / script | Ran in | Output | Final-build status |
|---|---|---|---|
| 01 detector training | Colab (GPU) | model on the Hugging Face Hub | executed record kept in `notebooks/executed/` |
| 02 detector evaluation | Colab | `notebooks/executed/results/02_detector_metrics.json` | executed record kept; registry rebuilt — identical |
| `scripts/eval_rule_detector.py` | local | `evaluation/rule_baseline_metrics.json` | **re-run** (split re-downloaded) — identical |
| 03 real data pipeline | Colab | `notebooks/executed/results/*.csv` → `data/real/` | executed record kept; files byte-identical to `data/real/` |
| 04 verification experiment | local | `evaluation/04_*` | **re-executed** — per-field table identical |
| 05 uncertainty calibration | Colab | `notebooks/executed/results/05_calibration.json` | executed record kept; registry rebuilt — identical |
| 06 ablation (`scripts/run_ablation.py`) | local | `evaluation/ablation_results.json` | **re-executed** — identical |
| 07 case study | local | `evaluation/07_case_study.json` | **re-executed** — all values identical; adds `flat_band` and the corrected interval note |

Every number shown to a reader traces back like this:

| Result | Read from | Produced by | Data | Source |
|---|---|---|---|---|
| Detector macro-F1 0.8813, claim recall 0.8955 | `evaluation/experiment_registry.json` | notebook 02 (executed) | `climatebert/environmental_claims` test split, n = 265 | Hugging Face Hub |
| Rule-based macro-F1 0.6217, claim recall 0.2687 | `evaluation/rule_baseline_metrics.json` | `scripts/eval_rule_detector.py` | same split | Hugging Face datasets-server |
| Coverage 0.9071; conformal 0.8921 / 0.8974; per-gap coverage | `evaluation/experiment_registry.json` | notebook 05 (executed) | per-field flaring series, 12 × 13 years | World Bank GGFT (VIIRS) |
| 475 / 518 withheld (91.7%); 30.1% disagreement; abstention by window | `evaluation/ablation_results.json` | `scripts/run_ablation.py` / notebook 06 | field, national and methane series | World Bank GGFT; Copernicus Sentinel-5P |
| Niger Delta and Permian case values | `evaluation/07_case_study.json` | notebook 07 | as above | as above |
| Every per-claim number in the interface | `/api/analyze` response | `greentruth/` pipeline at request time | `data/real/*.csv` | as above |

## 9. Reproduction

```bash
# Notebooks (Colab; all data downloads automatically, no manual upload)
#   02  detector evaluation      -> 02_detector_metrics.json
#   03  real EO pipeline         -> flaring_*.csv, methane_by_field_s5p.csv
#   05  uncertainty calibration  -> 05_calibration.json
#   04  verification experiment  -> evaluation/04_*
#   06  ablation                 -> evaluation/ablation_results.json
#   07  end-to-end case study    -> evaluation/07_case_study.json

python3 scripts/build_experiment_registry.py   # notebook outputs -> registry
python3 scripts/eval_rule_detector.py          # reproduces the null baseline arm
python3 scripts/build_dataset_registry.py      # data/DATASETS.md + registry json
python3 scripts/run_ablation.py                # ablation, locally
python3 -m unittest discover -s tests          # 100 tests
python3 server.py                              # app; "Research" view (#research)
```

Determinism: the rule detector, the bootstrap (fixed seed 7) and the ablation probe
construction are all deterministic. Transformer inference is deterministic at fixed
weights and threshold.
