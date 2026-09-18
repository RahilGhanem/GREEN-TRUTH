"""
Unit tests for the GreenTruth pipeline.

There is no synthetic data FILE in the project. Where a test needs a controlled
series it injects a small one at runtime and labels it:

    SYNTHETIC - NOT REAL ENVIRONMENTAL EVIDENCE

Those numbers exist to drive a decision path deterministically (so that, for
example, the abstention branch can be triggered on demand). They are never
written to disk, never returned by the application, and never presented as
observations.

Run from the project root:  python3 -m unittest discover -s tests
"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from greentruth import GreenTruth                                   # noqa: E402
from greentruth import (conflict, corroboration, detectors,  # noqa: E402
                        measured,
                        methane, metrics,
                        provenance, sufficiency)
from greentruth.decompose import build_claims, split_clauses        # noqa: E402
from greentruth.evidence import Evidence                            # noqa: E402
from greentruth.schema import (                                     # noqa: E402
    ABSTAIN, CLAIM_FUTURE_COMMITMENT, CLAIM_HISTORICAL_REDUCTION,
    CONTRADICTED, INSUFFICIENT_EVIDENCE, NO_SIGNAL, PARTIALLY_SUPPORTED,
    SUPPORTED, TRAJECTORY_CONSISTENT, TRAJECTORY_INCONSISTENT,
)
from greentruth.trajectory import analyse as analyse_trajectory     # noqa: E402

DEMO = ("We reduced routine gas flaring by 40% from 2019 levels "
        "and will eliminate routine flaring by 2030.")

# SYNTHETIC - NOT REAL ENVIRONMENTAL EVIDENCE. Smooth, so the bootstrap
# interval is tight and the decision path is deterministic.
SMOOTH_BIG_CUT = {2016: 110, 2017: 108, 2018: 104, 2019: 100,
                  2020: 90, 2021: 80, 2022: 70, 2023: 60, 2024: 55}
SMOOTH_SMALL_CUT = {2016: 108, 2017: 106, 2018: 103, 2019: 100,
                    2020: 97, 2021: 94, 2022: 91, 2023: 88, 2024: 85}
SMOOTH_RISE = {2016: 95, 2017: 98, 2018: 99, 2019: 100,
               2020: 102, 2021: 104, 2022: 106, 2023: 108, 2024: 110}
# Deliberately noisy: a wide interval, so the engine must abstain.
NOISY = {2016: 100, 2017: 20, 2018: 160, 2019: 100, 2020: 15,
         2021: 175, 2022: 30, 2023: 140, 2024: 40}
# Steep, clean decline that genuinely reaches zero before the target year.
TO_ZERO = {2016: 80, 2017: 70, 2018: 60, 2019: 50, 2020: 40,
           2021: 30, 2022: 20, 2023: 10, 2024: 4}


def claim_by_type(result, claim_type):
    for c in result["claims"]:
        if c["claim"]["claim_type"] == claim_type:
            return c
    return None


def engine_with(field_id=None, series=None):
    gt = GreenTruth(detector_preference="rule_based")
    if field_id and series is not None:
        gt.evidence.series[field_id] = dict(series)
    return gt


# ---------------------------------------------------------------- decomposition

class Decomposition(unittest.TestCase):
    def test_compound_sentence_splits_into_two_atomic_claims(self):
        claims = build_claims(DEMO)
        self.assertEqual(len(claims), 2, [c.raw_text for c in claims])
        self.assertEqual(claims[0].claim_type, CLAIM_HISTORICAL_REDUCTION)
        self.assertEqual(claims[1].claim_type, CLAIM_FUTURE_COMMITMENT)

    def test_pledge_year_does_not_become_the_historical_outcome_year(self):
        """The original bug: '2030' was read as the historical comparison year."""
        hist = build_claims(DEMO)[0]
        self.assertEqual(hist.baseline_year, 2019)
        self.assertIsNone(hist.comparison_year)
        self.assertEqual(hist.claimed_change_percent, -40.0)

    def test_commitment_carries_target_year_and_zero_target(self):
        fut = build_claims(DEMO)[1]
        self.assertEqual(fut.commitment_year, 2030)
        self.assertEqual(fut.target_value, 0.0)
        self.assertTrue(fut.target_commitment)

    def test_three_metrics_in_one_sentence(self):
        claims = build_claims(
            "We reduced flaring by 40%, cut methane emissions by 30%, "
            "and will reach net-zero by 2030.")
        self.assertEqual([c.metric for c in claims],
                         [metrics.GAS_FLARING, metrics.METHANE, metrics.GHG])

    def test_leading_time_phrase_is_kept_with_its_clause(self):
        c = build_claims("In 2023, we cut flaring by 20% from 2019 levels.")[0]
        self.assertEqual((c.baseline_year, c.comparison_year), (2019, 2023))

    def test_between_years_survives_clause_splitting(self):
        c = build_claims("Flaring decreased by 40% between 2019 and 2024.")[0]
        self.assertEqual((c.baseline_year, c.comparison_year), (2019, 2024))

    def test_noun_list_is_not_split_into_claims(self):
        clauses = split_clauses(
            "Our operations span Rumaila, Basra and West Qurna, "
            "and we cut flaring by 20% in 2023.")
        self.assertEqual(len(clauses), 2, clauses)

    def test_rhetorical_framing_is_not_a_claim(self):
        self.assertEqual(build_claims("Reducing flaring is central to our roadmap."), [])

    def test_slot_coverage_is_reported_as_a_ratio_not_a_probability(self):
        c = build_claims(DEMO)[0]
        self.assertEqual(c.extract_confidence_kind, "slot_coverage_ratio")
        self.assertIn("comparison_year", c.missing_slots)


# ------------------------------------------------------------------- verdicts

class HistoricalVerdicts(unittest.TestCase):
    def test_supported_when_observed_cut_meets_the_claim(self):
        gt = engine_with("algeria_hassi_messaoud", SMOOTH_BIG_CUT)
        res = gt.analyze("We reduced flaring by 30% by 2024 from 2019 levels.",
                         "Hassi Messaoud")
        self.assertEqual(res["claims"][0]["verdict"], SUPPORTED)

    def test_partially_supported_when_cut_is_real_but_smaller(self):
        gt = engine_with("iraq_rumaila", SMOOTH_SMALL_CUT)
        res = gt.analyze(
            "We reduced flaring by 40% by 2024 from a 2019 baseline.",
            "Rumaila / Basra")
        self.assertEqual(res["claims"][0]["verdict"], PARTIALLY_SUPPORTED)

    def test_contradicted_when_flaring_rose(self):
        gt = engine_with("algeria_hassi_rmel", SMOOTH_RISE)
        res = gt.analyze("We cut routine flaring by 50% by 2024 from 2019 levels.",
                         "Hassi R'Mel")
        self.assertEqual(res["claims"][0]["verdict"], CONTRADICTED)


class UncertaintyDrivesTheDecision(unittest.TestCase):
    """The defect this upgrade exists to fix."""

    def test_wide_interval_abstains_instead_of_trusting_the_point_estimate(self):
        gt = engine_with("us_bakken", NOISY)
        res = gt.analyze("We reduced flaring by 40% by 2024 from 2019 levels.",
                         "Bakken")
        c = res["claims"][0]
        self.assertEqual(c["verdict"], ABSTAIN)
        self.assertTrue(c["analysis"]["interval_spans_decision_regions"])
        self.assertGreaterEqual(c["analysis"]["region_span"], 2)

    def test_abstention_is_reported_as_a_first_class_outcome(self):
        gt = engine_with("us_bakken", NOISY)
        res = gt.analyze("We reduced flaring by 40% by 2024 from 2019 levels.",
                         "Bakken")
        self.assertTrue(res["claims"][0]["is_abstention"])
        self.assertEqual(res["summary"]["abstentions"], 1)

    def test_no_calibrated_confidence_is_claimed(self):
        gt = engine_with("algeria_hassi_messaoud", SMOOTH_BIG_CUT)
        res = gt.analyze("We reduced flaring by 30% by 2024 from 2019 levels.",
                         "Hassi Messaoud")
        a = res["claims"][0]["analysis"]
        self.assertNotIn("confidence", a)
        self.assertIn("heuristic", a["decision_margin_kind"])
        self.assertIn("not a calibrated", a["interval_note"])


class FutureCommitments(unittest.TestCase):
    def test_flat_series_is_not_on_trajectory_to_zero(self):
        gt = engine_with("us_permian", SMOOTH_RISE)
        res = gt.analyze("We will eliminate routine flaring by 2030.", "Permian Basin")
        c = claim_by_type(res, CLAIM_FUTURE_COMMITMENT)
        self.assertEqual(c["verdict"], TRAJECTORY_INCONSISTENT)

    def test_steep_decline_is_consistent_with_a_zero_target(self):
        t = analyse_trajectory(TO_ZERO, target_year=2030, target_value=0.0)
        self.assertTrue(t["feasible"])
        self.assertEqual(t["verdict"], TRAJECTORY_CONSISTENT)

    def test_commitment_is_never_reported_as_already_achieved(self):
        gt = engine_with("us_permian", TO_ZERO)
        res = gt.analyze("We will eliminate routine flaring by 2030.", "Permian Basin")
        c = claim_by_type(res, CLAIM_FUTURE_COMMITMENT)
        self.assertNotIn(c["verdict"], (SUPPORTED, CONTRADICTED))
        self.assertIn("cannot be true or false yet", c["rationale"])

    def test_projection_is_labelled_projected_not_observed(self):
        t = analyse_trajectory(TO_ZERO, target_year=2030, target_value=0.0)
        self.assertTrue(all(p["provenance"] == "projected" for p in t["projected"]))
        self.assertTrue(all(p["provenance"] == "observed" for p in t["observed"]))
        self.assertEqual(t["target"]["provenance"], "target")

    def test_target_year_in_the_past_is_refused(self):
        t = analyse_trajectory(TO_ZERO, target_year=2020, target_value=0.0)
        self.assertFalse(t["feasible"])


# ----------------------------------------------------------------- no channel

class UnsupportedMetrics(unittest.TestCase):
    def test_net_zero_claim_returns_no_signal(self):
        gt = engine_with()
        res = gt.analyze("We are committed to reaching net zero by 2050.",
                         "Permian Basin")
        verdicts = {c["claim"]["metric"]: c["verdict"] for c in res["claims"]}
        self.assertEqual(verdicts.get(metrics.GHG), NO_SIGNAL)

    def test_water_claim_returns_no_signal_with_a_reason(self):
        gt = engine_with()
        res = gt.analyze("We cut freshwater withdrawal by 25% in 2023.",
                         "Permian Basin")
        c = res["claims"][0]
        self.assertEqual(c["verdict"], NO_SIGNAL)
        self.assertIn("no observation channel", c["rationale"].lower())

    def test_methane_is_experimental_not_evidence(self):
        self.assertIn(metrics.METHANE, metrics.EXPERIMENTAL_METRICS)
        self.assertNotIn(metrics.METHANE, metrics.SUPPORTED_METRICS)
        self.assertIn("experimental", metrics.unsupported_reason(metrics.METHANE))


# --------------------------------------------------------------- missing data

class NoDataBehaviour(unittest.TestCase):
    """
    The previously stale test, fixed.

    It used to assume the repository contained no real CSVs, which stopped being
    true once notebook 03 was run. It now builds an Evidence pointed at a path
    that does not exist, so it tests the no-data code path regardless of what is
    on disk.
    """

    def test_flaring_claim_without_real_data_asks_for_notebook(self):
        empty = Evidence(flaring_csv="/__nonexistent__/flaring_by_field.csv",
                         country_csv="/__nonexistent__/flaring_by_country.csv")
        self.assertFalse(empty.has_real_data)
        gt = GreenTruth(evidence=empty, detector_preference="rule_based")
        res = gt.analyze("We reduced flaring by 30% by 2023 from 2019 levels.",
                         "Hassi Messaoud")
        c = res["claims"][0]
        self.assertEqual(c["verdict"], INSUFFICIENT_EVIDENCE)
        self.assertIn("notebook", c["rationale"].lower())

    def test_real_data_is_actually_present_in_this_checkout(self):
        """Guards the opposite mistake: silently shipping without the real data."""
        cov = Evidence().coverage()
        self.assertTrue(cov["has_real_data"])
        self.assertEqual(cov["n_fields"], 12)
        self.assertEqual(cov["year_min"], 2012)


# ------------------------------------------------------------------ ambiguity

class FacilityResolution(unittest.TestCase):
    def test_country_with_several_fields_is_ambiguous(self):
        ev = Evidence()
        cands = ev.field_candidates("United States")
        self.assertGreater(len(cands), 1)
        self.assertTrue(all(c[2] == "country" for c in cands))

    def test_ambiguity_is_surfaced_not_silently_resolved(self):
        gt = engine_with()
        res = gt.analyze("We reduced flaring by 30% by 2024 from 2019 levels.",
                         "United States")
        self.assertTrue(res["field_ambiguous"])
        self.assertGreater(len(res["field_candidates"]), 1)
        check = next(c for c in res["claims"][0]["sufficiency"]["checks"]
                     if c["key"] == "facility")
        self.assertEqual(check["status"], sufficiency.WARN)

    def test_exact_field_name_is_unambiguous(self):
        ev = Evidence()
        self.assertEqual(len(ev.field_candidates("Bakken")), 1)
        self.assertEqual(ev.resolve_field("Bakken"), "us_bakken")


# ---------------------------------------------------------------- sufficiency

class EvidenceSufficiency(unittest.TestCase):
    def test_wide_uncertainty_makes_evidence_insufficient(self):
        gt = engine_with("us_bakken", NOISY)
        res = gt.analyze("We reduced flaring by 40% by 2024 from 2019 levels.",
                         "Bakken")
        s = res["claims"][0]["sufficiency"]
        self.assertFalse(s["sufficient"])
        self.assertIn(sufficiency.UNCERTAINTY_TOO_LARGE, s["blocking_reasons"])

    def test_attribution_limit_is_always_reported_for_flaring(self):
        gt = engine_with("algeria_hassi_messaoud", SMOOTH_BIG_CUT)
        res = gt.analyze("We reduced flaring by 30% by 2024 from 2019 levels.",
                         "Hassi Messaoud")
        s = res["claims"][0]["sufficiency"]
        self.assertIn(sufficiency.ATTRIBUTION_LIMIT, s["reasons"])
        check = next(c for c in s["checks"] if c["key"] == "attribution")
        self.assertEqual(check["status"], sufficiency.WARN)

    def test_cross_scale_check_runs_but_is_not_called_independent(self):
        """
        The national series is a real second view, so the corroboration check now
        reports a measurement rather than a blanket "no corroboration". It must
        still record that the two series are not independent instruments.
        """
        gt = engine_with("algeria_hassi_messaoud", SMOOTH_BIG_CUT)
        res = gt.analyze("We reduced flaring by 30% by 2024 from 2019 levels.",
                         "Hassi Messaoud")
        s = res["claims"][0]["sufficiency"]
        check = next(c for c in s["checks"] if c["key"] == "corroboration")
        self.assertEqual(check["status"], sufficiency.WARN)
        self.assertIn("not independent instruments", check["detail"])
        self.assertIn("same instrument", check["label"])

    def test_independent_instrument_is_a_separate_dimension(self):
        """
        Cross-scale corroboration and an independent instrument are different
        claims about the evidence and must be reported as separate checks.
        """
        gt = engine_with("algeria_hassi_messaoud", SMOOTH_BIG_CUT)
        res = gt.analyze("We reduced flaring by 30% by 2024 from 2019 levels.",
                         "Hassi Messaoud")
        s = res["claims"][0]["sufficiency"]
        keys = [c["key"] for c in s["checks"]]
        self.assertIn("corroboration", keys)
        self.assertIn("independent_instrument", keys)
        # Hassi Messaoud has 99% TROPOMI coverage, so the instrument IS available.
        self.assertIn(sufficiency.HAS_INDEPENDENT_INSTRUMENT, s["reasons"])
        self.assertNotIn(sufficiency.NO_INDEPENDENT_INSTRUMENT, s["reasons"])

    def test_field_without_methane_coverage_reports_no_instrument(self):
        """Lake Maracaibo is water; TROPOMI cannot see it."""
        gt = engine_with("venezuela_maracaibo", SMOOTH_BIG_CUT)
        res = gt.analyze("We reduced flaring by 30% by 2024 from 2019 levels.",
                         "Lake Maracaibo")
        s = res["claims"][0]["sufficiency"]
        self.assertIn(sufficiency.NO_INDEPENDENT_INSTRUMENT, s["reasons"])

    def test_no_second_series_falls_back_to_no_corroboration(self):
        empty = Evidence(country_csv="/__nonexistent__/country.csv")
        gt = GreenTruth(evidence=empty, detector_preference="rule_based")
        gt.evidence.series["algeria_hassi_messaoud"] = dict(SMOOTH_BIG_CUT)
        res = gt.analyze("We reduced flaring by 30% by 2024 from 2019 levels.",
                         "Hassi Messaoud")
        self.assertIn(sufficiency.NO_CORROBORATION,
                      res["claims"][0]["sufficiency"]["reasons"])

    def test_every_check_carries_a_status_and_an_explanation(self):
        gt = engine_with("algeria_hassi_messaoud", SMOOTH_BIG_CUT)
        res = gt.analyze("We reduced flaring by 30% by 2024 from 2019 levels.",
                         "Hassi Messaoud")
        for c in res["claims"][0]["sufficiency"]["checks"]:
            self.assertIn(c["status"], (sufficiency.PASS, sufficiency.WARN,
                                        sufficiency.FAIL))
            self.assertTrue(c["detail"].strip())


# ----------------------------------------------------------------- provenance

class Provenance(unittest.TestCase):
    def test_observation_record_carries_full_source_metadata(self):
        gt = engine_with()
        obs = gt.observations("us_bakken")
        rec = obs["observations"]
        self.assertEqual(rec["value_provenance"], "observed")
        self.assertTrue(rec["official_url"].startswith("https://www.worldbank.org/"))
        self.assertIn("VIIRS", rec["measurement_type"])
        self.assertTrue(rec["licence"])
        self.assertTrue(rec["limitations"])

    def test_unknown_dataset_raises_rather_than_returning_a_blank(self):
        with self.assertRaises(KeyError):
            provenance.dataset_meta("not_a_real_dataset")

    def test_evidence_chain_runs_report_to_verdict(self):
        gt = engine_with("algeria_hassi_messaoud", SMOOTH_BIG_CUT)
        res = gt.analyze("We reduced flaring by 30% by 2024 from 2019 levels.",
                         "Hassi Messaoud")
        steps = [n["step"] for n in res["claims"][0]["evidence_chain"]]
        self.assertEqual(steps[0], "report")
        self.assertEqual(steps[-1], "verdict")
        for expected in ("claim", "metric", "facility", "dataset",
                         "observations", "sufficiency"):
            self.assertIn(expected, steps)

    def test_unavailable_channel_is_declared_not_hidden(self):
        """
        An absence must be stated. Which absence depends on what is on disk:
        with methane loaded the gap is partial retrieval coverage; without it,
        the whole channel. Either way something is declared, with a reason.
        """
        gt = engine_with()
        res = gt.analyze(DEMO, "Bakken")
        chans = res["unavailable_channels"]
        self.assertTrue(chans, "no unavailable channel declared at all")
        self.assertTrue(any(k.startswith("sentinel5p_methane") for k in chans),
                        f"methane state not declared: {list(chans)}")
        for v in chans.values():
            self.assertTrue(v.get("why_unavailable"))
            self.assertTrue(v.get("official_url"))

    def test_channels_with_no_pipeline_are_named(self):
        """Deforestation has no pipeline; saying so is better than omitting it."""
        gt = engine_with()
        res = gt.analyze(DEMO, "Bakken")
        self.assertIn("deforestation", res["unavailable_channels"])


# -------------------------------------------------------------- corroboration

class CrossScaleCorroboration(unittest.TestCase):
    """
    The second real source: national totals from the same World Bank programme.

    These tests use the REAL data in data/real/, because the point is that the
    cross-check works on the actual series, not on a fixture.
    """

    def setUp(self):
        self.ev = Evidence()

    def test_country_series_resolves_for_every_monitored_field(self):
        unresolved = []
        for fid in self.ev.fields:
            key, series = self.ev.country_totals_for_field(fid)
            if not series:
                unresolved.append((fid, self.ev.fields[fid]["country"]))
        self.assertEqual(unresolved, [], f"no national series for {unresolved}")

    def test_spelling_aliases_map_to_the_country_sheet(self):
        for name, expected in (("Russia", "Russian Federation"),
                               ("Iran", "Iran, Islamic Rep."),
                               ("Venezuela", "Venezuela, RB")):
            self.assertEqual(
                corroboration.resolve_country_key(name, self.ev.country_series),
                expected)

    def test_same_direction_similar_magnitude_corroborates(self):
        r = corroboration.compare_scales({2019: 100, 2024: 60}, {2019: 100, 2024: 55},
                                         2019, 2024)
        self.assertTrue(r["available"])
        self.assertEqual(r["relationship"], corroboration.CORROBORATES)
        self.assertFalse(r["is_conflict"])

    def test_opposite_directions_is_flagged_as_divergence(self):
        r = corroboration.compare_scales({2019: 100, 2024: 60}, {2019: 100, 2024: 140},
                                         2019, 2024)
        self.assertEqual(r["relationship"], corroboration.DIVERGES)
        self.assertTrue(r["is_conflict"])

    def test_divergence_is_explained_not_treated_as_an_error(self):
        """A field falling while its country rises is a scale effect, not a fault."""
        r = corroboration.compare_scales({2019: 100, 2024: 60}, {2019: 100, 2024: 140},
                                         2019, 2024, "Testfield", "Testland")
        self.assertIn("NOT a contradiction", r["detail"])
        self.assertIn("not independent instruments", r["caveat"])

    def test_missing_years_are_reported_not_guessed(self):
        r = corroboration.compare_scales({2019: 100, 2024: 60}, {2019: 100}, 2019, 2024)
        self.assertFalse(r["available"])
        self.assertEqual(r["relationship"], corroboration.NOT_COMPARABLE)

    def test_no_second_series_is_uncontested_not_agreement(self):
        r = corroboration.compare_scales({2019: 100, 2024: 60}, {}, 2019, 2024)
        self.assertFalse(r["available"])
        self.assertEqual(r["relationship"], corroboration.UNCONTESTED)

    def test_corroboration_reaches_the_analysis_result(self):
        gt = engine_with()
        res = gt.analyze("We reduced flaring by 30% by 2024 from 2019 levels.", "Bakken")
        c = res["claims"][0]
        self.assertIsNotNone(c["corroboration"])
        self.assertTrue(c["corroboration"]["available"])
        self.assertIn("corroboration", [n["step"] for n in c["evidence_chain"]])

    def test_second_source_carries_its_own_provenance(self):
        gt = engine_with()
        res = gt.analyze("We reduced flaring by 30% by 2024 from 2019 levels.", "Bakken")
        src = res["claims"][0]["corroboration"]["second_source"]
        self.assertTrue(src["official_url"].startswith("https://www.worldbank.org/"))
        self.assertTrue(src["licence"])

    def test_report_summary_counts_divergences(self):
        gt = engine_with()
        res = gt.analyze("We reduced flaring by 30% by 2024 from 2019 levels.", "Bakken")
        self.assertIn("cross_scale_divergences", res["summary"])

    def test_unsupported_metric_gets_no_corroboration_block(self):
        gt = engine_with()
        res = gt.analyze("We cut freshwater withdrawal by 25% in 2023.", "Bakken")
        self.assertIsNone(res["claims"][0]["corroboration"])


# ------------------------------------------------- independent instrument (CH4)

class MethaneChannel(unittest.TestCase):
    """
    Sentinel-5P is the one genuinely independent instrument. These tests use the
    REAL series in data/real/methane_by_field_s5p.csv.
    """

    def setUp(self):
        self.m = methane.MethaneEvidence()
        if not self.m.available:
            self.skipTest("methane_by_field_s5p.csv not present in this checkout")

    def test_real_methane_series_loads(self):
        self.assertTrue(self.m.available)
        self.assertIn("REAL", (self.m.source_label or ""))

    def test_poor_retrieval_coverage_blocks_the_channel(self):
        """Lake Maracaibo is water: TROPOMI CH4 retrievals largely fail there."""
        self.assertLess(self.m.completeness("venezuela_maracaibo"),
                        methane.MIN_COMPLETENESS)
        self.assertFalse(self.m.usable("venezuela_maracaibo"))
        r = self.m.cross_check("venezuela_maracaibo", -0.4, 2019, 2024)
        self.assertFalse(r["available"])
        self.assertEqual(r["relationship"], methane.UNAVAILABLE)

    def test_well_covered_field_is_usable(self):
        self.assertTrue(self.m.usable("us_permian"))
        self.assertGreaterEqual(self.m.completeness("us_permian"), 0.9)

    def test_background_reference_tracks_the_global_rise(self):
        """
        Atmospheric methane rose globally over 2019-2024. The background proxy
        must capture that, otherwise every field would look like it was venting.
        """
        bg = self.m.background_annual()
        self.assertIn(2019, bg)
        self.assertIn(2024, bg)
        rise = bg[2024] - bg[2019]
        self.assertGreater(rise, 20, "background proxy should show the global rise")
        self.assertLess(rise, 80)

    def test_raw_rise_is_not_reported_as_a_field_signal(self):
        """
        The bug this guards: every field's RAW column rises ~+45 ppb, which would
        read as 'flaring down, methane up' everywhere. The anomaly must be far
        smaller than the raw change.
        """
        r = self.m.cross_check("us_bakken", -0.63, 2019, 2024, "Bakken")
        self.assertTrue(r["available"])
        self.assertGreater(r["methane_change_ppb_raw"], 20)
        self.assertLess(abs(r["anomaly_change_ppb"]),
                        abs(r["methane_change_ppb_raw"]))
        self.assertTrue(r["uses_background_reference"])

    def test_venting_signature_is_flagged(self):
        """Permian: flaring fell, methane anomaly rose. That pattern is the point."""
        r = self.m.cross_check("us_permian", -0.29, 2019, 2024, "Permian Basin")
        self.assertTrue(r["available"])
        self.assertEqual(r["relationship"], methane.FLARING_DOWN_METHANE_UP)
        self.assertIn("vented", r["detail"])

    def test_channel_never_asserts_attribution(self):
        r = self.m.cross_check("us_permian", -0.29, 2019, 2024, "Permian Basin")
        self.assertIn("does not establish", r["attribution_warning"])
        self.assertTrue(r["independent_instrument"])

    def test_missing_file_reports_unavailable_not_zero(self):
        empty = methane.MethaneEvidence(path="/__nonexistent__/ch4.csv")
        self.assertFalse(empty.available)
        r = empty.cross_check("us_permian", -0.3, 2019, 2024)
        self.assertFalse(r["available"])
        self.assertIn("notebooks/03", r["detail"])

    def test_methane_reaches_the_analysis_result(self):
        gt = engine_with()
        res = gt.analyze("We reduced flaring by 25% by 2024 from 2019 levels.",
                         "Permian Basin")
        c = res["claims"][0]
        self.assertIsNotNone(c["methane"])
        self.assertTrue(c["methane"]["available"])
        keys = [k["key"] for k in c["sufficiency"]["checks"]]
        self.assertIn("independent_instrument", keys)

    def test_unsupported_metric_gets_no_methane_block(self):
        gt = engine_with()
        res = gt.analyze("We cut freshwater withdrawal by 25% in 2023.", "Bakken")
        self.assertIsNone(res["claims"][0]["methane"])


# -------------------------------------------------- measured experiment results

class MeasuredResults(unittest.TestCase):
    """Every displayed metric must come from a notebook run, or be absent."""

    def setUp(self):
        self.m = measured.Measured()
        if not self.m.available:
            self.skipTest("evaluation/experiment_registry.json not built")

    def test_all_three_notebooks_are_recorded_as_completed(self):
        self.assertEqual(self.m.status(),
                         {"notebook_02": "completed", "notebook_03": "completed",
                          "notebook_05": "completed"})

    def test_detector_metrics_come_from_the_registry(self):
        d = self.m.detector_metrics()
        self.assertEqual(d["n_test"], 265)
        self.assertEqual(d["model_id"], "Rahilgh/greentruth-claim-detector")
        self.assertGreater(d["transformer"]["macro_f1"], 0.8)

    def test_transformer_beats_rule_baseline_on_recall(self):
        """The measured justification for making the transformer primary."""
        d = self.m.detector_metrics()
        self.assertIsNotNone(d["rule_based"], "baseline not reproduced")
        self.assertGreater(d["transformer"]["claim_recall"],
                           d["rule_based"]["recall_claim"])
        self.assertGreater(d["macro_f1_gain"], 0.2)

    def test_shipped_interval_calibration_is_measured(self):
        s = self.m.shipped_interval_calibration()
        self.assertEqual(s["n_fields"], 12)
        self.assertEqual(s["protocol"], "leave-one-field-out")
        self.assertAlmostEqual(s["marginal_coverage"], 0.9071, places=3)

    def test_per_gap_coverage_is_available(self):
        self.assertIsNotNone(self.m.coverage_for_gap(5))
        self.assertIsNone(self.m.coverage_for_gap(99))

    def test_missing_registry_yields_none_not_a_guess(self):
        empty = measured.Measured(registry_file="/__nope__/a.json",
                                  rule_file="/__nope__/b.json")
        self.assertFalse(empty.available)
        self.assertIsNone(empty.detector_metrics())
        self.assertIsNone(empty.shipped_interval_calibration())
        self.assertIsNone(empty.detector_headline())

    def test_verdict_carries_measured_coverage_for_its_own_gap(self):
        gt = engine_with()
        res = gt.analyze("We reduced flaring by 30% by 2024 from 2019 levels.",
                         "Bakken")
        ic = res["claims"][0]["interval_calibration"]
        self.assertEqual(ic["year_gap"], 5)
        self.assertIsNotNone(ic["measured_coverage_at_this_gap"])
        self.assertEqual(ic["source"], "notebooks/05_uncertainty_calibration.ipynb")


# ------------------------------------------------- synthesis & conflict engine

class EvidenceSynthesis(unittest.TestCase):
    """Sources are reported side by side, never averaged into one number."""

    def test_sources_are_listed_with_their_instruments(self):
        gt = engine_with()
        res = gt.analyze("We reduced flaring by 25% by 2024 from 2019 levels.",
                         "Permian Basin")
        y = res["claims"][0]["synthesis"]
        keys = {s["key"] for s in y["sources"]}
        self.assertIn("flaring_field", keys)
        for s in y["sources"]:
            self.assertTrue(s["instrument"])
            self.assertTrue(s["spatial"])
            self.assertTrue(s["role"])

    def test_no_combined_score_is_produced(self):
        gt = engine_with()
        y = gt.analyze("We reduced flaring by 25% by 2024 from 2019 levels.",
                       "Permian Basin")["claims"][0]["synthesis"]
        for forbidden in ("score", "combined", "overall_value", "rating"):
            self.assertNotIn(forbidden, y)
        self.assertIn("no physical meaning", y["not_a_score"])

    def test_cross_sensor_tension_detected_on_real_data(self):
        """Permian: flaring falls, methane anomaly rises."""
        gt = engine_with()
        y = gt.analyze("We reduced flaring by 25% by 2024 from 2019 levels.",
                       "Permian Basin")["claims"][0]["synthesis"]
        self.assertTrue(y["cross_sensor_tension"])
        self.assertIn(y["state"], (conflict.CROSS_SENSOR_TENSION,
                                   conflict.MULTIPLE_TENSIONS))
        self.assertTrue(y["possible_explanations"])

    def test_cross_scale_divergence_detected_on_real_data(self):
        """Rumaila: field falls, country rises."""
        gt = engine_with()
        y = gt.analyze("We reduced flaring by 20% by 2024 from 2019 levels.",
                       "Rumaila / Basra")["claims"][0]["synthesis"]
        self.assertTrue(y["cross_scale_divergence"])

    def test_disagreement_is_never_framed_as_wrongdoing(self):
        gt = engine_with()
        y = gt.analyze("We reduced flaring by 25% by 2024 from 2019 levels.",
                       "Permian Basin")["claims"][0]["synthesis"]
        self.assertIn("not evidence of", y["not_an_accusation"])
        blob = (y["summary"] + " ".join(y["possible_explanations"])).lower()
        for word in ("lied", "lying", "fraud", "greenwash", "deceptive", "guilty"):
            self.assertNotIn(word, blob)

    def test_report_counts_tensions(self):
        gt = engine_with()
        res = gt.analyze("We reduced flaring by 25% by 2024 from 2019 levels.",
                         "Permian Basin")
        self.assertIn("evidence_tensions", res["summary"])
        self.assertGreaterEqual(res["summary"]["evidence_tensions"], 1)


# --------------------------------------------------- three-level sufficiency

class SufficiencyLevels(unittest.TestCase):
    def test_three_levels_exist_and_are_used(self):
        self.assertEqual(
            {sufficiency.SUFFICIENT, sufficiency.PARTIALLY_SUFFICIENT,
             sufficiency.INSUFFICIENT},
            {"SUFFICIENT", "PARTIALLY_SUFFICIENT", "INSUFFICIENT"})

    def test_wide_interval_yields_insufficient(self):
        gt = engine_with("us_bakken", NOISY)
        s = gt.analyze("We reduced flaring by 40% by 2024 from 2019 levels.",
                       "Bakken")["claims"][0]["sufficiency"]
        self.assertEqual(s["level"], sufficiency.INSUFFICIENT)
        self.assertFalse(s["sufficient"])

    def test_structural_limits_downgrade_to_partial(self):
        """
        Clean numbers are not enough. Attribution is never possible with VIIRS,
        so the best achievable level on this data is PARTIALLY_SUFFICIENT.
        """
        gt = engine_with("algeria_hassi_messaoud", SMOOTH_BIG_CUT)
        s = gt.analyze("We reduced flaring by 30% by 2024 from 2019 levels.",
                       "Hassi Messaoud")["claims"][0]["sufficiency"]
        self.assertEqual(s["level"], sufficiency.PARTIALLY_SUFFICIENT)
        self.assertIn(sufficiency.ATTRIBUTION_LIMIT, s["structural_limitations"])
        self.assertTrue(s["sufficient"])        # legacy boolean still true

    def test_every_result_states_an_evidence_ceiling(self):
        gt = engine_with("algeria_hassi_messaoud", SMOOTH_BIG_CUT)
        s = gt.analyze("We reduced flaring by 30% by 2024 from 2019 levels.",
                       "Hassi Messaoud")["claims"][0]["sufficiency"]
        self.assertTrue(s["evidence_ceiling"])
        self.assertIn("not the conduct of a named operator", s["evidence_ceiling"])

    def test_dashboard_counts_levels_from_real_processing(self):
        gt = engine_with()
        res = gt.analyze(
            "We reduced flaring by 25% by 2024 from 2019 levels. "
            "We cut methane emissions by 30%.", "Permian Basin")
        s = res["summary"]
        self.assertIn("by_sufficiency_level", s)
        self.assertEqual(
            s["fully_sufficient"] + s["partially_sufficient"] + s["insufficient"],
            sum(s["by_sufficiency_level"].values()))


# ----------------------------------------------------- ongoing-action claims

class OngoingActionClaims(unittest.TestCase):
    """Claims with no quantity must be reported, not silently dropped."""

    TEXT = ("We reduced flaring by 40% from 2019 levels, will eliminate routine "
            "flaring by 2030, and are investing in renewable energy.")

    def test_three_claims_are_extracted(self):
        claims = build_claims(self.TEXT)
        self.assertEqual(len(claims), 3, [c.raw_text for c in claims])

    def test_investment_claim_is_captured_with_its_metric(self):
        third = build_claims(self.TEXT)[2]
        self.assertEqual(third.metric, metrics.RENEWABLE)
        self.assertFalse(third.metric_supported)

    def test_investment_claim_reports_no_signal(self):
        gt = engine_with()
        res = gt.analyze(self.TEXT, "Bakken")
        renew = [c for c in res["claims"]
                 if c["claim"]["metric"] == metrics.RENEWABLE]
        self.assertEqual(len(renew), 1)
        self.assertEqual(renew[0]["verdict"], NO_SIGNAL)

    def test_no_trajectory_is_implied_for_an_unquantified_claim(self):
        third = build_claims(self.TEXT)[2]
        notes = " ".join(third.extraction_notes)
        self.assertIn("no numeric target", notes)


# ------------------------------------------------------------------ detectors

class Detectors(unittest.TestCase):
    def setUp(self):
        detectors.reset_cache()

    def tearDown(self):
        detectors.reset_cache()

    def test_rule_based_detector_is_always_available(self):
        det, info = detectors.get_detector("rule_based")
        self.assertEqual(info["detector"], "rule_based")
        self.assertTrue(info["fallback"])
        self.assertTrue(det.score("We reduced flaring by 40% in 2023.")[0])

    def test_rule_detector_rejects_framing_without_a_number_or_verb(self):
        det, _ = detectors.get_detector("rule_based")
        self.assertFalse(det.score("Flaring matters to us.")[0])

    def test_auto_mode_reports_which_detector_actually_ran(self):
        _, info = detectors.get_detector("auto")
        self.assertIn(info["detector"], ("climatebert", "rule_based"))
        if info["detector"] == "rule_based":
            # Falling back is fine; claiming a model inference that did not
            # happen is not. A reason must always accompany the fallback.
            self.assertTrue(info["fallback"])
            self.assertTrue(info.get("reason"))
        else:
            self.assertFalse(info["fallback"])

    def test_forcing_climatebert_surfaces_the_error_instead_of_falling_back(self):
        """
        Forcing the transformer must either load it or raise - never silently
        hand back the rule detector.

        `import transformers` succeeding is NOT a reliable proxy for the model
        being loadable: transformers imports sklearn and scipy lazily, so an
        environment with a mismatched NumPy ABI can import the package and still
        fail at load. The test therefore attempts the real load and asserts the
        correct behaviour in either outcome.
        """
        try:
            det, info = detectors.get_detector("climatebert", use_cache=False)
        except Exception as e:
            # Acceptable: it raised rather than falling back. The message must
            # say what to do about it.
            msg = str(e).lower()
            self.assertTrue(
                any(w in msg for w in ("transformers", "torch", "could not load")),
                f"unhelpful error when forcing climatebert: {e}")
            return
        # Loaded: it must report itself honestly and actually score.
        self.assertEqual(info["detector"], "climatebert")
        self.assertFalse(info["fallback"])
        self.assertEqual(info["model_id"], detectors.HF_MODEL_ID)
        self.assertFalse(info["requires_token"])
        keep, prob = det.score("We reduced routine gas flaring by 40% in 2023.")
        self.assertIsInstance(prob, float)
        self.assertGreaterEqual(prob, 0.0)
        self.assertLessEqual(prob, 1.0)

    def test_auto_never_silently_reports_a_model_that_did_not_run(self):
        """Whatever happens, `auto` must not claim an inference it did not make."""
        _, info = detectors.get_detector("auto", use_cache=False)
        if info["detector"] == "rule_based":
            self.assertTrue(info["fallback"])
            self.assertTrue(info.get("reason"), "fallback must explain itself")
        else:
            self.assertEqual(info["detector"], "climatebert")
            self.assertFalse(info["fallback"])

    def test_result_records_the_detector_used(self):
        gt = engine_with()
        res = gt.analyze(DEMO, "Bakken")
        self.assertIn("detector", res)
        self.assertIn(res["detector"]["detector"], ("climatebert", "rule_based"))
        self.assertEqual(res["claims"][0]["claim"]["detector"],
                         res["detector"]["detector"])


# ---------------------------------------------------------------- API surface

class ResultShape(unittest.TestCase):
    def setUp(self):
        self.res = engine_with().analyze(DEMO, "Bakken")

    def test_legacy_keys_are_preserved(self):
        for k in ("company", "facilities", "summary", "claims"):
            self.assertIn(k, self.res)
        for k in ("text", "topic", "verdict", "rationale"):
            self.assertIn(k, self.res["claims"][0])

    def test_structured_keys_are_present(self):
        for k in ("field", "field_candidates", "detector", "coverage",
                  "unavailable_channels"):
            self.assertIn(k, self.res)
        for k in ("claim", "verdict_label", "sufficiency", "evidence_chain",
                  "is_abstention"):
            self.assertIn(k, self.res["claims"][0])

    def test_summary_is_evidence_transparency_not_a_score(self):
        s = self.res["summary"]
        self.assertIn("with_sufficient_evidence", s)
        self.assertIn("needing_more_evidence", s)
        for forbidden in ("score", "green_score", "grade", "rating"):
            self.assertNotIn(forbidden, s)

    def test_every_claim_is_json_serialisable(self):
        import json
        json.dumps(self.res)   # raises if anything is not serialisable


# ------------------------------------------------ fields the interface reads

class InterfaceSupport(unittest.TestCase):
    """Additive keys that let the interface draw exactly what the backend
    decided, instead of re-declaring constants or guessing availability."""

    def test_analysis_exposes_the_flat_band_the_verdict_used(self):
        from greentruth import verdict
        res = engine_with().analyze(
            "We reduced routine gas flaring by 25% from 2019 levels.", "Permian Basin")
        a = res["claims"][0]["analysis"]
        self.assertEqual(a["flat_band"], verdict.FLAT_BAND)
        # The regions a client redraws from these values match the verdict's own.
        claimed = a["claimed_change"]
        self.assertEqual(verdict._region(a["interval"][0], claimed), a["region_low"])
        self.assertEqual(verdict._region(a["interval"][1], claimed), a["region_high"])
        self.assertEqual(verdict._region(a["observed_change"], claimed), a["region_point"])

    def test_fields_report_national_series_availability(self):
        fields = {f["id"]: f for f in engine_with().fields()}
        for f in fields.values():
            self.assertIn("has_country_series", f)
            self.assertIn("country_series_key", f)
        self.assertEqual(fields["us_permian"]["country_series_key"], "United States")
        self.assertTrue(fields["us_permian"]["has_country_series"])
        # Spelling alias, resolved rather than guessed.
        self.assertEqual(fields["russia_priobskoye"]["country_series_key"],
                         "Russian Federation")

    def test_unresolved_field_is_not_reported_as_missing_data(self):
        # Real data is loaded; the claim simply names no monitored field. The
        # reason must say that, not tell the user to fetch data that is present.
        res = engine_with().analyze("We cut gas flaring by 30% since 2015.", None)
        self.assertIsNone(res["field"])
        c = res["claims"][0]
        self.assertEqual(c["verdict"], INSUFFICIENT_EVIDENCE)
        self.assertIn("no monitored field", c["rationale"].lower())
        self.assertNotIn("notebook", c["rationale"].lower())

    def test_missing_country_file_reports_absence_not_a_guess(self):
        ev = Evidence(country_csv=os.path.join("does", "not", "exist.csv"))
        gt = GreenTruth(evidence=ev, detector_preference="rule_based")
        for f in gt.fields():
            self.assertFalse(f["has_country_series"])
            self.assertIsNone(f["country_series_key"])
            self.assertEqual(f["n_country_years"], 0)


# ------------------------------------------- demo narration matches the data

class DemoNarrative(unittest.TestCase):
    """The prepared demo cases carry hand-written "what to look for" text. It must
    describe what the pipeline actually computes on the real data, or the demo
    would narrate a result the evidence does not show."""

    @classmethod
    def setUpClass(cls):
        os.environ.setdefault("GREENTRUTH_DETECTOR", "rule_based")
        import server
        cls.cases = server.DEMO_CASES
        cls.gt = engine_with()

    def test_each_case_reaches_its_stated_outcome(self):
        expected = {"SUPPORTED": SUPPORTED, "ABSTAIN": ABSTAIN}
        for case in self.cases:
            c = self.gt.analyze(case["text"], case["field"])["claims"][0]
            self.assertEqual(c["verdict"], expected[case["expected"]], case["id"])

    def test_numbers_quoted_in_the_narration_are_the_computed_ones(self):
        for case in self.cases:
            a = self.gt.analyze(case["text"], case["field"])["claims"][0]["analysis"]
            text = case["what_to_look_for"]
            for v in (a["observed_change"], a["interval"][0], a["interval"][1]):
                pct = f"{abs(v) * 100:.0f}%"
                self.assertIn(pct, text, f"{case['id']}: {pct} not quoted")

    def test_borderline_is_described_as_borderline(self):
        for case in self.cases:
            a = self.gt.analyze(case["text"], case["field"])["claims"][0]["analysis"]
            if a.get("borderline"):
                self.assertIn("borderline", case["what_to_look_for"].lower(), case["id"])
                self.assertNotIn("single decision region", case["what_to_look_for"].lower())


if __name__ == "__main__":
    unittest.main()
