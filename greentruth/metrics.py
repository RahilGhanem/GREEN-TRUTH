"""
The metric vocabulary, and which metrics GreenTruth can actually observe.

Exactly one metric is wired to real observations today: gas flaring, from the
World Bank Global Gas Flaring Tracker (VIIRS). Every other metric here is
recognised so that a claim about it can be reported honestly as "no signal to
check" rather than silently mis-verified against flaring data.

`SUPPORTED_METRICS` is the single source of truth for that distinction. Adding a
new observation channel means adding it here and registering a provider in
greentruth/evidence.py — nothing else needs to change.
"""

GAS_FLARING = "gas_flaring"
METHANE = "methane"
GHG = "ghg_emissions"
WATER = "water"
DEFORESTATION = "deforestation"
RENEWABLE = "renewable_energy"
WASTE = "waste"

# metric id -> (display label, surface forms found in text)
# Longer phrases are matched first so "routine gas flaring" wins over "flaring".
METRICS = {
    GAS_FLARING: {
        "label": "Gas flaring",
        "terms": [
            "routine gas flaring", "routine flaring", "gas flaring",
            "flared gas", "flare stack", "flaring", "flared", "flares",
            "flare",
        ],
    },
    METHANE: {
        "label": "Methane emissions",
        "terms": [
            "methane emission", "methane emissions", "methane intensity",
            "methane", "ch4", "fugitive emission", "fugitive emissions",
            "venting", "vented", "gas leak", "gas leaks",
        ],
    },
    GHG: {
        "label": "Greenhouse gas emissions",
        "terms": [
            "greenhouse gas", "ghg emissions", "ghg", "carbon dioxide", "co2",
            "carbon emission", "carbon emissions", "carbon intensity",
            "net zero", "net-zero", "carbon neutral", "decarboni",
            "scope 1", "scope 2", "scope 3", "emissions intensity",
        ],
    },
    WATER: {
        "label": "Water use",
        "terms": [
            "freshwater", "wastewater", "water discharge", "water withdrawal",
            "water use", "water consumption", "water recycl", "water-recycl",
            "water intensity",
        ],
    },
    DEFORESTATION: {
        "label": "Deforestation / land use",
        "terms": [
            "deforestation", "forest loss", "land clearing", "reforest",
            "afforest", "tree cover", "forested",
        ],
    },
    RENEWABLE: {
        "label": "Renewable energy",
        "terms": [
            "renewable energy", "renewables", "renewable", "solar power",
            "wind power", "clean energy", "green energy",
        ],
    },
    WASTE: {
        "label": "Waste",
        "terms": [
            "circular economy", "waste diversion", "zero waste", "landfill",
            "recycl",
        ],
    },
}

# The only metric with a real observation channel in the application.
SUPPORTED_METRICS = frozenset({GAS_FLARING})

# Metrics with an experimental / optional channel that is not treated as
# evidence. Notebook 03 Part B can produce a Sentinel-5P methane series; it is
# a coarse (~7 km) regional cross-check, never a primary verdict source.
EXPERIMENTAL_METRICS = frozenset({METHANE})

# Ordered by how specific the vocabulary is, so a sentence mentioning both
# "flaring" and "emissions" is typed as the more specific flaring claim.
_PRIORITY = [GAS_FLARING, METHANE, DEFORESTATION, WATER, RENEWABLE, WASTE, GHG]

# (metric_id, term) pairs, longest term first.
_TERM_INDEX = sorted(
    ((mid, term) for mid, spec in METRICS.items() for term in spec["terms"]),
    key=lambda pair: -len(pair[1]),
)


def label(metric_id):
    spec = METRICS.get(metric_id)
    return spec["label"] if spec else (metric_id or "unknown metric")


def is_supported(metric_id):
    return metric_id in SUPPORTED_METRICS


def metrics_in(text):
    """Every metric mentioned in `text`, most specific first."""
    low = text.lower()
    found = []
    for mid, term in _TERM_INDEX:
        if term in low and mid not in found:
            found.append(mid)
    return sorted(found, key=lambda m: _PRIORITY.index(m)
                  if m in _PRIORITY else len(_PRIORITY))


def primary_metric(text):
    """The single metric a clause is most plausibly about, or None."""
    found = metrics_in(text)
    return found[0] if found else None


def matched_term(text, metric_id):
    """The exact surface form that matched, for provenance in the UI."""
    low = text.lower()
    for mid, term in _TERM_INDEX:
        if mid == metric_id and term in low:
            return term
    return None


def unsupported_reason(metric_id):
    """Why a recognised metric has no verdict channel, in plain words."""
    if metric_id in EXPERIMENTAL_METRICS:
        return (
            f"{label(metric_id)} has only an experimental channel in "
            "GreenTruth (Sentinel-5P, ~7 km). It is a regional cross-check, "
            "not per-field evidence, so it is never used to issue a verdict."
        )
    if metric_id is None:
        return ("No environmental metric could be identified in this claim, so "
                "there is nothing to retrieve observations for.")
    return (
        f"{label(metric_id)} is recognised but has no observation channel in "
        "GreenTruth. Only gas flaring is currently wired to real "
        "Earth-observation data."
    )
