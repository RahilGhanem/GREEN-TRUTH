"""
Evidence synthesis and conflict detection across sources.

GreenTruth carries three real views of the same field. They are NOT equivalent,
and the whole point of this module is to keep them from being averaged into a
single number that hides which one disagreed.

    field flaring    VIIRS, per-field   the primary measurement
    national flaring VIIRS, per-country same instrument, different spatial scale
    methane          TROPOMI            a different satellite, a different quantity

Two kinds of disagreement, deliberately named differently
---------------------------------------------------------
**Cross-scale divergence** — the field moves one way, its country the other.
Both readings can be correct at once: a field is a small part of a national
footprint. This is context about scope, not a contradiction.

**Cross-sensor tension** — flaring falls while the background-referenced methane
anomaly rises. Physically this is the signature of gas being vented rather than
flared, because flaring combusts methane and venting releases it. It is also
consistent with unrelated regional methane sources, and at ~7 km the two cannot
be separated.

Neither is evidence of wrongdoing, and this module never says it is. What it does
is refuse to let a clean flaring number stand unqualified when another instrument
points elsewhere.

Why there is no combined score
------------------------------
A weighted average of "flaring down 29%" and "methane anomaly up 12 ppb" would be
a number with no physical meaning: different units, different instruments,
different footprints, different failure modes. The synthesis below reports the
sources side by side, states whether they agree, and stops there.
"""

# Overall synthesis states.
AGREEMENT = "agreement"                 # every available source points the same way
PARTIAL = "partial_agreement"           # sources differ in magnitude, not direction
CROSS_SCALE_DIVERGENCE = "cross_scale_divergence"
CROSS_SENSOR_TENSION = "cross_sensor_tension"
MULTIPLE_TENSIONS = "multiple_tensions"
SINGLE_SOURCE = "single_source"         # nothing to compare against

LABELS = {
    AGREEMENT: "Sources agree",
    PARTIAL: "Sources agree in direction",
    CROSS_SCALE_DIVERGENCE: "Cross-scale divergence",
    CROSS_SENSOR_TENSION: "Cross-sensor tension",
    MULTIPLE_TENSIONS: "Multiple evidence tensions",
    SINGLE_SOURCE: "Single source only",
}


def synthesise(analysis, corroboration=None, methane=None):
    """
    Combine what each source says, without collapsing them into one score.

    Returns a dict with the per-source view, the synthesis state, a plain-language
    explanation, and possible explanations for any disagreement.
    """
    sources = []

    if analysis and analysis.get("observed_change") is not None:
        sources.append(dict(
            key="flaring_field",
            name="Field flaring",
            instrument="VIIRS (World Bank Global Gas Flaring Tracker)",
            measures="flared gas volume at this field",
            spatial="flare detections within the field radius",
            temporal="annual",
            signal=f"{analysis['observed_change'] * 100:+.0f}%",
            signal_value=analysis["observed_change"],
            role="primary",
        ))

    if corroboration and corroboration.get("available"):
        sources.append(dict(
            key="flaring_country",
            name="National flaring",
            instrument="VIIRS (same programme, national totals)",
            measures="flared gas volume across the whole country",
            spatial="national",
            temporal="annual",
            signal=f"{corroboration['country_change'] * 100:+.0f}%",
            signal_value=corroboration["country_change"],
            role="cross-scale context (same instrument — not independent)",
        ))

    if methane and methane.get("available"):
        sources.append(dict(
            key="methane",
            name="Methane anomaly",
            instrument="Sentinel-5P / TROPOMI",
            measures="column-averaged CH4, referenced to the background",
            spatial="~7 km, regional",
            temporal="monthly means aggregated to annual",
            signal=f"{methane['anomaly_change_ppb']:+.1f} ppb",
            signal_value=methane["anomaly_change_ppb"],
            role="independent instrument",
        ))

    scale_div = bool(corroboration and corroboration.get("is_conflict"))
    sensor_tension = bool(methane and methane.get("available")
                          and methane.get("relationship") == "flaring_down_methane_up")

    if scale_div and sensor_tension:
        state = MULTIPLE_TENSIONS
    elif sensor_tension:
        state = CROSS_SENSOR_TENSION
    elif scale_div:
        state = CROSS_SCALE_DIVERGENCE
    elif len(sources) <= 1:
        state = SINGLE_SOURCE
    elif corroboration and corroboration.get("relationship") == "same_direction":
        state = PARTIAL
    else:
        state = AGREEMENT

    return dict(
        state=state,
        label=LABELS[state],
        sources=sources,
        n_sources=len(sources),
        has_independent_instrument=any(s["key"] == "methane" for s in sources),
        cross_scale_divergence=scale_div,
        cross_sensor_tension=sensor_tension,
        summary=_summary(state, analysis, corroboration, methane),
        possible_explanations=_explanations(state),
        not_a_score=("These sources measure different quantities at different "
                     "resolutions with different failure modes. They are reported "
                     "side by side rather than combined, because averaging them "
                     "would produce a number with no physical meaning."),
        not_an_accusation=("A disagreement between measurements is not evidence of "
                           "wrongdoing. It bounds what the observations can "
                           "support, and nothing more."),
    )


def _summary(state, analysis, corr, ch4):
    f = (f"{analysis['observed_change'] * 100:+.0f}%"
         if analysis and analysis.get("observed_change") is not None else "n/a")
    if state == SINGLE_SOURCE:
        return (f"Field flaring changed {f}. No second source was available for this "
                f"field and window, so the reading is uncorroborated.")
    if state == AGREEMENT:
        return (f"Field flaring changed {f}, and every other available source points "
                f"the same way. This is the strongest agreement the available "
                f"instruments can produce — which is still limited, because two of "
                f"the three views share the VIIRS instrument.")
    if state == PARTIAL:
        return (f"Field flaring changed {f}. The national total moved in the same "
                f"direction but by a different magnitude, consistent with a "
                f"field-specific effect on top of a wider trend.")
    if state == CROSS_SCALE_DIVERGENCE:
        c = f"{corr['country_change'] * 100:+.0f}%" if corr else "n/a"
        return (f"Field flaring changed {f} while the national total changed {c} — "
                f"opposite directions. Both can be true at once: this field is a "
                f"small part of the national footprint.")
    if state == CROSS_SENSOR_TENSION:
        m = f"{ch4['anomaly_change_ppb']:+.1f} ppb" if ch4 else "n/a"
        return (f"Field flaring changed {f}, but the independent methane instrument "
                f"shows a background-referenced anomaly of {m} — moving the other "
                f"way. Flaring burns methane and venting releases it, so this is the "
                f"pattern a shift from flaring to venting would produce. It is also "
                f"what unrelated regional methane sources would produce, and these "
                f"observations cannot separate the two.")
    m = f"{ch4['anomaly_change_ppb']:+.1f} ppb" if ch4 else "n/a"
    c = f"{corr['country_change'] * 100:+.0f}%" if corr else "n/a"
    return (f"Field flaring changed {f}, the national total {c}, and the methane "
            f"anomaly {m}. Both the spatial scale and the independent instrument "
            f"point away from the field reading, so it should carry little weight "
            f"on its own.")


def _explanations(state):
    if state == CROSS_SCALE_DIVERGENCE:
        return [
            "Flaring moved between fields inside the same country.",
            "Other fields in the country grew or shrank while this one did the reverse.",
            "The field's match radius includes or excludes flares near its boundary.",
            "The national total aggregates operators and sectors this field does not.",
        ]
    if state in (CROSS_SENSOR_TENSION, MULTIPLE_TENSIONS):
        return [
            "Gas may be vented rather than flared: venting releases methane, "
            "flaring combusts it.",
            "Unrelated methane sources in the same ~7 km region (agriculture, "
            "wetlands, landfill, other operators) can dominate the column.",
            "The two instruments have different footprints, so they are not "
            "measuring the same volume of air or ground.",
            "Flaring efficiency may have changed without the volume changing.",
        ]
    if state == SINGLE_SOURCE:
        return ["No second source covers this field and window."]
    return []
