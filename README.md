<p align="center"><img src="web/icons/logo-192.png" width="96" alt="GreenTruth logo"></p>

<h1 align="center">GreenTruth</h1>

<p align="center"><b>Ground environmental claims in real satellite evidence</b></p>

GreenTruth is an uncertainty-aware evidence platform that connects what organizations **claim** with what Earth-observation data **actually shows**.

Instead of forcing every claim into "true" or "false," GreenTruth asks a more important question:

> **Is there enough evidence to support this conclusion?**

The current prototype focuses on **gas flaring**, using real VIIRS satellite observations and Sentinel-5P methane data.

---

## The Problem

Environmental reports contain thousands of claims:

> "We reduced routine gas flaring by 40%."
> "We will eliminate routine flaring by 2030."

Finding these statements is easy. Checking them against physical evidence is much harder.

GreenTruth connects:

**Claim → Satellite observations → Uncertainty → Corroboration → Evidence sufficiency → Verdict**

---

## What GreenTruth Does

**1. Understands the claim** — a fine-tuned ClimateBERT model detects environmental claims and splits compound statements into atomic, checkable claims.

**2. Finds the relevant evidence** — claims are resolved to the likely field or basin and matched against real satellite-derived observations from the World Bank Global Gas Flaring Tracker (2012–2024, 12 monitored fields, ~99 countries, field- and country-level).

**3. Measures the observed change**, e.g.:

```
Claim:     40% reduction
Observed:  42% reduction
```

**4. Measures uncertainty** — every measurement carries a bootstrap 90% interval. When evidence is too uncertain, GreenTruth abstains rather than guess:

```
Observed change:   −29%
Interval:          −25% → +127%
Verdict:           ABSTAIN
```

**5. Cross-checks another scale** — field-level observations are compared against national flaring trends, distinguishing corroborating trends, different magnitudes, and divergent trends. Disagreement is not automatically treated as error.

**6. Adds a methane cross-check** — Sentinel-5P TROPOMI methane observations are used where coverage is usable, with the broader background trend removed before interpreting a local anomaly:

```
Raw methane change:        +52.5 ppb
Estimated background:      +40.4 ppb
Background-referenced:     +12.1 ppb
Flaring change:             −29%
```

Presented as an evidence tension — not proof of methane venting or operator responsibility.

**7. Explains what the evidence cannot prove** — GreenTruth separates what the data supports from what it cannot establish. Proximity to a field does not prove a company caused an observed change.

---

## The Core Innovation

Most claim-verification systems produce `TRUE / FALSE`. GreenTruth is designed around five decision regions:

```
SUPPORTED · PARTLY SUPPORTED · CONTRADICTED · INSUFFICIENT · ABSTAIN
```

> **Uncertainty should determine whether a verdict can be issued.**

When the evidence isn't strong enough, the system says so.

---

## Real Evidence

GreenTruth does not generate environmental measurements. Its sources:

| Source | Role |
|---|---|
| [World Bank Global Gas Flaring Tracker](https://www.worldbank.org/en/programs/gasflaringreduction/global-flaring-data) | VIIRS-based flaring observations, 2012–2024 |
| [Sentinel-5P TROPOMI (CH₄)](https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S5P_OFFL_L3_CH4) | Regional methane observations, via Earth Engine |
| [environmental_claims dataset](https://huggingface.co/datasets/climatebert/environmental_claims) | Claim-detector training/eval |
| [GreenTruth Claim Detector](https://huggingface.co/Rahilgh/greentruth-claim-detector) | Fine-tuned ClimateBERT model |
| [Zero Routine Flaring by 2030](https://www.worldbank.org/en/programs/gasflaringreduction/zero-routine-flaring-by-2030) | Public commitment reference |

---

## Measured Results

### Claim Detection

| Metric | ClimateBERT | Rule-based |
|---|---:|---:|
| Macro F1 | **0.8813** | 0.6217 |
| Claim Recall | **0.8955** | 0.2687 |
| Accuracy | **0.9057** | — |
| ROC AUC | **0.9691** | — |

*Describes the evaluated dataset only — not a claim of universal performance on environmental reports.*

### Uncertainty Calibration

Measured bootstrap coverage: **0.9071**
Alternatives measured: split conformal **0.8921** · gap-conditional conformal **0.8974**

Reported with their limitations, not as guaranteed confidence levels.

### Evidence Ablation

**475 / 518 (91.7%)** point-estimate verdicts were withheld by the uncertainty-aware system.

This is **not an accuracy figure** — it measures the effect of the uncertainty-aware decision mechanism in preventing potentially unsupported conclusions.

---

## Two Demo Cases

**Niger Delta**
```
Claimed reduction:    −40%
Observed reduction:   −42%
Observed interval:    −44% → −13%
Verdict:               SUPPORTED
Evidence:               PARTIALLY SUFFICIENT
```
Observations are consistent with the claim, while the system still shows the limits of what the evidence establishes.

**Permian**
```
Observed change:        −29%
Uncertainty interval:  −25% → +127%
Verdict:                 ABSTAIN
```
The point estimate suggests a reduction; the uncertainty tells a different story. A background-referenced methane anomaly of ~**+12.1 ppb** is also surfaced — not as a cause, but as a tension for further investigation.

---

## Evidence Architecture

```
                 ENVIRONMENTAL REPORT
                         |
                         v
                 CLAIM DETECTION
                         |
                         v
                CLAIM DECOMPOSITION
                         |
                         v
                  FIELD MATCHING
                         |
             +-----------+-----------+
             |                       |
             v                       v
       VIIRS FLARING          TROPOMI METHANE
             |                       |
             v                       v
      TRAJECTORY ANALYSIS     BACKGROUND CORRECTION
             |                       |
             +-----------+-----------+
                         |
                         v
                    UNCERTAINTY
                         |
                         v
                  CORROBORATION
                         |
                         v
               EVIDENCE SUFFICIENCY
                         |
                         v
                EVIDENCE SYNTHESIS
                         |
                         v
              VERDICT OR ABSTENTION
```

---

## Why It Matters

GreenTruth is not designed to replace environmental auditors, scientists, or regulators. It is designed to make environmental evidence:

**measurable · traceable · explainable · uncertainty-aware · reproducible**

Most importantly, it makes the **limits of evidence visible**.

---

## Technology

```
AI                    Earth Observation        Evidence Reasoning
  ClimateBERT            VIIRS                    Trajectory analysis
  Claim classification   Sentinel-5P / TROPOMI     Uncertainty intervals
  Claim decomposition                              Abstention
                                                    Evidence sufficiency
Application                                        Cross-scale corroboration
  Python                                           Cross-sensor comparison
  REST API
  Interactive web interface        Research
  Interactive 3D globe               Jupyter / Google Colab
                                      Reproducible experiments
                                      Evaluation & dataset registries
```

---

## Run Locally

```bash
git clone https://github.com/RahilGhanem/GREEN-TRUTH.git
cd GREEN-TRUTH
python server.py
```

Then open: **http://localhost:8000**

No install step is required for the default setup — the app reads real data from the committed files in `data/real/` and falls back to a clear unavailable-data state if those files are missing.

> Notes: the app uses a dark theme by default, and the 3D globe is the active map view (the flat map is not used).

### Reproducibility (optional)

```bash
python server.py                                  # or .venv/Scripts/python server.py for ClimateBERT
python -m unittest discover -s tests               # run the tests
python scripts/run_ablation.py                     # re-derive the ablation results
python scripts/eval_rule_detector.py                # re-derive the detector comparison
python scripts/build_experiment_registry.py         # rebuild the experiment registry
```

See the notebooks in `notebooks/` (`notebooks/README.md`) to re-run the full research pipeline.

---

## Tests

```bash
python -m unittest discover -s tests
```

**115 tests, all passing** on the final build. They cover claim decomposition, historical verdicts, uncertainty-driven abstention, pledges, unsupported metrics, missing data, field ambiguity, evidence sufficiency, cross-scale and methane cross-checks, measured results, provenance, the detector fallback, the API response shape, that the demo narration quotes the numbers the pipeline actually computes, and the Vercel entry point (every endpoint in both URL forms Vercel may deliver, input errors, and the deployment configuration). The only stand-in numbers in the repository are small series injected by these tests, labelled as synthetic and never shown as evidence.

---

## Deployment

The same code runs locally and on Vercel — `server.py`'s request handler serves the API locally, and a thin adapter serves it on Vercel. No scientific or API logic exists in two copies.

### Local development

```bash
python server.py                       # http://localhost:8000: interface + API, standard library only
python server.py 8080                  # another port
python -m unittest discover -s tests   # 115 tests
```

### Vercel

One project, one domain. The interface is served as static files, and the API as one Python function:

```
Browser ──> https://<project>.vercel.app
              ├── /, /app.js, /js/*, /fonts/*, /icons/*, /hero-bg.mp4   static, from web/
              └── /api/*  ──> api/index.py ──> server.Handler ──> greentruth/ ──> data/, evaluation/
```

| File | Why it exists |
|---|---|
| `vercel.json` | Selects the "Other" framework preset, so the root `server.py` is not mistaken for a Flask/FastAPI entrypoint. Serves `web/` as the static root. Sends every `/api/*` request to one function through a single rewrite. Keeps `web/`, `notebooks/`, `docs/`, `tests/` and `scripts/` out of the function bundle. |
| `api/index.py` | Vercel accepts a `BaseHTTPRequestHandler` subclass named `handler`, and `server.Handler` already is one. The adapter subclasses it, restores the original `/api/...` path from the rewrite, and leaves static files to Vercel's CDN. |
| `.vercelignore` | Keeps `.venv`, `.env`, caches and local-only files out of `vercel deploy` uploads from a working copy. It mirrors `.gitignore`. |

**Deploy from GitHub (recommended).**

1. On vercel.com, choose **Add New… → Project**, then import `RahilGhanem/GREEN-TRUTH`.
2. Leave the settings as detected. The Framework Preset is **Other** and the Root Directory is `./`. Leave the Build, Output and Install commands empty; `vercel.json` sets the output directory to `web`.
3. Add no environment variables, then choose **Deploy**.

After that, every push to `main` deploys to production, and other branches get preview URLs.

```bash
git add .
git commit -m "Update GreenTruth"
git push origin main
```

From a terminal instead: `npm i -g vercel`, `vercel login`, `vercel` (preview), then `vercel --prod`.

**Environment variables.** None are required. The optional ones:

| Variable | Effect |
|---|---|
| `GREENTRUTH_DETECTOR` | `auto` (default), `rule_based` or `climatebert`. On Vercel, `auto` resolves to `rule_based`, because the transformer packages are not installed. |
| `GREENTRUTH_CORS_ORIGIN` | Only for an interface hosted on another origin. Not needed on Vercel, which is same-origin. |

`HF_TOKEN` and `GEE_PROJECT` are only used by the notebooks — do not set them on Vercel.

**API.** Same paths as locally, all same-origin:

- `GET` `/api/health`, `/api/meta`, `/api/fields`, `/api/fields/<id>/observations`, `/api/map`, `/api/basemap`, `/api/research`, `/api/methane/coverage`, `/api/demo`, `/api/demo/cases`
- `POST` `/api/analyze`

See [docs/API.md](docs/API.md).

**Check a deployment:**

```bash
URL=https://<project>.vercel.app
curl -s $URL/api/health          # "has_real_data": true, "n_observations": 156, detector rule_based + "fallback": true
curl -s -X POST $URL/api/analyze -H "Content-Type: application/json" \
  -d '{"text":"We reduced routine gas flaring by 25% from 2019 levels.","company":"Permian Basin"}'
                                 # claims[0].verdict == "abstain", interval ≈ [-0.248, 1.267]
```

### ClimateBERT in production

The Vercel deployment runs the **rule-based fallback**, and says so. `/api/health` reports `"detector": "rule_based", "fallback": true`, the top bar reads *Detector: rule-based (fallback)*, and every result repeats it. `torch` and `transformers` stay optional and are not in `requirements.txt`. PyTorch plus the model weights are large compared with Vercel's 500 MB function limit and would slow every cold start, so running the transformer on Vercel was not attempted.

The three demo cases give identical verdicts with either detector (tested). On free text, though, the rules find fewer claims: measured claim recall is 0.2687, against 0.8955 for ClimateBERT. To use ClimateBERT, run the app locally from an environment with `torch` and `transformers`.

### Production limitations

- **Rule-based detector**, as above.
- **Stateless.** Nothing is stored on the server. The session history on the Field map lives in the browser tab.
- **Cold starts.** The first request after an idle period loads the engine (a few small data files) before answering. Warm requests take about 20 ms of analysis time, measured locally.
- **Request size.** The API rejects report text over 1 MB with a `413`. Vercel's own request-body limit is 4.5 MB.
- **Data snapshot.** The committed CSVs are the notebook 03 run (2012–2024). Updating them means re-running notebook 03 and committing the new files.
- **Provenance access date.** The access date shown in the evidence trace comes from the data file's timestamp. On Vercel, and on any fresh clone, that is the checkout time, not when the data was downloaded. The Method & data page labels it a proxy.
- **Plan terms.** Vercel's free Hobby plan is for non-commercial use. The ClimateBERT detector is CC BY-NC-SA, also non-commercial, although it is not deployed.

---

## Repository Structure

```
README.md  DEMO.md  RESULTS.md  DATA.md     ← start here
server.py                 web server + JSON API (standard library only)
api/index.py              Vercel entry point: reuses server.py's handler, adds no logic
vercel.json               Vercel configuration (static web/, one Python function)
greentruth/               the pipeline, one module per stage
web/                      interface (HTML/CSS/JS, no build step, fonts vendored)
data/                     field reference, dataset registry, basemap; runtime CSVs in data/real/
notebooks/                01–07 source notebooks; executed/ holds the recorded runs
evaluation/               measured results (registry, baseline, ablation, case studies)
scripts/                  reproduce the registry, baseline, ablation, dataset cards
tests/                    unit tests
docs/                     architecture, API, method, limitations, detailed results
```

**More details:** [Architecture](docs/ARCHITECTURE.md) · [API](docs/API.md) · [Research Method](docs/RESEARCH_METHOD.md) · [Limitations](docs/LIMITATIONS.md) · [Data](DATA.md) · [Results](RESULTS.md) · [Demo](DEMO.md)

---

## Current Scope

GreenTruth currently focuses on **gas-flaring claims**. It does not claim to verify every environmental statement. It works with real flaring observations, country-level flaring data, methane cross-checks where coverage is usable, environmental claim detection, historical claims, future commitments, and uncertainty-aware verdicts.

---

## Limitations

- Only 12 monitored fields are used in the current demonstration
- Satellite observations do not establish operator responsibility
- Methane observations are regional rather than facility-level
- Some evidence sources share the same VIIRS measurement programme
- Methane coverage is incomplete
- No adjudicated end-to-end ground-truth dataset exists
- Uncertainty intervals have measured empirical coverage but no analytical guarantee
- Future trajectories are not predictions
- The current verification channel focuses on gas flaring

These limitations are intentionally visible in the application.

---

## What GreenTruth Does Not Claim

GreenTruth does **not** claim to:

- prove that a company is honest or dishonest
- automatically detect greenwashing
- prove regulatory compliance
- identify which operator caused an environmental change
- prove methane venting
- predict future flaring
- provide guaranteed confidence intervals
- verify every type of environmental claim
- replace scientific or regulatory review

---

## Research Question

> **Can an abstention-first Earth-observation framework make environmental claim verification more transparent and reliable than text-only claim detection?**

The project investigates this by combining: natural language + Earth observation + uncertainty + evidence sufficiency + cross-source comparison + abstention.

---

## Hackathon Work

GreenTruth was developed for NextStep Hacks 2026 (Earth Forward). The split below follows the project's own records in [docs/archive/](docs/archive/).

### Before the hackathon

The starting point, *GreenTruth v0*, is described in [docs/archive/AUDIT_AND_UPGRADE_PLAN.md](docs/archive/AUDIT_AND_UPGRADE_PLAN.md):

- a three-stage pipeline (claim detection → evidence → verdict) of about 1,080 lines of Python, HTML, CSS and JavaScript, with a standard-library server and a plain web page;
- rule-based claim detection with topic tagging and number extraction;
- a bootstrap 90% interval around the observed change, five verdict labels and a heuristic confidence number;
- synthetic flaring data and fictional companies, labelled as synthetic;
- four unit tests.

### During the hackathon

- **Real evidence.** Notebook 03 fetches the World Bank Global Gas Flaring Tracker (VIIRS) for 12 fields and national totals, 2012–2024, plus Sentinel-5P methane via Earth Engine. The synthetic data was removed.
- **Claim detection.** ClimateBERT was fine-tuned on `environmental_claims` (notebook 01), published as `Rahilgh/greentruth-claim-detector`, and measured against the rules on 265 held-out sentences (notebook 02). The rules remain as a labelled fallback.
- **Verification logic, rebuilt:**
  - compound sentences split into atomic claims;
  - field resolution that surfaces ambiguity;
  - four decision regions with abstention, replacing the confidence number;
  - pledge trajectories;
  - the national cross-scale check;
  - the background-corrected methane cross-check;
  - side-by-side source synthesis;
  - evidence sufficiency with an evidence ceiling;
  - a 13-step provenance chain.
- **Experiments.** Evidence walk per field (notebook 04), interval calibration (05), ablation (06) and case study (07). Their results are recorded in `evaluation/` and read by the app.
- **Interface.** Redesigned around a five-question evidence story, a guided three-case demo, a field map, and research and method pages. It is responsive and keyboard-accessible.
- **Engineering.** Documentation (this README, DEMO, RESULTS, DATA, `docs/`), tests grown from 4 to 115, and the Vercel deployment.

Development used AI coding assistants. Every reported number comes from the executed notebooks and scripts in this repository.

---

## License & Data Attribution

- **Code:** no licence file has been added yet; until the authors add one, all rights are reserved.
- **Claim detector** (`Rahilgh/greentruth-claim-detector`): CC BY-NC-SA 4.0, inherited from the `environmental_claims` training data (non-commercial).
- **Flaring data:** World Bank Global Gas Flaring Tracker. Attribution: *Flare gas volumes - NOAA, the Payne Institute at the Colorado School of Mines, World Bank/GFMR*. The derived per-field and per-country CSVs are committed with this attribution; raw downloads are not.
- **Methane:** contains modified Copernicus Sentinel data (2019–2024), accessed via Google Earth Engine. The derived per-field monthly CSV is committed.
- **Basemap:** Natural Earth, public domain.
- **Typeface & icons:** Roboto (SIL Open Font License 1.1); notika-icon font from the Notika admin template by Colorlib (MIT).

## Citation

```bibtex
@software{greentruth_2026,
  title  = {GreenTruth: uncertainty-aware verification of environmental claims
            against Earth-observation evidence},
  author = {{GreenTruth team}},
  year   = {2026},
  note   = {Research prototype. Claim detector:
            https://huggingface.co/Rahilgh/greentruth-claim-detector}
}
```

Claim-detection dataset: Stammbach, Webersinke, Bingler, Kraus, Leippold, *A Dataset for Detecting Real-World Environmental Claims*, arXiv:2209.00507.

---

<p align="center"><b>The Principle</b></p>

Environmental evidence should not always end with a confident answer. Sometimes the most responsible answer is:

> **The evidence is not enough.**

GreenTruth makes that answer measurable, explainable, and visible.

<p align="center"><b>Observe. Measure. Compare. Explain. Abstain when necessary.</b></p>
