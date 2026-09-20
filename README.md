# GreenTruth

GreenTruth checks environmental claims against real Earth observation data.

It matches a company statement to the relevant field, compares the claim with actual flaring and methane signals, and returns a transparent verdict or an abstention when the evidence is uncertain.

## What this project does

- Detects checkable flaring claims in text
- Resolves the likely field or basin
- Pulls real annual satellite observations
- Compares the claimed change against observed change
- Estimates uncertainty and evidence sufficiency
- Cross-checks methane and national-level context
- Produces a verdict with an evidence story

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

## Key folders

- `server.py` — Python API and local web server
- `greentruth/` — claim detection, evidence, and verdict logic
- `web/` — interface HTML, CSS, and JavaScript
- `data/real/` — real flaring and methane data
- `docs/` — project notes, API, architecture, and methodology
- `tests/` — automated regression tests

## Important project notes

- The app uses a dark theme by default.
- The 3D globe is the active map view; the flat map is not used.
- The project is intentionally conservative: when the evidence is weak, it abstains instead of guessing.
- This is a research and demo app built around public Earth observation data, not a commercial assurance system.

## Deployment

The repo includes the Vercel config in `vercel.json` and the API adapter in `api/index.py`.

```bash
git add .
git commit -m "Update GreenTruth"
git push origin main
```

Then push to the connected GitHub branch and redeploy from Vercel.

## More details

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/API.md](docs/API.md)
- [docs/RESEARCH_METHOD.md](docs/RESEARCH_METHOD.md)
- [docs/LIMITATIONS.md](docs/LIMITATIONS.md)
- [DATA.md](DATA.md)
- [RESULTS.md](RESULTS.md)
- [DEMO.md](DEMO.md)

## Testing

```bash
python -m pytest -q
```

The project keeps a working automated test suite for the backend and pipeline behavior.

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
