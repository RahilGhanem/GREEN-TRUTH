# Architecture

GreenTruth turns a sentence in a report into an auditable statement about what
Earth-observation data can and cannot support. Every stage is a separate module, so each
can be inspected or replaced on its own. The backend is standard-library Python; the only
optional dependency is the transformer claim detector.

```
report text
   │
   ▼
[1] detect         detectors.py      which sentences are environmental claims
   │                                 ClimateBERT, or rules — the result says which
   ▼
[2] decompose      decompose.py      one sentence → one or more ATOMIC claims (schema.Claim)
   │               schema.py, metrics.py
   ▼
[3] resolve        evidence.py       claim → monitored field → real coordinates
   │                                 all candidates kept; ambiguity surfaced
   ▼
[4] observe        evidence.py       real annual flaring series (World Bank / VIIRS)
   │               provenance.py     + dataset, provider, URL, licence, limitations
   ▼
[5] compare        verdict.py        observed change + 90% residual-bootstrap interval
   │               trajectory.py     or, for a pledge, a projection to the target year
   ▼
[6] cross-check    corroboration.py  field vs national total (same instrument)
   │               methane.py        Sentinel-5P methane anomaly (independent instrument)
   │               conflict.py       side-by-side synthesis — no combined score
   ▼
[7] sufficiency    sufficiency.py    checklist → SUFFICIENT / PARTIALLY / INSUFFICIENT + ceiling
   ▼
[8] chain          provenance.py     every step above, as inspectable nodes
   │
   ▼
result JSON  →  server.py  →  web/
                measured.py        measured evaluation results (read-only) for the interface
```

`pipeline.GreenTruth.analyze()` runs the stages in order and returns one result per atomic
claim.

## The rules that shape the design

**Uncertainty decides; it does not decorate.** The interval selects the verdict. When it
spans materially different outcomes, the system abstains. Abstention is a first-class
result, not an error path.

**No number is labelled more precisely than it has been earned.** There is no `confidence`
field anywhere. The interval is named for what it is (a residual bootstrap), and each
verdict carries the coverage *measured* for its own year gap (notebook 05).

**Absence is reported, never filled.** A missing file, a sparse methane record or an
unresolvable field produces a stated reason — never a substitute value.

## Modules

### `detectors.py` — which sentences are claims

```
ClaimDetector
├── ClimateBERTDetector   Rahilgh/greentruth-claim-detector (Hugging Face Hub), threshold 0.5
└── RuleBasedDetector     metric vocabulary + a number or an achievement/commitment verb
```

`get_detector("auto")` tries the transformer and falls back to the rules, recording which
ran and why (`{"detector": "rule_based", "fallback": true, "reason": …}`). The interface
shows that notice; nothing claims an inference that did not happen.

### `decompose.py` — atomic claims

Splits a sentence on clause boundaries and classifies each clause by **tense first**, because
"by 2030" is a *pledge year* in a future clause and an *outcome year* in a past one. Guards
against over-splitting: `between 2019 and 2024` is masked, verb-less fragments are re-joined
(noun lists stay intact), and a leading time phrase attaches to the clause it qualifies.
Output is a `schema.Claim` with `extracted_slots` / `missing_slots` and a slot-coverage
ratio — explicitly not a probability.

### `evidence.py` — resolution and retrieval

Loads `data/facilities_international.json` (12 fields) and the real series from
`data/real/`. Resolution returns every candidate, so a country with several monitored fields
is reported as ambiguous. With the CSV absent, `has_real_data` is false and the verdict
stage says so.

### `verdict.py` — historical claims

The change axis has four decision regions: meets or beats the claim · fell by less · flat
(±`flat_band` = 5%) · rose.

| interval spans | outcome |
|---|---|
| one region | that verdict |
| two neighbouring regions | point-estimate verdict, flagged `borderline` |
| three or more | **abstain** |

Also reported: `interval_kind`, `interval_note`, `flat_band`, the region indices, and
`decision_margin` (distance from the nearest boundary in half-widths, labelled heuristic).

### `trajectory.py` — pledges

OLS on the annual series, extrapolated to the target year, with a residual-bootstrap band
(each resample is one coherent line). Outcomes: `trajectory_consistent` /
`trajectory_uncertain` / `trajectory_inconsistent`. Every point is tagged `observed`,
`projected`, `required` or `target`, and the interface draws each differently. The band is
clamped at zero for display only; the decision uses unclamped values.

### `corroboration.py` — cross-scale (same instrument)

Compares the field's change with its country's total over the same window:
`corroborates` / `same_direction` / `diverges`. Always labelled *not independent*.

### `methane.py` — independent instrument

Sentinel-5P monthly columns → annual means (years with ≥ 6 months) → **anomaly relative to
the background** (mean of the other fields), because the raw column rises with global
methane everywhere. Refused for fields below 60% retrieval completeness. Reports a pattern
(`flaring_down_methane_up`, `both_down`, …), never a cause.

### `conflict.py` — synthesis

Lists each source with its instrument, resolution and signal, and names two kinds of
disagreement: *cross-scale divergence* and *cross-sensor tension*. It never combines sources
into one number.

### `sufficiency.py` — can the evidence support a conclusion?

Ten checks (`pass` / `warn` / `fail`): metric, channel, field, observations, temporal
overlap, sample size, attribution, uncertainty, cross-scale corroboration, independent
instrument. Any fail → INSUFFICIENT; a structural limit (attribution, no independent
instrument, ambiguity, source disagreement) → PARTIALLY SUFFICIENT at best. Also returns the
**evidence ceiling** and an *observable vs attributable* split.

### `provenance.py` — where every number came from

Dataset registry, `build_record()` for observation series, `build_chain()` for the 13-node
evidence chain, and `unavailable_channels()` — computed from what is on disk.

### `measured.py` — measured results

Read-only access to `evaluation/*.json`. Supplies the per-gap coverage attached to each
verdict and the research page. A missing file yields `None` ("not measured"), never a
substitute.

## Web layer

`server.py` (standard library): static files from `web/` plus a JSON API — see
[API.md](API.md).

On Vercel, `web/` is served as static files and `api/index.py` handles `/api/*`. It is a
subclass of `server.Handler` that only restores the original path from the `vercel.json`
rewrite and leaves static files to the CDN, so both environments run the same routes and
the same engine (README → Deployment).

`web/` is plain HTML/CSS/JS with no build step and no runtime CDN. Fonts are vendored
(`web/fonts/`: Roboto, notika-icon). Charts and the map are hand-drawn SVG at their real
pixel width.

| file | role |
|---|---|
| `index.html` | landing page, top bar, menu, the five views (Guided demo, Workspace, Field map, Research, Method & data) |
| `style.css` | design system (Notika design language: Roboto, flat panels, `#00c292` accent), responsive at 1199 / 991 / 700 / 600 px |
| `app.js` | boot, hash routing (`#demo`, `#workspace`, `#map`, `#research`, `#about`; old `#claims` / `#method` / `#sources` links redirect), workspace input, analysis |
| `js/util.js` | shared state, formatting, verdict tones, state cards, technical-detail toggles, chart mounting |
| `js/charts.js` | uncertainty strip with decision regions, observed series, trajectory (fitted trend extended with its band), research charts |
| `js/components.js` | the evidence story: verdict banner, the five question steps (or the trajectory step for a pledge), cross-source cards, can / cannot conclude, evidence audit, collapsible 13-step trace |
| `js/views.js` | workspace results (report summary, one tab per claim), guided demo (case cards, stepper, claim split, *Next*) |
| `js/pages.js` | Research (three experiments: source, what it shows, what it does not) and Method & data |
| `js/map.js` | field map, field evidence panel, field table |

Scripts are classic (non-module) and load in that order: `util`, `charts`, `components`,
`views`, `pages`, `map`, `app`. Charts are drawn at their container's real width and redrawn
on resize (`ResizeObserver`), so there is no scaled SVG text on phones.

## Backward compatibility

`analyze()` still returns the original `company`, `facilities`, `summary` and `claims`
keys, and each claim keeps `text`, `topic`, `verdict` and `rationale`. Newer structured
fields are additive.
