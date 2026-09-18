"""
The investigation pipeline.

    report text
        -> detect claim sentences        (ClimateBERT, or rules as fallback)
        -> decompose into atomic claims  (decompose.py)
        -> resolve field                 (evidence.py)
        -> retrieve real observations    (evidence.py + provenance.py)
        -> compare / project             (verdict.py, trajectory.py)
        -> assess evidence sufficiency   (sufficiency.py)
        -> build the evidence chain      (provenance.py)

Each stage is a separate module so any one of them can be replaced without
touching the others, and so a reader can check any single step in isolation.

The returned JSON keeps the original `company`, `facilities`, `summary` and
`claims` keys so the existing interface and tests keep working, and adds the
structured fields the new interface needs.
"""

from . import conflict as conflict_mod
from . import corroboration as corroboration_mod
from . import detectors as detectors_mod
from . import measured as measured_mod
from . import metrics as metrics_mod
from . import methane as methane_mod
from . import provenance as provenance_mod
from . import sufficiency as sufficiency_mod
from .decompose import build_claims
from .evidence import Evidence
from .schema import (
    ABSTENTION_VERDICTS,
    CLAIM_FUTURE_COMMITMENT,
    VERDICT_LABELS,
    VERDICT_MEANINGS,
)
from .verdict import assess

FLARING_DATASET = "worldbank_gfmr_flaring"


class GreenTruth:
    def __init__(self, evidence=None, detector_preference=None, methane=None):
        self.evidence = evidence or Evidence()
        # The claim detector is resolved on first use, not here: loading the
        # transformer imports PyTorch and may download the model, which should
        # not happen merely because the application was imported.
        self._detector_preference = detector_preference
        # Second, genuinely independent instrument. Absent -> reported as absent.
        self.methane = methane if methane is not None else methane_mod.MethaneEvidence()
        self.measured = measured_mod.MEASURED

    @property
    def detector(self):
        """The claim detector actually in use (loaded once, then reused)."""
        return detectors_mod.get_detector(self._detector_preference)[0]

    @property
    def detector_info(self):
        """Which detector runs, loading it if needed, so the answer is never a guess."""
        return self.detector.info()

    def detector_status(self):
        """Like detector_info, but never loads: 'pending' until the first use."""
        return (detectors_mod.peek(self._detector_preference)
                or detectors_mod.pending_info())

    # -- interface used by the server ------------------------------------

    def companies(self):
        return self.evidence.companies()

    def fields(self):
        """Every monitored field with its coordinates and observation coverage."""
        out = []
        for fid in self.evidence.fields:
            info = self.evidence.field_info(fid)
            series = self.evidence.series_for(fid)
            years = sorted(series)
            # Which national series (if any) this field would be cross-checked
            # against, so the map can show evidence availability without guessing.
            country_key, country_series = self.evidence.country_totals_for_field(fid)
            info.update(
                n_observations=len(years),
                year_min=years[0] if years else None,
                year_max=years[-1] if years else None,
                latest_value=round(series[years[-1]], 6) if years else None,
                first_value=round(series[years[0]], 6) if years else None,
                unit=self.evidence.unit,
                country_series_key=country_key,
                has_country_series=bool(country_series),
                n_country_years=len(country_series),
            )
            out.append(info)
        return out

    def observations(self, field_id):
        """Real annual series for one field, with full provenance attached."""
        series = self.evidence.series_for(field_id)
        info = self.evidence.field_info(field_id)
        if not info:
            return None
        record = None
        if series:
            record = provenance_mod.build_record(
                FLARING_DATASET, series, field_id=field_id,
                field_name=info["name"],
                coordinates=dict(lat=info["lat"], lon=info["lon"]),
                access_date=self.evidence.data_file_modified)
        return dict(field=info,
                    observations=record.to_dict() if record else None,
                    has_data=bool(series))

    # -- the main entry point ---------------------------------------------

    def analyze(self, text, company=None):
        selected_id = self.evidence.resolve_field(company) if company else None
        detected = self.evidence.detect_fields(text)
        if selected_id is None and detected:
            selected_id = detected[0][0]

        # Candidate fields, for the ambiguity report.
        cand_ids = []
        if company:
            cand_ids = [c[0] for c in self.evidence.field_candidates(company)]
        if not cand_ids:
            cand_ids = [c[0] for c in detected]
        cand_names = [self.evidence.fields[c]["name"] for c in cand_ids
                      if c in self.evidence.fields]

        field_info = self.evidence.field_info(selected_id) if selected_id else None
        series = self.evidence.series_for(selected_id) if selected_id else {}
        country_key, country_series = (
            self.evidence.country_totals_for_field(selected_id)
            if selected_id else (None, {}))

        record = None
        if series and field_info:
            record = provenance_mod.build_record(
                FLARING_DATASET, series, field_id=selected_id,
                field_name=field_info["name"],
                coordinates=dict(lat=field_info["lat"], lon=field_info["lon"]),
                access_date=self.evidence.data_file_modified)

        claims = build_claims(
            text,
            detector=self.detector.name,
            candidate_filter=self.detector.score,
        )

        results = []
        for idx, claim in enumerate(claims, 1):
            claim.location_id = selected_id
            claim.location = field_info["name"] if field_info else None
            claim.location_candidates = cand_names

            metric_series = series if claim.metric_supported else {}
            outcome = assess(claim, metric_series, field_info=field_info)

            # Cross-scale corroboration against the real national series. Only
            # meaningful once a comparison window exists, so it runs off the
            # analysis block rather than guessing years of its own.
            corr = None
            a = outcome.get("analysis")
            if claim.metric_supported and metric_series and a and \
                    a.get("baseline_year") and a.get("comparison_year"):
                corr = corroboration_mod.compare_scales(
                    metric_series, country_series,
                    a["baseline_year"], a["comparison_year"],
                    field_name=field_info["name"] if field_info else None,
                    country_name=country_key,
                    access_date=self.evidence.data_file_modified)

            ch4 = None
            if claim.metric_supported and selected_id and a and                     a.get("baseline_year") and a.get("comparison_year"):
                ch4 = self.methane.cross_check(
                    selected_id, a.get("observed_change"),
                    a["baseline_year"], a["comparison_year"],
                    field_name=field_info["name"] if field_info else None)

            suff = sufficiency_mod.assess(
                claim, field_info, metric_series,
                analysis=outcome.get("analysis"),
                candidates=cand_names,
                corroboration=corr,
                methane=ch4)

            synth = conflict_mod.synthesise(a, corr, ch4)

            chain = provenance_mod.build_chain(
                claim,
                field_info,
                record if claim.metric_supported else None,
                outcome.get("analysis"),
                suff,
                outcome["verdict"],
                corroboration=corr,
                methane=ch4)

            results.append(dict(
                id=f"C{idx:02d}",
                # -- legacy keys, kept so the old interface/tests still work --
                text=claim.raw_text,
                topic=claim.metric,
                verdict=outcome["verdict"],
                rationale=outcome["rationale"],
                observable=metrics_mod.label(claim.metric) if claim.metric else None,
                # -- structured claim ----------------------------------------
                claim=claim.to_dict(),
                verdict_label=VERDICT_LABELS.get(outcome["verdict"],
                                                 outcome["verdict"]),
                verdict_meaning=outcome.get("verdict_meaning", ""),
                is_abstention=outcome["verdict"] in ABSTENTION_VERDICTS,
                analysis=outcome.get("analysis"),
                trajectory=outcome.get("trajectory"),
                sufficiency=suff,
                corroboration=corr,
                methane=ch4,
                synthesis=synth,
                interval_calibration=(
                    self._interval_calibration(a) if a else None),
                evidence_chain=chain,
                evidence=record.to_dict() if (record and claim.metric_supported) else None,
            ))

        return dict(
            # -- legacy keys ------------------------------------------------
            company=field_info["name"] if field_info else None,
            facilities=[field_info] if field_info else [],
            summary=self._summary(results),
            claims=results,
            # -- new keys ---------------------------------------------------
            field=field_info,
            field_candidates=cand_names,
            field_ambiguous=len(cand_names) > 1,
            detector=self.detector_info,
            coverage=self.evidence.coverage(),
            country_context=dict(country=country_key,
                                 has_series=bool(country_series),
                                 years=sorted(country_series)) if selected_id else None,
            unavailable_channels=provenance_mod.unavailable_channels(),
        )

    def _interval_calibration(self, analysis):
        """
        Attach the MEASURED empirical coverage of this interval at this horizon.

        Notebook 05 measured the shipped bootstrap leave-one-field-out across 12
        fields. Marginally it covered 90.7% against a 90% nominal, but coverage
        varies by year-gap, so a verdict quotes the number for ITS OWN gap rather
        than the nominal it was never checked against.
        """
        b, c = analysis.get("baseline_year"), analysis.get("comparison_year")
        if not b or not c:
            return None
        gap = abs(int(c) - int(b))
        s = self.measured.shipped_interval_calibration()
        if not s:
            return None
        at_gap = self.measured.coverage_for_gap(gap)
        return dict(
            year_gap=gap,
            nominal=s["nominal"],
            measured_coverage_at_this_gap=at_gap,
            measured_marginal_coverage=s["marginal_coverage"],
            conditional_range=s["conditional_range"],
            n_fields=s["n_fields"],
            n_observations=s["n_observations"],
            protocol=s["protocol"],
            source="notebooks/05_uncertainty_calibration.ipynb",
            note=("Empirical coverage measured leave-one-field-out. The interval is "
                  "not analytically calibrated; this is how often it actually "
                  "contained the realised change in testing."),
            under_covers_here=(at_gap is not None and at_gap < s["nominal"] - 0.03),
        )

    def research(self):
        """Measured experimental results, for the research page."""
        return self.measured.summary()

    # -- report-level roll-up ---------------------------------------------

    @staticmethod
    def _summary(results):
        """
        Evidence transparency, not a score.

        Deliberately NOT a single "green score": the point of the project is to
        show what the evidence can and cannot support, and a scalar would hide
        exactly the distinction it exists to make.
        """
        counts = {}
        for r in results:
            counts[r["verdict"]] = counts.get(r["verdict"], 0) + 1
        checkable = sum(1 for r in results
                        if r["sufficiency"] and r["sufficiency"]["sufficient"])
        conflicts = sum(1 for r in results
                        if r.get("corroboration") and r["corroboration"].get("is_conflict"))
        ch4_flags = sum(1 for r in results if r.get("methane")
                        and r["methane"].get("relationship") == "flaring_down_methane_up")
        tensions = sum(1 for r in results if r.get("synthesis")
                       and r["synthesis"]["state"] in ("cross_sensor_tension",
                                                       "cross_scale_divergence",
                                                       "multiple_tensions"))
        lv = {}
        for r in results:
            k = (r.get("sufficiency") or {}).get("level")
            if k:
                lv[k] = lv.get(k, 0) + 1
        commitments = sum(1 for r in results
                          if r["claim"]["claim_type"] == CLAIM_FUTURE_COMMITMENT)
        return dict(
            total=len(results),
            by_verdict=counts,
            verdict_labels={v: VERDICT_LABELS.get(v, v) for v in counts},
            with_sufficient_evidence=checkable,
            needing_more_evidence=len(results) - checkable,
            abstentions=sum(1 for r in results if r["is_abstention"]),
            cross_scale_divergences=conflicts,
            methane_divergences=ch4_flags,
            evidence_tensions=tensions,
            by_sufficiency_level=lv,
            fully_sufficient=lv.get("SUFFICIENT", 0),
            partially_sufficient=lv.get("PARTIALLY_SUFFICIENT", 0),
            insufficient=lv.get("INSUFFICIENT", 0),
            future_commitments=commitments,
            # legacy flat counters, still read by the original interface
            supported=counts.get("supported", 0),
            partially_supported=counts.get("partially_supported", 0),
            contradicted=counts.get("contradicted", 0),
            insufficient_evidence=counts.get("insufficient_evidence", 0),
            no_signal=counts.get("no_signal", 0),
        )
