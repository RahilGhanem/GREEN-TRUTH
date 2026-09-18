# GreenTruth — Limitations

Written plainly, because the project's whole claim is that it reports what the evidence
can and cannot support. A limitations page that undersells the limits would contradict
the product.

Each entry says what the limit **is**, what it **means for a result**, and whether it can
be fixed.

---

## 1. Attribution — permanent, and the most important one

**The limit.** VIIRS detects a flare at a *location*. Sentinel-5P measures a methane
column over a ~7 km footprint. Neither instrument observes an operator, a contract or a
corporate boundary.

**What it means.** GreenTruth can say "flaring at this field fell 29% between 2019 and
2024". It cannot say "this company reduced its flaring by 29%". Several operators may
work the same field; flares near a boundary may belong to a neighbouring one.

**Fixable?** Not with these instruments. Operator-level attribution would need permitting
records, production reporting or contractual data — none of which is Earth observation.
The `flaring_by_operator.csv` sheet exists but is **deliberately unused**, because its
operator names cannot be matched to monitored fields without a guess that could
mis-attribute flaring to the wrong company.

> Every flaring verdict carries this as a permanent `⚠` in the sufficiency checklist. It
> is why the best achievable sufficiency level on flaring evidence alone is
> **PARTIALLY SUFFICIENT**, never SUFFICIENT.

---

## 2. No verification ground truth

**The limit.** There is no adjudicated corpus of true/false environmental claims for
flaring. Nobody has published one.

**What it means.** GreenTruth **cannot report verification accuracy**, and does not. The
ablation in notebook 06 measures system *behaviour* — evidence availability, uncertainty
width, abstention rate, cross-source agreement — and explicitly reports no accuracy
metric. The research question "does EO grounding improve verification reliability?" is
therefore answered only in the narrow sense of what the components do, not in the broad
sense of whether verdicts are right.

**Fixable?** Yes, with labelling effort: a panel adjudicating a set of real corporate
flaring claims against primary records. That is a research project in itself.

---

## 3. Uncertainty is empirical, not guaranteed

**The limit.** The interval is a residual bootstrap around a linear trend fitted to 13
annual points. Notebook 05 measured its coverage at **0.9071** against a 0.90 nominal,
leave-one-field-out over 12 fields and 936 observations.

**What it means.** That is an empirical estimate on **12 independent geographic units**,
not a certificate. And it drifts conditionally: coverage runs from **0.833** at 3–4 year
gaps to **1.000** at 12-year gaps. The system reports the coverage measured at *each
verdict's own year-gap* rather than the nominal, but a per-gap estimate from 12 fields is
itself noisy.

**Fixable?** Partly. Gap-conditional conformal holds coverage far more evenly
(drift 0.0102 vs 0.0493) but needs ~52% wider intervals. The quantiles are already
computed in `05_calibration.json`; adopting them is a width-versus-robustness decision,
not a missing capability.

> There is deliberately **no `confidence` field anywhere** in the API or the interface.

---

## 4. Two of three sources share an instrument

**The limit.** Field-level and country-level flaring both come from the same World Bank /
VIIRS programme and processing chain.

**What it means.** Their agreement is **cross-scale corroboration, not independent
corroboration**, and a shared systematic error would move both together. The interface,
the API, `data/DATASETS.md` and the sufficiency checklist all label it this way, and
`dataset_registry.json` records the shared `instrument_family` explicitly so the
distinction cannot quietly erode.

Only **Sentinel-5P methane** is a genuinely independent instrument.

**Fixable?** Yes, by adding more independent instruments.

---

## 5. Methane coverage is uneven, and the raw signal is misleading

**The limit.** TROPOMI CH4 retrievals fail over water, under cloud and over low-albedo
surfaces. Measured completeness across the 12 fields:

| coverage | fields |
|---|---|
| ≥ 89% | Permian, Rumaila, Hassi Messaoud, Bakken, South Pars, Hassi R'Mel, Sirte, Tengiz |
| 67% | Priobskoye |
| **< 30%** | **Cantarell (28%), Niger Delta (24%), Lake Maracaibo (12% — open water)** |

**The subtler trap.** Atmospheric methane is rising globally. Measured naively, *every*
field's raw column rises +35 to +52 ppb over 2019–2024, which would read as "venting
everywhere". The background proxy measures **+41.8 ppb** over the same window. GreenTruth
therefore compares a **background-referenced anomaly**; the raw column is shown beside it
so the correction is visible rather than hidden.

**What it means.** Three fields get no independent cross-check at all, and their
sufficiency reports say so. The background proxy is the mean of the other monitored
fields — a reasonable stand-in for a global trend across four continents, but a proxy.

**Fixable?** Partly — a larger averaging radius or a different CH4 product might recover
some water-adjacent fields.

---

## 6. Methane and flaring are not the same quantity

**The limit.** Flaring *combusts* methane; venting *releases* it. The two channels can
legitimately move in opposite directions.

**What it means.** "Flaring down, methane anomaly up" is the signature a shift from
flaring to venting would produce — and it is **equally consistent** with unrelated
regional methane sources (agriculture, wetlands, landfill, other operators) inside the
same ~7 km footprint. At this resolution the two cannot be separated. GreenTruth flags
the pattern as **cross-sensor tension** and never as wrongdoing.

**Fixable?** Only with higher-resolution methane (e.g. targeted plume imagery), which is
outside this dataset.

---

## 7. Annual resolution, thirteen points

**The limit.** Flaring data is annual, 2012–2024.

**What it means.** Within-year timing is invisible. A trend fitted to 13 points is a weak
model, and the ablation shows the practical consequence: abstention runs at **95–97%** for
3–7 year windows and falls to **74–80%** at 9–12 years. Short claims are largely
undecidable on this evidence.

**Fixable?** Monthly VIIRS products exist and would help.

---

## 8. Projections are not predictions

**The limit.** Future commitments are assessed by OLS extrapolation with a bootstrap band.

**What it means.** A linear extrapolation cannot anticipate policy change, shutdowns,
acquisitions or new production. "Not on observed trajectory" means *the current path does
not reach the target*, not *the target will be missed*. Observed, projected, required and
target values carry distinct `provenance` tags and are drawn in distinct styles precisely
so a projection is never mistaken for a measurement.

---

## 9. Claim detection is in-domain and English-only

**The limit.** ClimateBERT scored macro-F1 **0.8813** on the held-out test split of the
dataset it was fine-tuned on (n = 265).

**What it means.** That is the standard protocol for the dataset, but it is in-domain:
it is not evidence of transfer to other corpora, other languages, or non-listed-company
text. The claim-class precision of **0.769** means roughly one in four flagged claims is a
false positive.

A threshold of 0.25 scored better (macro-F1 0.9020) but was selected on the *test* split,
so it is diagnostic only and is **not shipped** — 0.5 remains in use.

---

## 10. One metric has an evidence channel

**The limit.** Only gas flaring is wired to real observations.

**What it means.** Methane, water, deforestation, renewables and net-zero claims return
**"no signal to check"** with a reason. They are detected and decomposed, then honestly
refused. `provenance.unavailable_channels()` lists what is missing and why, computed from
what is actually on disk rather than hard-coded.

---

## 11. Scope of the monitored world

**The limit.** 12 named fields, chosen as major flaring regions.

**What it means.** A claim about a field outside this set cannot be checked. Country-level
resolution returns *all* matching fields and flags the ambiguity rather than picking one.

---

## 12. Some intervals are extremely wide

**The limit.** The residual bootstrap divides each resampled outcome by a resampled baseline
(fitted value plus a residual). Where the residuals are large relative to the fitted
baseline, that denominator approaches zero and the interval becomes extremely wide — for
example Sirte Basin over 2012–2024.

**What it means.** Such an interval runs from a fall to a rise, so it spans three decision
regions and the result is an **abstention**, not a verdict. Measured on the real data:
across 513 probe windows (3+ years, 5–90% change), 26 produce an interval wider than 300
points or reaching below −100%, and all 26 abstain. The interface clips the chart and prints
the true bounds. It also explains why the mean interval width in the ablation (1.90) is far
above the median (0.75).

**Fixable?** Yes — e.g. by resampling on a log scale. It was deliberately **not** changed for
this build: notebook 05 measured the coverage of the interval as shipped, and changing the
estimator would invalidate that measurement. A fix needs a re-run of notebook 05.

---

## 13. Methane only exists from 2019

Sentinel-5P starts in 2019, so any claim window beginning earlier has no independent
instrument **by construction**. This is why notebook 04 (2012–2024 windows) reports methane
for 0 of 12 fields, and why it was available for only 8.1% of the ablation's probes. It is a
property of the window, not missing data.

---

## 14. Detector fallback

Without `torch` and `transformers` the app uses the rule-based detector, whose measured claim
recall is 0.2687 (vs 0.8955 for ClimateBERT). Claims phrased outside its vocabulary may be
missed. The fallback is reported on every result; decomposition, evidence and verdict logic
are identical either way, and the three demo cases give the same verdicts with both.

---

## What GreenTruth deliberately does not do

* No **ESG score**, green score or company ranking. A scalar would hide exactly the
  distinction the project exists to make.
* No **accusation**. Verdicts are consistency statements about observations, never about
  intent or honesty.
* No **causal claim**. "Claim-implied trajectory" is arithmetic on the claim, explicitly
  not a causal counterfactual.
* No **synthetic environmental data**, ever — including as a fallback. If real data is
  absent the system says so and points at the notebook that produces it.
