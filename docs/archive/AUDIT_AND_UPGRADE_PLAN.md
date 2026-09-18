# GreenTruth — Technical Audit, Landscape Research, and Upgrade Plan

Prepared for NextStep Hacks 2026 (Earth Forward). This is the analysis you asked
for before any code changes. It inspects the actual repository, researches the
current landscape with an honest read on novelty, verifies that the real data can
actually be accessed, and proposes the strongest version that is realistically
buildable in the remaining time. Nothing here has been trained, downloaded, or
"completed" unless it says so explicitly.

One constraint up front, because it shapes everything below. The environment I ran
the audit in can reach code registries (PyPI, npm, GitHub) but not NASA Earthdata,
Copernicus, Google Earth Engine, or Hugging Face. So I can build and test the whole
Python pipeline here, but the real-satellite downloads and any transformer
training/upload have to run in a notebook on your side (Colab is ideal). Wherever
this plan says "real data" or "trained model," the deliverable is runnable code
plus exact instructions, executed by you where the connectivity and credentials
exist — not something I can pretend to have run inside the sandbox.

A backup of the current code was committed to a local git repository before writing
this (`Baseline: GreenTruth v0`), so nothing is at risk when we start changing it.

---

## 1. Current GreenTruth architecture

The repository is a small, clean, three-stage pipeline with a thin web layer. It is
about 1,080 lines of Python, HTML, CSS, and JavaScript, with no third-party runtime
dependencies.

The flow is: a report's text goes into claim detection, which splits it into
sentences and keeps the ones that read as checkable environmental claims, tagging
each with a topic and pulling out any numbers. Those claims go to an evidence layer
that loads a company-to-facilities table and a flaring time series, resolves the
company, and aggregates its facilities into one monthly series. Each claim then
goes to a verdict layer that measures the observed change between a baseline year
and a target year, wraps a bootstrap 90% interval around that change, compares it to
what was claimed, and returns one of five verdicts (supported, partly supported,
contradicted, not enough data, no signal to check) with a confidence number and a
plain-language rationale. A standard-library web server serves a small JSON API and
a vanilla front end that renders each claim as a card with a verdict stamp, a
flaring sparkline, the key figures, a confidence bar, and the rationale.

Concretely, the pieces are: `greentruth/claims.py` (detection, quantity
extraction, topic typing), `greentruth/evidence.py` (facilities and series loading,
company resolution, annual aggregation), `greentruth/verdict.py` (bootstrap
interval, decision logic, heuristic confidence), `greentruth/pipeline.py`
(orchestration), `server.py` (a `http.server` app), `web/` (the interface),
`data/` (a facilities table, a synthetic flaring CSV, a generator, and three
synthetic sample reports), and `tests/` (four unit tests that pin the demo
verdicts).

## 2. Current strengths

The honesty is the strongest asset. The synthetic flaring data is labelled as
synthetic everywhere it appears, the companies are openly fictional, and the README
says so plainly. For a project whose entire purpose is checking other people's
claims, refusing to fake its own evidence is not a minor virtue — it is the whole
credibility of the concept, and it is already right.

The architecture is genuinely modular. The three stages talk through simple data
structures, so each one can be replaced without touching the others: swap the rule
detector for a transformer and nothing downstream changes; swap the synthetic CSV
for real VIIRS volumes and the verdict logic is untouched. That is exactly the
property we need to upgrade this quickly.

The verdict layer already does something more thoughtful than a yes/no. It measures
an observed change, puts a resampled interval around it, and reasons about where
the claimed value sits relative to that interval. The demo is well-constructed: the
three sample reports were tuned so one is supported, one contradicted, one partly
supported, and the supported one deliberately lands right on the promised line so
its confidence is low — a small but real demonstration of why uncertainty matters.

It runs with zero installation, which removes the single most common way a live demo
dies.

## 3. Current weaknesses

The evidence is synthetic. This is fine as a scaffold and honest as presented, but
it means the current project demonstrates a mechanism rather than a finding. For the
research experiments you want, and for the strongest version of the hackathon
pitch, the measurements have to be real. This is the biggest gap and the first thing
to fix.

The claim detector is rule-based. It is precise and transparent, but it keys on a
fixed vocabulary and a set of achievement verbs, so it will silently miss claims
phrased in ways it does not anticipate, and it cannot separate a genuine claim from
confident-sounding framing beyond the heuristics already in place. There is no ML
here yet, which the hackathon's "learning" and "technology" criteria will notice.

The system handles one claim per sentence and one signal (flaring). It cannot break a
compound sentence ("we cut methane 30%, eliminated routine flaring, and reached 40%
renewables") into separate atomic claims, and every non-flaring claim is honestly
but bluntly returned as "no signal to check."

The confidence score is a heuristic — distance from a decision boundary in interval
half-widths, clipped to a range. It is defensible and clearly labelled as a
heuristic, but it is not calibrated, which matters because your own published work
is precisely about calibrated uncertainty for satellite time series. This is a
weakness that happens to line up with your strongest skill.

The "not enough data" and "no signal" outcomes do not yet explain *why* — whether
the years do not overlap, the resolution cannot attribute a signal to the facility,
or the topic simply has no channel wired up. That explanation is where a lot of the
scientific credibility lives.

There is no map, no entity/location linking beyond a hand-written table, and no
claimed-versus-observed trajectory view. The interface is clean but does not yet
make the physical-world connection visually obvious.

## 4. What breaks if modified, and what to reuse

Reuse the whole spine: the three-stage split, the evidence/verdict data contracts,
the server, and the front-end scaffold. The verdict decision logic is worth keeping
and extending rather than rewriting. The bootstrap interval stays and becomes one
input to a calibrated interval.

The parts to treat carefully: `evidence.py` currently assumes one signal with a
fixed unit and a monthly CSV. Turning it into a multi-signal "evidence provider"
interface is the main structural change, and it will ripple into `verdict.py` (which
assumes a single flaring series) and the API shape (which the front end reads). That
is the one change that can break things if done carelessly, so it should be done
behind the existing function signatures where possible, with the tests kept green at
every step. Everything else is additive.

---

## 5. Existing competing research, products, and projects

The honest headline: the core idea — use NLP to pull environmental claims out of
corporate disclosures, map them to physical assets, and check them against satellite
evidence — already exists as a funded, named effort, and the surrounding text-only
field is crowded and fast-moving. Here is what is actually out there.

**A near-identical product.** ESA Space Solutions is funding a project called
**GreenClaims**, described as combining Copernicus Earth-observation imagery with
AI-driven NLP to "extract verifiable claims from corporate disclosures, map them to
physical asset locations, and independently assess whether satellite evidence
supports or contradicts the stated outcomes," returning "verification status,
confidence scores, supporting satellite imagery, and detailed reports." That is
GreenTruth's pipeline, almost line for line, aimed at mining, oil and gas,
agriculture, and renewables. There is also a broader ESA "Space supporting
Environmental Claims" funding call, and commentary/practice in legal tech (e.g.
Darrow) using satellite evidence in greenwashing litigation, plus long-archive
ESG-from-Landsat commentary. So the concept is not new; it is an active applied
area. (business.esa.int/projects/greenclaims)

**The text-only claim/promise field is saturated and current.** The Environmental
Claims dataset and detector (Stammbach et al., ACL 2023; `climatebert/environmental_claims`,
`climatebert/environmental-claims`) already do sentence-level claim detection at
~85% F1. CLIMATE-FEVER (Diggelmann et al., 2020) does claim verification against
textual evidence. In 2024–2025 this accelerated: SemEval-2025 Task 6 (PromiseEval)
and the ML-Promise dataset do corporate ESG *promise verification* — identifying a
promise, assessing its supporting evidence, its clarity, and its verification timing;
A3CG pairs aspects with concrete-versus-vague actions; EmeraldMind adds an ESG
knowledge graph and an LLM. So decomposing claims and judging them from text is a
busy, published area — not a place to claim novelty.

**"Multimodal ESG" already exists but means something different.** MMESGBench and
ESGenius are multimodal ESG benchmarks, but their "multimodal" is the modalities
*inside the document* — text, tables, charts, images from the report. They do not
ground claims in physical-world measurements. That distinction is the opening.

## 6. Genuine research gaps

Given all that, the defensible gaps are narrower and more specific than "verify
green claims with satellites," and they are worth stating plainly so you do not
overclaim in the paper or the pitch.

There is no widely-available, **open, reproducible benchmark** that pairs concrete
corporate environmental claims with **open** Earth-observation measurements and
evaluates verification accuracy — the commercial systems are closed, and the open
academic work is text-only. Building even a small, honest, reproducible version of
that benchmark is a real contribution.

Uncertainty in this setting is mostly treated as a "confidence score," not as a
**calibrated** statement. A verification system that produces intervals with a
stated, tested coverage guarantee — conformal prediction on the observed change — is
underexplored here and is squarely your area.

**Evidence sufficiency and conflict** are usually collapsed into "insufficient" or a
single fused score. A system that explains *why* a claim cannot be verified
(temporal non-overlap, resolution too coarse to attribute a signal to one facility,
no channel for the topic) and that detects and reports *disagreement between
independent satellite sources* rather than silently averaging them is scientifically
useful and, as far as the open literature shows, not standard.

Regional coverage is skewed. Most datasets and demos center on North America and
Europe. A credible, real-data focus on **North African oil-and-gas flaring**
(Algeria) is both underrepresented and something you are well placed to do.

Novelty status, stated strictly: the overall concept is **existing** (GreenClaims).
Text-only claim/promise detection is **saturated**. The specific combination of an
open reproducible claims-versus-open-EO benchmark, calibrated (conformal)
uncertainty, and explicit sufficiency/conflict reasoning, with a regional flaring
focus, is **underexplored / potentially novel as an open academic contribution** —
but I would call the pure method **novelty uncertain** and let the experiments,
not the pitch, establish what is actually new.

## 7. Genuine product gaps

The closed commercial systems leave room on a few axes that a student project can
honestly occupy: everything open and reproducible rather than a black box; the
uncertainty made explicit and calibrated rather than a single confidence number;
the honest "we cannot verify this, and here is exactly why" behaviour rather than a
green score; and a specific regional focus the big platforms are not centering. None
of these are "we do what GreenClaims does but better" — they are "we do the open,
scientifically careful, reproducible version," which is the right posture for a
hackathon-into-paper trajectory.

---

## 8. Ten possible upgrades

For each: the idea, what it solves, what already exists, the gap, difficulty, data
situation, demo value, research value, and an honest novelty label.

**8.1 Real flaring evidence (VIIRS Nightfire).** Replace the synthetic CSV with real
per-site flared-gas volumes for real Algerian facilities. Solves the central
credibility problem. Existing: EOG/World Bank use this routinely; it is standard
remote-sensing practice, not novel. Gap: none in the method — the value is that
*this project* becomes real. Difficulty: low-to-moderate (data wrangling, geospatial
matching). Data: verified accessible (section on data pipelines). Demo value: very
high. Research value: enabling (nothing else is real without it). Novelty: not novel,
but non-negotiable.

**8.2 ML claim detector (ClimateBERT / RoBERTa).** Replace the rule baseline with a
fine-tuned transformer. Solves recall and the "is there real ML here" gap. Existing:
`climatebert/environmental-claims` already does this at ~85% F1 on a public dataset.
Gap: small — you are reproducing a known result and adapting it, not inventing a
model. Difficulty: low (dataset and base model are public). Data: the
`environmental_claims` dataset, CC BY-NC-SA. Demo value: moderate. Research value:
moderate (it is a baseline, and a comparison point for the evidence-grounding
experiment). Novelty: not novel as a model; useful as a component and a baseline.

**8.3 Claim decomposition into atomic claims.** Break compound sentences into
separate claims, each with metric, quantity, baseline, target, period, and entity.
Solves the one-claim-per-sentence limit. Existing: PromiseEval/ML-Promise and A3CG
work on exactly this in 2024–2025. Gap: doing it as structured slot-filling feeding a
verification step, rather than as a standalone classification task. Difficulty:
moderate (can be done with rules + a small model, or an LLM used narrowly for
extraction only). Data: partial (ML-Promise for reference). Demo value: high (it
looks intelligent). Research value: moderate. Novelty: moderately explored.

**8.4 Entity and location linking.** Company → facilities → coordinates → the right
observations, from a documented source rather than a hand table. Solves attribution
plumbing. Existing: standard in the commercial systems. Gap: doing it openly with
cited facility registries. Difficulty: moderate (facility geolocation is genuinely
hard for arbitrary firms). Data: partial — VIIRS flare sites themselves are
geolocated; national registries and OpenStreetMap/industry lists help. Demo value:
moderate. Research value: moderate (attribution is a real limitation to study).
Novelty: not novel, but honestly hard.

**8.5 Temporal claim verification (claimed vs observed trajectory).** For "reduced X%
between 2020 and 2024," show the year-by-year observed path against the claimed path,
with an uncertainty band. Solves the "single number" flatness. Existing: trajectory
comparison is common in monitoring; pairing it with a *claim* is less common openly.
Gap: the claimed-vs-observed framing with calibrated bands. Difficulty: moderate.
Data: real (VIIRS annual). Demo value: very high — this is the picture that sells the
idea. Research value: moderate. Novelty: moderately explored, strong as a demo.

**8.6 Calibrated (conformal) uncertainty.** Replace the heuristic confidence with a
conformal interval on the observed change, with tested coverage. Solves the
uncalibrated-confidence weakness. Existing: conformal prediction is well established;
applying it to EO claim verification is not standard. Gap: exactly this application.
Difficulty: moderate, but directly in your wheelhouse (your accepted paper is
conformal uncertainty for satellite time series). Data: real. Demo value: moderate
(one honest sentence in the pitch). Research value: high. Novelty: underexplored in
this setting — one of your two best cards.

**8.7 Evidence sufficiency engine.** Turn "not enough data" into a specific reason.
Solves opaque negatives. Existing: rarely done well. Gap: a small rule/ґdiagnostic
layer that reports temporal overlap, spatial attributability, and channel
availability. Difficulty: low-to-moderate. Data: uses metadata you already have.
Demo value: high (it reads as careful science). Research value: moderate-high.
Novelty: underexplored.

**8.8 Evidence conflict detection (two independent sources).** Check a flaring claim
against both VIIRS (thermal flaring volume) and Sentinel-5P (methane column); if they
disagree, report the conflict and its likely cause rather than averaging. Solves
naive fusion. Existing: multi-sensor agreement is studied in remote sensing; framing
it as claim-level conflict is less common. Gap: the claim-level conflict report.
Difficulty: moderate-to-high (S5P is coarse; handling that honestly is the point).
Data: real (both channels verified). Demo value: high. Research value: high. Novelty:
underexplored as framed — your other best card.

**8.9 Second sector via deforestation (Hansen).** Add a land-use channel so the
system is not only oil and gas. Solves single-sector narrowness. Existing:
deforestation-from-Hansen is completely standard. Gap: none in method. Difficulty:
moderate. Data: real (Hansen on Earth Engine). Demo value: moderate. Research value:
low-moderate. Novelty: not novel; good as breadth, better as a future extension than
MVP.

**8.10 Map and evidence graph UI.** An interactive map of the facility and the
observation, plus a claim→entity→facility→metric→observation→uncertainty→verdict
graph. Solves the "make the physical link obvious" gap. Existing: standard UI work.
Gap: none. Difficulty: low-moderate (Leaflet, inline SVG graph). Data: uses outputs.
Demo value: very high. Research value: low. Novelty: not novel; high polish payoff.

The pattern: 8.1 is mandatory, 8.6 and 8.8 are your genuine research edges, 8.5 and
8.10 are your demo winners, 8.7 is cheap credibility, and 8.2/8.3/8.4 are solid
expected components. 8.9 is a good "future/breadth" item, not MVP.

---

## 9. Three real data pipelines (verified accessible)

Every source below was checked during this research. Details, licenses, and access
notes follow the table.

| Signal | Dataset | Official URL | Access | Resolution | Coverage | Feasibility |
|---|---|---|---|---|---|---|
| Gas flaring (volume) | VIIRS Nightfire — Global Gas Flare Survey 2012–2019 (ORNL DAAC) | daac.ornl.gov/CMS/guides/Methane_Flaring_Sites_VIIRS.html | Free, NASA Earthdata login; direct CSV | Per flare site (point), annual | Global incl. Algeria, 2012–2019 | High — best MVP source |
| Gas flaring (recent) | VIIRS Nightfire (VNF) nightly/annual, EOG | eogdata.mines.edu/products/vnf/ | Free registration; VNF Data Use License since Jan 2025 | Per detection, nightly→annual | Global, 2012–present | Medium — license step |
| Methane (column) | Sentinel-5P OFFL CH4 (TROPOMI) on Earth Engine | developers.google.com/earth-engine/datasets/catalog/COPERNICUS_S5P_OFFL_L3_CH4 | Free GEE account; Python API from Colab | ~7 km, ~daily→monthly | Global (land pre-Nov 2021), 2019–present | Medium — coarse, good for conflict channel |
| Deforestation | Hansen Global Forest Change v1.12 on Earth Engine | developers.google.com/earth-engine/datasets/catalog/UMD_hansen_global_forest_change_2024_v1_12 | Free GEE account; Python API from Colab | 30 m, annual loss year | Global, 2000–2024 | High — for the second-sector extension |

**VIIRS flaring (the flagship channel).** The Earth Observation Group at the Payne
Institute (Colorado School of Mines) produces VIIRS Nightfire, which estimates flared
gas volume in methane-equivalent per flare site from nightly infrared observations,
back to 2012. The cleanest student-accessible slice is the NASA ORNL DAAC dataset
"Global Gas Flare Survey by Infrared Imaging, VIIRS Nightfire, 2012–2019" (Elvidge &
Zhizhin, 2021), distributed as CSV with per-site location, temperature, and estimated
annual flared-gas volume, summarized by country — Algeria included. This is real,
downloadable with a free Earthdata login, and enough to build real observed
trajectories for the Algerian facilities. Newer per-year data (2020+) is available
from EOG but, since January 2025, under a VIIRS Nightfire Data Use License (free
registration), so document it as the extension for recent years. Variables used:
flare latitude/longitude, year, estimated flared volume (billion cubic metres).
Processing: filter to Algeria bounding box, match flare points to facility
coordinates by nearest-neighbour within a small radius, aggregate to an annual per-
facility series. Limitation: attribution — a flare near a facility is consistent
with that operator, not proof of causation. Cite: Elvidge, Zhizhin, Baugh, Hsu,
Ghosh, and the ORNL DAAC landing page. Date accessed: 16 Sep 2026.

**Sentinel-5P methane (the conflict channel).** Google Earth Engine hosts
`COPERNICUS/S5P/OFFL/L3_CH4` (band `CH4_column_volume_mixing_ratio_dry_air`), from
8 Feb 2019, ~2-day revisit, ~7 km. Free with a Google Earth Engine account; the
Python API runs from Colab after `ee.Authenticate()`. Processing: draw a buffer
around a facility, reduce the CH4 column to a monthly mean, build a time series.
Limitations, stated honestly and used as a feature: ~7 km resolution cannot attribute
methane to a single facility, only land is covered before Nov 2021, there is a data
gap 26 Jul–31 Aug 2022, and the provider recommends doubling the reported error for
overall uncertainty. That coarseness is exactly why this is the *second* source in a
conflict check rather than a primary one. Date accessed: 16 Sep 2026.

**Hansen deforestation (the second-sector extension).** Google Earth Engine hosts
`UMD/hansen/global_forest_change_2024_v1_12`, 30 m, with an annual tree-cover
`lossyear` band from 2000–2024. Free via GEE from Colab. Processing: within an area
of interest, count/percentage of pixels with loss per year, build an annual loss
series to compare against a land-use or deforestation-free claim. This is for the
future/breadth track, not the MVP. Date accessed: 16 Sep 2026.

A note on the two data-access styles: VIIRS is a plain file download (simplest,
works offline once cached), while S5P and Hansen come through Earth Engine (a free
account and one authentication step, from Colab). Both are legitimate; the VIIRS file
route is the one to lean on for a live demo because it has no runtime dependency on
an external service.

---

## 10. Proposed final architecture

Keep the three-stage spine; deepen each stage and add an explanation layer.

```
Report text
    |
[1] Claim extraction + decomposition        (ClimateBERT detector -> atomic claims
    |                                         with metric, quantity, baseline,
    |                                         target, period, entity)
    |
[2] Entity + location linking               (company -> facilities -> coordinates,
    |                                         from a documented registry)
    |
[3] Evidence providers (multi-signal)       (VIIRS flaring | S5P methane | Hansen)
    |                                         each returns a real time series + metadata
    |
[4] Temporal + geospatial analysis          (observed trajectory vs claimed trajectory)
    |
[5] Uncertainty (conformal)                 (calibrated interval on the observed change)
    |
[6] Verdict + sufficiency + conflict        (decide; explain why if not; report source
    |                                         disagreement instead of averaging)
    |
Explainable result -> map + trajectory + evidence graph
```

The one real refactor is step 3: `evidence.py` becomes an `EvidenceProvider`
interface with a `series_for(entity, window)` method and metadata (unit, resolution,
attributability), and each signal is a provider. `verdict.py` stops assuming a single
flaring series and instead consumes whatever providers return, which is what makes
sufficiency and conflict natural.

## 11. Hackathon MVP (must-have)

Realistically buildable and, importantly, mostly testable in the sandbox before it
ever touches real data:

1. Multi-provider evidence layer with the flaring provider wired to **real VIIRS**
   data for a handful of real Algerian facilities (cached CSV in the repo, clearly
   sourced), and a second **real Sentinel-5P** methane provider.
2. ClimateBERT claim detector replacing the rule baseline, with the rule detector
   kept as an offline fallback. Light claim decomposition (compound → atomic).
3. Conformal interval replacing the heuristic confidence, with a coverage check.
4. Evidence sufficiency and conflict verdicts (the "why" and the two-source
   agreement/disagreement).
5. Claimed-versus-observed trajectory chart, an interactive map of the facility and
   observation, and the evidence graph. Keep the existing clean visual language.

The claims side of the demo uses **real public commitments** (for example the World
Bank "Zero Routine Flaring by 2030" initiative and publicly stated national/operator
flaring-reduction goals) rather than invented corporate quotes, and every verdict is
worded as consistency with observations, never as an accusation. Real facilities,
real flaring data, real public claims, honest wording.

## 12. Research-paper version (should-have / extension)

Everything in the MVP, plus: a small hand-built evaluation set of real
claim/facility pairs with expert-style labels (supported / contradicted /
insufficient) for a handful of Algerian sites and years; the full ablation (text
only → +geospatial → +satellite → +temporal → +uncertainty); a conformal coverage
study; and the Hansen second-sector channel to show the method generalizes beyond
flaring. This is the reproducible-benchmark contribution from section 6.

## 13. Notebooks to create

Six runnable Colab notebooks, matching your list, each self-contained with a data-
source header, environment cell, and saved outputs:

- `01_claim_detection_training.ipynb` — load `climatebert/environmental_claims`,
  fine-tune `distilroberta-base-climate-f`, evaluate (precision/recall/F1, confusion
  matrix), save the model, push to Hugging Face.
- `02_claim_extraction_evaluation.ipynb` — decomposition + quantity/slot extraction,
  evaluated on held-out sentences; compares rule vs model detection.
- `03_real_satellite_data_pipeline.ipynb` — download the real VIIRS flare survey,
  filter to Algeria, match flares to facilities, build per-facility annual series;
  pull S5P CH4 from Earth Engine for the same sites; save cached CSVs the app uses.
- `04_environmental_verification.ipynb` — run the end-to-end pipeline on real data
  for the demo facilities; produce claimed-vs-observed trajectories and verdicts.
- `05_uncertainty_calibration.ipynb` — conformal intervals on the observed change;
  empirical coverage vs nominal; comparison against the old heuristic.
- `06_ablation_study.ipynb` — the five-condition ablation with the evaluation set,
  measuring each component's contribution.

Every notebook states its data source, license, and access date, and saves its
artifacts so the app and the paper both consume the same real outputs.

## 14. Models to train and Hugging Face strategy

Train one model with a real public dataset: the environmental-claim detector,
fine-tuning `climatebert/distilroberta-base-climate-f` on
`climatebert/environmental_claims` (2,647 expert-annotated sentences, Stammbach et
al., ACL 2023). Expected macro-F1 in the low-to-mid 80s, matching the published
result — we reproduce and adapt, we do not claim to beat it. Push to
`Rahilgh/greentruth-claim-detector` with a full model card (description,
intended use, limitations, dataset and its CC BY-NC-SA licence, training procedure,
metrics, ethical notes, and known failure cases), authenticating via
`huggingface-cli login` or a Colab secret — never a committed token. If you would
rather not publish, the notebook saves the model locally and the app loads it from
disk; both paths are provided.

Claim *typing* (flaring vs methane vs water …) has no public labeled dataset, so it
stays rule-based or weakly-labeled and is described honestly as such, not presented
as a trained classifier. No fabricated labels, no fabricated metrics.

## 15. The five-minute demo

One facility, one strong story — Hassi Messaoud flaring.

- 0:00–0:30 — The problem: companies and countries make flaring-reduction
  commitments; independently checking them is hard.
- 0:30–1:00 — Paste a short report / public commitment; the ML detector extracts and
  decomposes the claims into atomic, structured claims.
- 1:00–1:45 — The system links the claim to the real facility and shows it on the map.
- 1:45–3:00 — Real VIIRS flaring evidence appears: the observed year-by-year
  trajectory against the claimed trajectory, with a calibrated uncertainty band.
- 3:00–3:45 — The second source (Sentinel-5P methane) is checked; the system reports
  whether the two independent satellites agree or conflict, and why.
- 3:45–4:20 — Where a claim cannot be verified, the sufficiency engine explains
  exactly why (coverage, resolution, or no channel).
- 4:20–5:00 — The evidence-grounded verdict, worded as consistency with observations,
  with the uncertainty stated out loud. Close on the open, reproducible, real-data
  posture.

The judge should come away understanding one thing without reading the repo: this
connects what an organization *says* to what independent satellites *show*, and it is
honest about how sure it is.

---

## The wow feature, chosen

Of the options, the strongest combination of originality, difficulty, environmental
relevance, demo value, and feasibility is a single fused feature rather than any one
in isolation: **the calibrated claimed-versus-observed trajectory, verified against
two independent satellite sources that can agree or conflict, with an explicit
sufficiency explanation when they cannot.** It shows a real trajectory on real data
(demo value), it rests on conformal calibration and multi-sensor conflict reasoning
(your genuine research edges), and it degrades honestly instead of pretending. It is
the part of the system the commercial black boxes do not expose and the text-only
academic work cannot do at all.

## What I recommend building first

The right first slice is the part that is both highest-value and fully testable in
the sandbox without any external data: refactor the evidence layer into providers,
add claim decomposition and the sufficiency/conflict verdict logic, and replace the
heuristic confidence with a conformal interval — all runnable and unit-tested here
against clearly-labelled test fixtures. In parallel, the real-data and model work is
delivered as the notebooks above, which you run in Colab to produce the cached real
CSVs and the trained detector; the app then loads those real outputs. That order
keeps a working system at every step and never blocks the build on credentials the
sandbox does not have.

Nothing above has been implemented yet — this is the plan. Tell me which slice to
start on and I will build and test it.
