# GreenTruth — 5-Minute Demo

**Before you start**

```bash
python server.py                     # rule-based detector (always works, no install)
.venv/Scripts/python server.py       # ClimateBERT detector, if torch + transformers are installed
```

Open **http://localhost:8000**. The real data must be in `data/real/` (see README →
Reproducibility). With ClimateBERT loaded the top bar reads *Detector: ClimateBERT*;
without it, it reads *rule-based (fallback)* and every result says so. The three demo cases
give the same verdicts with either detector (checked on the final build).

Everything shown below is real observation data. The claim sentences were written for the
demo and are not quotations from any company.

Every result in the app is told as the same short **evidence story**:

1. *What was claimed?*
2. *What did the satellite observe?*
3. *Can the data decide?*
4. *Do other sources agree?*
5. *What can — and cannot — be concluded?*

Above the story is a verdict banner with one plain sentence of reasoning. Below it is an
optional trace of every step from the sentence to the verdict. A pledge replaces steps 2–4
with *Where is the observed path heading?*

---

## 00:00 — Landing page

- **Click:** nothing yet.
- **Judge sees:** *Ground environmental claims in satellite evidence*, the line *"When the
  evidence can't tell, GreenTruth says so"*, the five-step flow (claim → Earth observation →
  uncertainty → evidence → verdict), and live facts read from the server: 156 real annual
  observations, 12 monitored fields, 2012–2024, Sentinel-5P methane usable for 9 of 12 fields,
  which detector is running.
- **Say:** "GreenTruth checks environmental claims against satellite observations, and it
  is built to say when the observations can't decide."
- **Demonstrates:** the app is running on real, loaded data.

## 00:20 — The problem

- **Say:** "Companies publish claims like *we cut flaring by 40%*. Tools can find those
  sentences, but finding a claim isn't checking it. Satellites do see gas flaring, but the
  data is annual, noisy, and tied to places, not companies. So the honest output is a
  comparison *plus* how much that comparison can support."

## 00:40 — Case 1: the evidence supports the claim

- **Click:** **Explore Demo**. The *Guided demo* opens and runs case 1 (Niger Delta) at once.
- **Judge sees:** three case cards, and a pipeline stepper (Detect → Decompose → Resolve →
  Observe → Compare → Uncertainty → Evidence → Verdict) showing what each step produced.
  Below that is a *What to look for* note, then the banner: **SUPPORTED**, *Claimed −40% · Observed
  −42% (2012 → 2023) · 90% interval −44% → −13% · Evidence: Partially sufficient*, flagged
  *Borderline* and *No independent sensor here*.
- **Scroll to** *What did the satellite observe?*: the real 2012–2024 series, 6.72 → 3.87
  bcm/yr, with the claimed path drawn dashed next to it.
- **Scroll to** *Can the data decide?*: **"Only just."** The interval stays on the "fell" side
  but touches two outcomes (met the claim / fell by less), so the verdict is stated and
  marked borderline.
- **Say:** "The claim said 40%; the satellite record shows 42%. The whole interval still says
  'flaring fell', so a verdict is stated, marked borderline because it reaches into 'fell,
  but by less than claimed'."
- **Does not establish:** that any company caused the reduction.

## 01:40 — The ceiling on a supported claim

- **Scroll to** *What can — and cannot — be concluded?*
- **Judge sees:** two columns. *You can conclude:* flaring at this location fell 42%, which is
  consistent with the claimed −40% (borderline). *You cannot conclude:* that any organisation
  caused it, or independent confirmation from a second sensor. Below that are the sufficiency
  level (**Partially sufficient**, not *Sufficient*) and the **evidence ceiling**:
  *"Single-instrument consistency only"*. In *Do other sources agree?* the methane card says
  why: Sentinel-5P retrieved usable data for only 24% of months here (water and cloud).
- **Say:** "Even a supported claim has a ceiling. The satellite sees a location, not an
  operator, and here the independent instrument has too few retrievals."
- **Demonstrates:** GreenTruth separates *what was observed* from *what can be attributed*.

## 02:10 — Case 2: uncertainty causes abstention

- **Click:** **Next: Evidence cannot decide, and instruments disagree →** (Permian Basin).
- **Judge sees:** the banner *"The evidence can't decide"* → **ABSTAIN**, with the reason in
  one sentence: the observed change (−29%) looks decisive, but the 90% interval (−25% to
  +127%) runs from "fell, but by less than claimed" to "rose".
- **Scroll to** *Can the data decide?*: **"No."** The dark interval bar crosses three coloured
  outcome bands. A note explains why the −29% dot sits just outside the bar: the observed
  change compares two single years, while the interval is built from the scatter around the
  trend fitted to all years.
- **Say:** "A point-estimate system would say *supported*: 29% is better than the 25%
  claimed. But the interval runs from a small fall to more than doubling. The data can't
  tell those apart, so GreenTruth doesn't force a verdict."
- **Does not establish:** that the claim is false. Abstain means *these observations cannot
  decide*.

## 03:10 — Other sources disagree

- **Scroll to** *Do other sources agree?*
- **Judge sees:** two cards side by side:
  - **National total**, from the same instrument and labelled as such: field −29% vs
    United States −41%, *moves with the national trend*.
  - **Methane**, from an independent satellite: flaring ↓ −29% vs methane anomaly
    ↑ +12.1 ppb. The raw column rose +52.5 ppb, minus a background rise of +40.4 ppb.

  Below the cards is a **cross-sensor tension** callout with its *possible explanations*.
- **Say:** "A different satellite. Methane rises everywhere with the global trend, so we
  subtract the background. What's left rose while flaring fell. Venting would produce that
  pattern, but so would unrelated regional sources. At 7 km we can't tell which, so it's
  flagged, not interpreted."
- **Does not establish:** venting, or anyone's conduct.

## 03:50 — Every number is traceable

- **Scroll to** *What can — and cannot — be concluded?*, then open **Trace this result — 13
  steps from sentence to verdict** and select **Independent instrument (Sentinel-5P methane)**.
- **Judge sees:** evidence **Insufficient**, with the ceiling *"No conclusion can be drawn from
  the available observations"*. *Show the evidence audit* lists the checks behind it. The
  trace is a 13-node chain; each node opens its source, values, processing and limitations.
- **Say:** "Sources are shown side by side, never averaged into a score. And every number
  traces back to its dataset."

## 04:10 — Case 3: a 2030 pledge

- **Click:** **Next: A 2030 pledge, checked against the observed path →** (Bakken).
- **Judge sees:** *This text was split into 4 separate claims*: a past result (**Abstain**),
  the 2030 pledge (**Not on observed trajectory**, shown), and two clauses about methane and
  net zero (**No signal to check**). Each can be opened in place.
- In *Where is the observed path heading?*:
  - the observed series is drawn solid, and the linear trend fitted to 2012–2024 is extended
    to 2030 as a dashed line with a hatched 90% band;
  - projected 2030 value: 1.94 bcm/yr (band 0.21–3.84), against a target of 0;
  - the required path is dotted: −0.38 bcm/yr each year, against an observed trend of −0.13.
- **Say:** "A pledge can't be true or false yet. What we can check is where the observed path
  is heading. Even the low end of the band stays above zero. That's a statement about the
  trend, not a prediction of compliance."

## 04:40 — Measured results

- **Click:** **See the measured results →** (opens **Research**).
- **Judge sees:** three experiments, each stating its source notebook, what it shows and what
  it does not:
  - *Can the claims be found?* Claim recall 0.90 (macro-F1 0.8813 vs 0.6217 for the rules).
  - *Is the uncertainty honest?* 90.7% coverage at a 90% target, but 83.3% at 3–4-year gaps.
  - *What does taking uncertainty seriously change?* 475 of 518 point-estimate verdicts
    withheld.
- **Say:** "These are measured components. 91.7% is not accuracy; it's how often a
  point-estimate system would have answered when the data couldn't decide. There is no
  labelled true/false corpus for flaring claims, so we don't claim a verification accuracy."

## 05:00 — Closing

- **Say:** "Don't just read the claim. Look at the evidence, and know when the evidence
  isn't enough. GreenTruth is built to refuse to manufacture certainty."

---

**If there is extra time**

- **Workspace:** paste any text, pick a field, or load a prepared case. *More input options*
  loads the multi-claim demo report or a `.txt` / `.md` file. A report with several claims shows one
  tab per claim, with a summary line: how many claims got a verdict and how many did not.
- **Field map:** the 12 monitored fields at their real coordinates, sized by the volume
  observed in the selected year (use the year slider or *Play years*). Selecting a field shows
  its real trend and which evidence exists for it: VIIRS ✓, national series ⚠ (same
  instrument), Sentinel-5P ✓ or unavailable, operator attribution ✕ (never available).
- **Method & data:** how the four decision regions work, the verdict vocabulary, dataset
  cards, methane coverage per field, and the limitations.

**On a phone:** every view works at phone width. The trace becomes a vertical list and the
charts redraw at the screen's width.

**If something goes wrong:** the no-data, fallback and error states are designed to be shown.
Each says what happened, why, and what can still be done, and none shows invented values.
