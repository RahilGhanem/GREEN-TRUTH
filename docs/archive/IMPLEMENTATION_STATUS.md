# GreenTruth — Implementation Status

> **UPDATE (2026-09-17, after the P0 implementation pass).**
> The defects recorded below as §2.1, §2.2, §2.3, §2.4, §2.6, §2.7 and §2.8 have
> been **fixed and covered by tests** (45 passing). What changed:
>
> | was | now |
> |---|---|
> | compound sentence → 1 claim, `insufficient_evidence` | `decompose.py` → atomic claims; the demo sentence yields a historical reduction + a future commitment |
> | interval −70%…+88% still returned `supported` | `verdict.py` decision regions → **`abstain`** when the interval spans them |
> | target year beyond the data → `insufficient_evidence` | `trajectory.py` → projection with a 90% band and a trajectory verdict |
> | `schema.py` / `metrics.py` dead code | imported by five modules each |
> | stale failing test | rebuilt against an `Evidence` with a non-existent path |
> | `no_proxy` vs `NO_SIGNAL` mismatch | one vocabulary, from `schema.py` |
> | ClimateBERT published but unused | `detectors.py`, loaded when available, with a **reported** fallback |
>
> Still open, and unchanged from the audit: **§2.5** (no conformal calibration —
> `greentruth/calibration.py` still does not exist) and **§2.9** (the detector's
> accuracy has never been measured, so no detection metric is shown anywhere).
> §9's list of unknowns also stands.
>
> New files since the audit: `detectors.py`, `decompose.py`, `provenance.py`,
> `sufficiency.py`, `trajectory.py`, `docs/API.md`, `.env.example`,
> `data/geo/world_110m.json`.

> **UPDATE 2 (same day, corroboration pass).**
> `greentruth/corroboration.py` added. The national-totals series that was already on
> disk (1,287 rows, 99 countries) is now used as a **second real evidence view at a
> different spatial scale**. The sufficiency check "Independent corroboration" was a
> hardcoded permanent warning; it now reports an actual measurement.
>
> Measured across all 12 fields, 2019→2024: **6 corroborate, 2 same-direction, 3 diverge**
> (Rumaila, Tengiz, Cantarell). Those divergences are real, not manufactured, and are
> explained as spatial-scale effects rather than treated as errors — a field can fall
> while its country rises.
>
> Two notebooks added, both Colab-ready with automatic download and no manual upload:
> `02_claim_detector_evaluation.ipynb` (fills the §2.9 metrics gap) and
> `05_uncertainty_calibration.ipynb` (tests §2.5, whether the shipped bootstrap reaches
> nominal coverage). **Neither has been run** — they need Colab, so their outputs do not
> exist yet and no number from them is quoted anywhere.
>
> Tests: 45 → **57, all passing.**


**Audit date:** 2026-09-17
**Audited by:** direct inspection of every source file, execution of the test suite, and a live
run of the server against the real data currently in `data/real/`.

Everything below was verified by running it, not inferred from the README. Where a claim in this
document could not be verified, it says so.

---

## 0. One-paragraph summary

The backend spine works and the evidence is real. A 12-field × 13-year World Bank/VIIRS flaring
series is present and loading, the server answers both endpoints, and 5 of 6 tests pass. The
project is further along than its README suggests in one respect (real data is in place) and
further behind in another: **a second, much richer generation of the claim model exists in
`schema.py` and `metrics.py` but is dead code — nothing imports it.** The single most important
finding is that **the exact claim the hackathon demo is built around currently returns
"insufficient evidence"**, for a fixable reason. Three defects in the verdict layer would
undermine the scientific story if demoed as-is.

---

## 1. What already works (verified by execution)

### 1.1 Backend pipeline — works

`greentruth/` is a clean three-stage pipeline, standard library only, no install step:

| module | status | what it does |
|---|---|---|
| `claims.py` | works | sentence split, topic tagging, regex quantity extraction |
| `evidence.py` | works | loads fields + real annual flaring series, resolves field by name/id/country |
| `verdict.py` | works, but see §2 | observed change, residual-bootstrap interval, decision |
| `pipeline.py` | works | orchestrates the three, returns result JSON |
| `__init__.py` | works | exports `GreenTruth` |

### 1.2 Server — works

```
python server.py 8971
GET  /api/meta     -> 200  {companies[12], unit, has_real_data: true, claim_source}
POST /api/analyze  -> 200  {company, facilities, summary, claims[]}
```

Verified live. `has_real_data` returns `true`. Zero dependencies — this is a genuine asset for a
live demo and should be preserved as a fallback path.

### 1.3 Real data — present and complete

The README says the CSVs are not shipped. **They are present**, and they are real:

| file | rows | coverage | source column |
|---|---|---|---|
| `data/real/flaring_by_field.csv` | 156 | 12 fields × 13 years (2012–2024), no gaps | yes — "World Bank Global Gas Flaring Tracker (VIIRS) — REAL" |
| `data/real/flaring_by_country.csv` | 1287 | ~99 countries × 13 years | yes |
| `data/real/flaring_by_operator.csv` | 14694 | operator × year | **no source column** |
| `data/facilities_international.json` | 12 fields | real names, countries, lat/lon, match radii | — |

All 12 fields in the JSON have a matching 13-year series. Field ids line up exactly. Coordinates
are real. Unit is `billion m3 flared per year`.

This means **notebook 03 has been run** and its outputs downloaded. The plan document in
`docs/AUDIT_AND_UPGRADE_PLAN.md` treats synthetic evidence as "the biggest gap and the first thing
to fix" — that gap is now **closed**, and that document is stale on this point.

### 1.4 Tests — 5 of 6 pass

```
python -m unittest discover -s tests
Ran 6 tests — FAILED (failures=1)
```

Passing: supported / contradicted / partially_supported on injected series, flaring claim
detection, non-flaring → `no_proxy`.

### 1.5 Trained model — exists on Hugging Face, do not overwrite

`Rahilgh/greentruth-claim-detector` is **live and public**, last modified 2026-09-17T10:53Z.

```
architectures: ["RobertaForSequenceClassification"]
id2label:      {0: "not_claim", 1: "environmental_claim"}
files:         config.json, model.safetensors, tokenizer.json, tokenizer_config.json, README.md
downloads:     0
```

Real fine-tuned weights are on the Hub. **Notebook 01 must not be re-run in a way that overwrites
this repository** without an explicit decision.

### 1.6 Frontend — works, but is the weakest part

`web/` is vanilla HTML + CSS + JS (~15 KB total): a field dropdown, a textarea, a "Check claims"
button, and a results feed of verdict cards with a sparkline and a confidence bar. It is clean and
functional. It has no build step, no component model, no charts library, no map, and no routing.
This is the part the redesign replaces.

---

## 2. What is broken (verified, with reproductions)

### 2.1 **DEMO-BLOCKING — the headline demo claim returns "insufficient evidence"**

```
POST /api/analyze {"text": "We reduced routine gas flaring by 40% from 2019 levels
                            and will eliminate routine flaring by 2030.",
                   "company": "Bakken"}
->  verdict: insufficient_evidence
    rationale: "The claim points at 2019->2030, but the real series only covers 2012-2024."
```

**Cause.** The sentence contains two claims — a historical reduction (40% from 2019) and a future
commitment (eliminate by 2030). `claims.py` treats it as one. The `_BY_YEAR` regex grabs `2030` as
the *target year*, so the engine tries to evaluate 2019 → 2030 against a series ending in 2024.

Splitting the sentence by hand proves the machinery underneath is fine:

| input | verdict |
|---|---|
| full compound sentence | `insufficient_evidence` |
| "…reduced flaring by 40% from 2019 levels." | `supported` |
| "…will eliminate routine flaring by 2030." | `insufficient_evidence` |

This is exactly the claim-decomposition requirement. It is the **first thing to fix** — it is a
correctness bug and a demo blocker at the same time.

### 2.2 **The uncertainty interval is not usable as stated**

On Bakken, the engine reports:

```
Observed flaring in 2024 was 63% lower than 2019 (90% interval -70% to 90%)
```

An interval running from −70% to **+90%** spans "flaring nearly eliminated" to "flaring almost
doubled". It carries no information. Two consequences:

1. The interval is labelled a "90% interval" in the UI and the rationale. It is a residual
   bootstrap around a linear trend fitted to 13 annual points on a non-monotonic series; it is not
   calibrated and its coverage has never been measured.
2. `_decide()` falls through to its last branch and returns **`supported`** on the strength of the
   point estimate alone, with `confidence = 0.45`. A verdict of "supported" is being issued from an
   interval that cannot distinguish a 63% cut from a doubling.

Under the abstention requirement this case must return **abstain**, not "supported". The vocabulary
for that already exists in `schema.py` (`ABSTAIN`) and is unused.

### 2.3 **No trajectory logic**

"We will eliminate routine flaring by 2030" → `insufficient_evidence` because 2030 is outside the
data. A commitment claim should instead be projected from the observed trend and reported as
on/off trajectory. `schema.py` already defines `TRAJECTORY_CONSISTENT`, `TRAJECTORY_UNCERTAIN`,
`TRAJECTORY_INCONSISTENT` — all unused.

### 2.4 **`schema.py` and `metrics.py` are dead code**

Verified by grep: **nothing in the codebase imports either module.**

They are high-quality and contain most of what the upgrade needs — a full `Claim` dataclass with
21 fields, the complete verdict vocabulary including the four abstention outcomes, careful
non-accusatory `VERDICT_MEANINGS`, value-provenance labels (`OBSERVED` / `ESTIMATED` / `PROJECTED`
/ `UNCERTAIN`), a `SUPPORTED_METRICS` registry, and `unsupported_reason()` text.

**This is good news: the design work is done and does not need redoing — it needs wiring.**

### 2.5 **`greentruth/calibration.py` is referenced but does not exist**

`schema.py` line 13 states "The only calibrated numbers in GreenTruth come from
`greentruth/calibration.py`." That file is absent. There is no conformal calibration in the
project today.

### 2.6 **Failing test is stale**

`test_flaring_claim_without_real_data_asks_for_notebook` asserts `insufficient_evidence` for
Hassi Messaoud "with no data/real/ CSV present". Real data is now present, so the verdict is
`supported` and the test fails. The test needs to construct an `Evidence` with an empty path
rather than assuming the repo has no data.

### 2.7 **Verdict vocabulary is inconsistent across layers**

| layer | vocabulary |
|---|---|
| `verdict.py`, `pipeline.py`, `web/app.js` | `no_proxy` (5 verdicts) |
| `schema.py` | `NO_SIGNAL` (10 verdicts, incl. 4 abstention + 3 trajectory) |

The frontend hardcodes its five and would silently render unknown verdicts as "No signal to check".

### 2.8 **The trained model is not used by the application**

`Rahilgh/greentruth-claim-detector` exists, but nothing in `greentruth/` or `server.py` loads it.
Every claim is detected by `rules`. The README's "The app can use it in place of the built-in
rule-based detector" is **not implemented**.

### 2.9 **No recorded evaluation metrics anywhere**

The HF model card says "See the notebook run for test precision/recall/macro-F1/accuracy".
Notebook 01 has **0 saved outputs**. So the model's real metrics exist nowhere in the project or on
the Hub. A benchmark page cannot show claim-detection metrics until an evaluation is actually run.
The card's mention of "~85% macro-F1" is the *source paper's* figure for comparable models, not a
measurement of this model, and must not be presented as this model's score.

### 2.10 Smaller issues

- `evidence.py` calls fields "companies" throughout (`companies()`, `resolve_company`,
  `detect_company`). They are geographic fields, not companies. Misleading but load-bearing — the
  server and frontend depend on these names.
- `flaring_by_operator.csv` (14,694 rows) is not loaded by the app and lacks a `source` column.
- `pipeline.py` has `_VERDICT_ORDER` containing `"no_proxy"`, which is not in `schema.VERDICTS`.
- No `.env.example`, no `docs/API.md`, no PDF generation, no file upload, no Claude integration.

---

## 3. Environment and toolchain

### 3.1 Frontend toolchain — ready

```
node v24.13.1
npm  11.8.0
```

React + TypeScript + Vite + Tailwind is viable with no blockers.

### 3.2 Python environment — **partially broken**

```
Python 3.11.5 (Anaconda)
numpy 2.4.4   <-- ABI mismatch
```

`pandas`, `scikit-learn` and `pyarrow` **fail to import** — they are compiled against NumPy 1.x and
the installed NumPy is 2.4.4:

```
AttributeError: _ARRAY_API not found
```

| package | status |
|---|---|
| `torch` | 2.8.0+cpu — present |
| `fastapi` / `uvicorn` | 0.109.2 / 0.27.1 — present |
| `anthropic` | 0.50.0 — present |
| `pandas`, `sklearn`, `pyarrow` | **broken (import fails)** |
| `transformers`, `reportlab`, `pypdf` | missing |

**Consequence.** The current server is unaffected because it is standard-library only. Any backend
upgrade that imports pandas or scikit-learn will fail on this machine until a clean virtual
environment is created. Two options: keep the backend standard-library only (preserves the
zero-install demo property), or add a `.venv`. Recommendation: **keep the core standard-library**
and confine pandas/sklearn to notebooks, which run in Colab anyway.

### 3.3 Version control — not an independent repository

There is **no `.git` directory inside `greentruth/`**. `git rev-parse --show-toplevel` resolves to
`C:/Users/DELL` — the entire home directory is the repo, on branch `rahil-contribution` with **zero
commits**. Nothing in this project is currently version controlled in a usable way, and any `git`
command here walks the whole home directory (a `git status` attempt timed out after 120 s).

This should be fixed before deployment work, but it is a decision for you to make — initialising a
repo inside `greentruth/` is a change I have not made.

---

## 4. What needs modification vs. what needs building

### 4.1 Modify, do not rewrite

| file | change | risk |
|---|---|---|
| `claims.py` | add clause-level decomposition; emit `schema.Claim` | medium — tests depend on the dict shape |
| `verdict.py` | keep the decision spine; add abstention, trajectory, calibrated interval | medium — the highest-value change |
| `pipeline.py` | adopt `schema.Claim`, align verdict vocabulary | low |
| `evidence.py` | keep signatures; add field/country providers and provenance | low–medium |
| `tests/test_pipeline.py` | fix the stale test; expand | low |
| `server.py` | add endpoints; keep existing two working | low |

### 4.2 Build new

`greentruth/calibration.py` (conformal), `greentruth/trajectory.py` (2030 projection),
`greentruth/extract.py` (documents), `greentruth/report.py` (PDF), `greentruth/explain.py`
(Claude with deterministic fallback), a React/Vite frontend, `.env.example`, `docs/API.md`,
`docs/MODELS.md`, `docs/DEPLOYMENT.md`.

---

## 5. Models: what needs training, what does not

| capability | verdict | why |
|---|---|---|
| Claim detection | **already trained — do not retrain** | `Rahilgh/greentruth-claim-detector` is live with real weights. It needs **evaluation**, not training. |
| Claim detector metrics | **must be measured** | Nothing anywhere records this model's precision/recall/F1. Justifies `notebooks/02_claim_detector_evaluation.ipynb`. |
| Claim extraction / structuring | **no training needed** | Extraction here is slot-filling over a small, closed vocabulary (percent, direction, two years, field name). Rules are more accurate, fully auditable, and run offline. Training a model would add cost and opacity for no measurable gain — and `schema.py` already frames `extract_confidence` as a deterministic slot-coverage ratio, not a learned probability. Claude can optionally handle unusual phrasings on top. |
| Conformal calibration | **not a trained model** — a calibration procedure | Justifies `notebooks/05_conformal_calibration.ipynb`. |
| 2030 trajectory | **statistical, not learned** | Justifies `notebooks/07_2030_trajectory_analysis.ipynb`. |

### 5.1 A real constraint on the conformal work — flagged early

The calibration set is **12 fields × 13 years = 156 observations**. Even using all year-pairs
(78 per field → 936 change observations), these are heavily autocorrelated and drawn from only 12
independent geographic units.

This is enough to *demonstrate* a calibrated interval with leave-one-field-out calibration, and it
is enough to report empirical coverage honestly. It is **not** enough to claim tight coverage
guarantees at the 95%+ level, and conformal prediction assumes exchangeability that a 13-point
trending time series does not satisfy. The notebook must measure coverage empirically and report
the exchangeability caveat rather than asserting the theorem. I will not present a coverage number
that the sample size cannot support.

---

## 6. API keys — what is genuinely required

| key | required? | what it unlocks | behaviour without it |
|---|---|---|---|
| — none — | — | **Core flaring verification, map, charts, trajectory, PDF** | Fully functional |
| `ANTHROPIC_API_KEY` | optional | Claude claim extraction + narrative explanation | Deterministic rule extraction and template explanation |
| `HF_TOKEN` | optional | Re-uploading the detector | Model is **public**; inference needs no token |
| `GEE_PROJECT` + Earth Engine | optional | Sentinel-5P methane cross-check (notebook only) | "Methane cross-check unavailable" |

**The entire core product runs with zero API keys.** That property is worth protecting.

---

## 7. What can work with no external service

Everything that matters for the demo: claim detection (rules), claim decomposition, field
resolution, observation retrieval, change computation, uncertainty interval, trajectory projection,
abstention, verdicts, provenance, evidence graph, map (real coordinates, local GeoJSON), charts,
PDF. The real data is already on disk.

External services are needed only for: Claude narrative, ClimateBERT inference (first download),
methane, and re-uploading models.

---

## 8. Recommended order of work

Ordered by (demo risk × scientific value), not by the phase list:

1. **Fix §2.1 claim decomposition** — unblocks the demo.
2. **Fix §2.2 abstention** — stop issuing "supported" from uninformative intervals. Wire
   `schema.py` in while doing it (§2.4), which also fixes §2.7.
3. **Add trajectory** (§2.3) — the 2030 story.
4. **Replace the heuristic interval with calibrated conformal** (§2.5) + notebook 05.
5. **React/Tailwind redesign** + map + charts.
6. **Evaluate the detector** (notebook 02) so the benchmark page has real numbers, and wire the
   model into the app (§2.8).
7. Claude, PDF, adversarial tests, deployment, polish.

Steps 1–3 are correctness fixes to code that already exists and are individually testable. Step 5
is the largest volume of new work but the lowest risk to correctness.

---

## 9. Honest statement of what is not yet known

- **The detector's true accuracy on this task.** Not measured anywhere. Until notebook 02 runs, no
  claim-detection metric should appear in the UI.
- **Whether conformal calibration will achieve nominal coverage** on 12 fields. It may not, and
  that result would itself be worth reporting.
- **Whether notebook 01 was run to completion**, or with what hyperparameters — no outputs saved.
  The Hub weights exist; the training record does not.
- **Methane.** `methane_by_field_s5p.csv` is absent, so the methane layer has never run here.
