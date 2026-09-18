# Notebooks

Reproducible notebooks for the model, the real-data pipeline and the experiments. Each
starts with a **notebook card**: type, purpose, inputs, outputs, where it runs, and where its
executed record lives.

| # | Notebook | Type | Output |
|---|---|---|---|
| 01 | `01_claim_detection_training.ipynb` | train + publish the claim detector | `Rahilgh/greentruth-claim-detector` (Hugging Face Hub) |
| 02 | `02_claim_detector_evaluation.ipynb` | evaluate the detector vs the rule fallback | `02_detector_metrics.json` |
| 03 | `03_real_satellite_data_pipeline.ipynb` | process the real World Bank / VIIRS data (+ optional Sentinel-5P) | `flaring_*.csv`, `methane_by_field_s5p.csv` → `data/real/` |
| 04 | `04_environmental_verification_experiment.ipynb` | walk the evidence chain for every field (probe claims) | `evaluation/04_*` |
| 05 | `05_uncertainty_calibration.ipynb` | measure interval coverage; compare conformal variants | `05_calibration.json` |
| 06 | `06_ablation_study.ipynb` | what each evidence layer changes (not accuracy) | `evaluation/ablation_results.json` |
| 07 | `07_end_to_end_case_study.ipynb` | the two demo cases through the app's code path | `evaluation/07_case_study.json` |

The order is the dependency order: 03 must run before 04–07; 01 before 02.

## Executed records — `executed/`

`notebooks/` holds the **source** notebooks, without outputs. `notebooks/executed/` holds the
runs the published numbers come from, with their outputs, never overwritten by the
registry scripts:

- 01, 02, 03, 05 — executed in Google Colab.
- 04, 06, 07 — executed locally against the final code (outputs identical to the previous
  results; see `docs/RESEARCH_METHOD.md` §8).
- `executed/results/` — the JSON and CSV files those runs wrote. The CSVs are real data
  copies and are not committed (external licence); the JSON files are.

`scripts/build_experiment_registry.py` reads `executed/results/` and writes
`evaluation/experiment_registry.json`, which is the single place the interface and the docs
read measured numbers from.

## How to run

**Colab.** Open the notebook, run top to bottom. Nothing needs uploading: datasets and the
model are downloaded, and 04–07 find the project if it is in `/content/greentruth` or on a
mounted Drive at `/content/drive/MyDrive/greentruth`.

- 01 needs a GPU runtime and a Hugging Face **write** token typed at run time (never saved
  in a cell). Re-publishing overwrites the public model — only do it deliberately.
- 03 Part A needs no account. Part B (methane) needs a free Google Earth Engine account
  and a Cloud project id.

**Locally.** From `notebooks/`, with `pandas`, `matplotlib`, `numpy` and a Jupyter kernel:

```bash
jupyter nbconvert --to notebook --execute 04_environmental_verification_experiment.ipynb --output executed/04_environmental_verification_experiment.ipynb
```

(or open them in Jupyter). 04–07 need the real CSVs in `data/real/`.

## Integrity

Every saved number is whatever the run produced; do not hand-edit results. There is no
synthetic environmental data in any notebook. Notebooks 04 and 06 use **probe claims** built
from real observed windows; they are labelled as probes, and every observation they meet is
real. A satellite signal near a field is consistent with activity there, not proof that a
particular operator caused it.
