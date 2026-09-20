<p align="center"><img src="web/icons/logo-192.png" width="96" alt="GreenTruth logo"></p>

# GreenTruth

GreenTruth checks environmental claims against real Earth observation data.

It looks at corporate statements, resolves the relevant field, compares the claim against real flaring observations, and returns a transparent verdict or an abstention when the evidence is too uncertain to decide.

## What this project does

- Detects checkable flaring claims in text
- Matches them to monitored fields
- Pulls real annual satellite observations
- Compares the claimed change with observed change
- Computes an uncertainty band
- Cross-checks against national totals and methane signals
- Produces a clear evidence story and verdict

## Why it exists

Many climate claims are written as if they are verified facts. GreenTruth tries to separate:

- what was claimed
- what the satellites actually observed
- what the data can support
- what should be withheld because the evidence is uncertain

The app is intentionally conservative: if the evidence cannot decide, it says so.

## Run locally

```bash
git clone https://github.com/RahilGhanem/GREEN-TRUTH.git
cd GREEN-TRUTH
python server.py
```

Then open:

```text
http://localhost:8000
```

No install step is required for the default setup. The app reads real data from the committed files in `data/real/` and falls back to a clear unavailable-data state if those files are missing.

## Project structure

- `server.py` — Python API and static file server
- `greentruth/` — evidence, detection, uncertainty, and verdict logic
- `web/` — frontend HTML, CSS, and JavaScript
- `data/real/` — real flaring and methane observation files
- `docs/` — architecture, API, research, and methodology notes
- `tests/` — backend verification tests

## Vercel deployment

If the repo is connected to Vercel and the GitHub branch is set to deploy, Vercel will update automatically when you push to the connected branch.

This repo already includes a Vercel config in `vercel.json`, and the app is set to deploy from the `web/` folder with the API route defined under `api/`.

Typical flow:

```bash
git add .
git commit -m "Update GreenTruth"
git push origin main
```

Then Vercel will trigger a redeploy automatically.

If you have not connected the GitHub repo to Vercel yet, connect it in the Vercel dashboard and select this repository. After that, each push to `main` should redeploy.

## Data and methodology

This project uses public Earth observation data and checks claims against real evidence rather than synthetic data. The main research and documentation live here:

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/API.md](docs/API.md)
- [docs/RESEARCH_METHOD.md](docs/RESEARCH_METHOD.md)
- [docs/LIMITATIONS.md](docs/LIMITATIONS.md)
- [DATA.md](DATA.md)
- [RESULTS.md](RESULTS.md)
- [DEMO.md](DEMO.md)

## License and notes

This project is intended for research, demonstration, and transparent environmental claim checking. It is not a commercial audit engine or a claim about a specific operator.

The app is deliberately conservative and prefers abstention over unsupported certainty.
5. **Run the server**: `python server.py` (or `.venv/Scripts/python server.py` for ClimateBERT).
6. **Run the tests**: `python -m unittest discover -s tests`.
7. **Re-derive the results** (optional): `python scripts/run_ablation.py`,
   `python scripts/eval_rule_detector.py`, `python scripts/build_experiment_registry.py`,
   and the notebooks in `notebooks/` — see [notebooks/README.md](notebooks/README.md).

## Tests

```bash
python -m unittest discover -s tests
```

**115 tests, all passing** on the final build. They cover claim decomposition, historical
verdicts, uncertainty-driven abstention, pledges, unsupported metrics, missing data,
field ambiguity, evidence sufficiency, cross-scale and methane cross-checks, measured
results, provenance, the detector fallback, the API response shape, that the demo
narration quotes the numbers the pipeline actually computes, and the Vercel entry point
(`tests/test_vercel_adapter.py`: every endpoint in both URL forms Vercel may deliver,
input errors, and the deployment configuration). The only
stand-in numbers in the repository are small series injected by these tests, labelled as
synthetic in the test file and never shown as evidence.

## Deployment

The same code runs in both places. `server.py`'s request handler serves the API locally,
and a thin adapter serves it on Vercel. No scientific or API logic exists in two copies.

### Local development

```bash
python server.py                       # http://localhost:8000: interface + API, standard library only
python server.py 8080                  # another port
python -m unittest discover -s tests   # 115 tests
```

### Vercel

One project, one domain. The interface is served as static files, and the API as one Python
function:

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
2. Leave the settings as detected. The Framework Preset is **Other** and the Root Directory
   is `./`. Leave the Build, Output and Install commands empty; `vercel.json` sets the
   output directory to `web`.
3. Add no environment variables, then choose **Deploy**.

After that, every push to `main` deploys to production, and other branches get preview
URLs. From a terminal instead: `npm i -g vercel`, `vercel login`, `vercel` (preview), then
`vercel --prod`.

**Environment variables.** None are required. The optional ones:

| Variable | Effect |
|---|---|
| `GREENTRUTH_DETECTOR` | `auto` (default), `rule_based` or `climatebert`. On Vercel, `auto` resolves to `rule_based`, because the transformer packages are not installed. |
| `GREENTRUTH_CORS_ORIGIN` | Only for an interface hosted on another origin. Not needed on Vercel, which is same-origin. |

`HF_TOKEN` and `GEE_PROJECT` are only used by the notebooks. Do not set them on Vercel.

**API.** Same paths as locally, all same-origin:

- `GET` `/api/health`, `/api/meta`, `/api/fields`, `/api/fields/<id>/observations`,
  `/api/map`, `/api/basemap`, `/api/research`, `/api/methane/coverage`, `/api/demo`,
  `/api/demo/cases`
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

The Vercel deployment runs the **rule-based fallback**, and says so. `/api/health` reports
`"detector": "rule_based", "fallback": true`, the top bar reads *Detector: rule-based
(fallback)*, and every result repeats it. `torch` and `transformers` stay optional and are
not in `requirements.txt`. PyTorch plus the model weights are large compared with Vercel's
500 MB function limit and would slow every cold start, so running the transformer on Vercel
was not attempted.

The three demo cases give identical verdicts with either detector (tested). On free text,
though, the rules find fewer claims: measured claim recall is 0.2687, against 0.8955 for
ClimateBERT. To use ClimateBERT, run the app locally from an environment with `torch` and
`transformers` (see [Reproducibility](#reproducibility)).

### Production limitations

- **Rule-based detector**, as above.
- **Stateless.** Nothing is stored on the server. The session history on the Field map
  lives in the browser tab.
- **Cold starts.** The first request after an idle period loads the engine (a few small
  data files) before answering. Warm requests take about 20 ms of analysis time, measured
  locally.
- **Request size.** The API rejects report text over 1 MB with a `413`. Vercel's own
  request-body limit is 4.5 MB.
- **Data snapshot.** The committed CSVs are the notebook 03 run (2012–2024). Updating them
  means re-running notebook 03 and committing the new files.
- **Provenance access date.** The access date shown in the evidence trace comes from the
  data file's timestamp. On Vercel, and on any fresh clone, that is the checkout time, not
  when the data was downloaded. The Method & data page labels it a proxy.
- **Plan terms.** Vercel's free Hobby plan is for non-commercial use. The ClimateBERT
  detector is CC BY-NC-SA, also non-commercial, although it is not deployed.

## Repository structure

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

## Hackathon Work

GreenTruth was developed for NextStep Hacks 2026 (Earth Forward). The split below follows
the project's own records in [docs/archive/](docs/archive/).

### Before the hackathon

The starting point, *GreenTruth v0*, is described in
[docs/archive/AUDIT_AND_UPGRADE_PLAN.md](docs/archive/AUDIT_AND_UPGRADE_PLAN.md):

- a three-stage pipeline (claim detection → evidence → verdict) of about 1,080 lines of
  Python, HTML, CSS and JavaScript, with a standard-library server and a plain web page;
- rule-based claim detection with topic tagging and number extraction;
- a bootstrap 90% interval around the observed change, five verdict labels and a heuristic
  confidence number;
- synthetic flaring data and fictional companies, labelled as synthetic;
- four unit tests.

### During the hackathon

- **Real evidence.** Notebook 03 fetches the World Bank Global Gas Flaring Tracker (VIIRS)
  for 12 fields and national totals, 2012–2024, plus Sentinel-5P methane via Earth Engine.
  The synthetic data was removed.
- **Claim detection.** ClimateBERT was fine-tuned on `environmental_claims` (notebook 01),
  published as `Rahilgh/greentruth-claim-detector`, and measured against the rules on 265
  held-out sentences (notebook 02). The rules remain as a labelled fallback.
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
- **Experiments.** Evidence walk per field (notebook 04), interval calibration (05),
  ablation (06) and case study (07). Their results are recorded in `evaluation/` and read
  by the app.
- **Interface.** Redesigned around a five-question evidence story, a guided three-case
  demo, a field map, and research and method pages. It is responsive and
  keyboard-accessible.
- **Engineering.** Documentation (this README, DEMO, RESULTS, DATA, `docs/`), tests grown
  from 4 to 115, and the Vercel deployment.

Development used AI coding assistants. Every reported number comes from the executed
notebooks and scripts in this repository.

## License and data attribution

- **Code:** no licence file has been added yet; until the authors add one, all rights are
  reserved.
- **Claim detector** (`Rahilgh/greentruth-claim-detector`): CC BY-NC-SA 4.0, inherited from
  the `environmental_claims` training data (non-commercial).
- **Flaring data:** World Bank Global Gas Flaring Tracker. Attribution as the portal
  requests: *Flare gas volumes - NOAA, the Payne Institute at the Colorado School of Mines,
  World Bank/GFMR*. The portal states no separate licence. The derived per-field and
  per-country CSVs the app reads are committed with this attribution; the raw downloads
  are not.
- **Methane:** contains modified Copernicus Sentinel data (2019–2024), accessed via Google
  Earth Engine. The derived per-field monthly CSV the app reads is committed.
- **Basemap:** Natural Earth, public domain.
- **Typeface and icons:** Roboto (SIL Open Font License 1.1); notika-icon font from the
  Notika admin template by Colorlib (MIT), whose design language the interface follows.

## Citation

If you refer to this prototype:

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

The claim-detection dataset: Stammbach, Webersinke, Bingler, Kraus, Leippold,
*A Dataset for Detecting Real-World Environmental Claims*, arXiv:2209.00507.
