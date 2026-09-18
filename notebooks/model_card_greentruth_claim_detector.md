---
license: cc-by-nc-sa-4.0
language: en
base_model: climatebert/distilroberta-base-climate-f
datasets:
  - climatebert/environmental_claims
tags:
  - text-classification
  - climate
  - esg
  - greenwashing
---

# GreenTruth Claim Detector

A binary text classifier that flags whether a sentence is an **environmental claim**.
It is the text-detection stage of GreenTruth, a project that checks environmental
claims against Earth-observation evidence. (Notebook `01_claim_detection_training.ipynb`
writes an equivalent card next to the model before pushing it; this copy lives in the
repo for reference.)

## Model description

Fine-tuned from `climatebert/distilroberta-base-climate-f` (a DistilRoBERTa model
further pre-trained on climate text) for binary sequence classification:
`environmental_claim` vs `not_claim`.

## Intended use

First stage of an evidence-grounded verification pipeline: find the sentences worth
checking in a corporate sustainability report or disclosure. Detecting a claim is not
the same as judging it — the truth of a claim is decided later, against observations.

## Out of scope

Not a greenwashing detector on its own, and not a judgement about any company. Do not
use it to label an organization as deceptive.

## Training data

`climatebert/environmental_claims` — 2,647 expert-annotated sentences from corporate
annual reports, sustainability reports, and earnings calls (Stammbach et al., ACL
2023). Label 1 = environmental claim, 0 = not. License CC BY-NC-SA 4.0, which this
model inherits (non-commercial).

## Training procedure

3 epochs, learning rate 2e-5, batch size 16, max length 256, weight decay 0.01, best
checkpoint by validation macro-F1.

## Evaluation

Measured by `notebooks/02_claim_detector_evaluation.ipynb` on the held-out test split
(n = 265, positive rate 0.253), threshold 0.5:

| metric | this model | GreenTruth rule-based fallback |
|---|---|---|
| accuracy | 0.9057 | 0.7774 |
| macro F1 | 0.8813 | 0.6217 |
| claim precision | 0.7692 | 0.6429 |
| claim recall | 0.8955 | 0.2687 |
| claim F1 | 0.8276 | 0.3789 |

ROC AUC 0.9691, Brier 0.0734. In-domain: the weights were fine-tuned on this dataset's
training split, so this is the dataset's standard protocol, not evidence of transfer. A
threshold of 0.25 scored macro F1 0.9020 but was selected on the test split and is not
used. (The source paper's ~85% macro-F1 refers to other models and is not a measurement of
this one.)

## Limitations

English only. Trained on listed-company financial/sustainability text, so it will
degrade on other domains. It detects the presence of a claim, not its accuracy, and
it can be fooled by claim-like phrasing that carries no real commitment.

## Ethical considerations

Environmental-claim detection can support accountability but can also be misused to
make unfounded accusations. GreenTruth pairs detection with observed evidence and
explicit uncertainty, and words outcomes as consistency with observations rather than
as accusations. Attribution from a satellite signal to a specific operator is
uncertain and must be communicated as such.

## Citation

Stammbach, Webersinke, Bingler, Kraus, Leippold. *A Dataset for Detecting Real-World
Environmental Claims.* arXiv:2209.00507 (ACL 2023).
