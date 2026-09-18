"""
Evidence side of the pipeline (real data).

Loads the international field reference and the REAL annual flaring series
produced by notebooks/03_real_satellite_data_pipeline.ipynb (World Bank / VIIRS
individual flare locations). There is no synthetic data here: if the real series
has not been fetched yet, the pipeline says so plainly instead of inventing
numbers.

Expected real file (written by notebook 03):
    data/real/flaring_by_field.csv   columns: field, year, volume[, source]
where `field` matches a key in data/facilities_international.json.

Entity resolution
-----------------
Resolution is deliberately shallow and explicit. A claim names an organisation,
a basin or a country; the evidence is per-field. Where several fields could match
(a country with more than one monitored field, for example) `field_candidates`
returns all of them and the caller must surface the ambiguity rather than pick
one silently. The score attached to a match is a `resolution_score` — an ordinal
preference for how the match was made (exact id > field name > country), not a
probability.
"""

import csv
import datetime
import json
import os
from collections import defaultdict

BASE = os.path.dirname(os.path.dirname(__file__))
DATA_DIR = os.path.join(BASE, "data")
FACILITIES_FILE = os.path.join(DATA_DIR, "facilities_international.json")
REAL_FLARING = os.path.join(DATA_DIR, "real", "flaring_by_field.csv")
REAL_COUNTRY = os.path.join(DATA_DIR, "real", "flaring_by_country.csv")

# How a field was matched -> ordinal preference. Not a probability.
MATCH_EXACT_ID = 1.0
MATCH_FIELD_NAME = 0.9
MATCH_COUNTRY = 0.5


class Evidence:
    def __init__(self, facilities_file=FACILITIES_FILE, flaring_csv=REAL_FLARING,
                 country_csv=REAL_COUNTRY):
        with open(facilities_file, encoding="utf-8") as f:
            store = json.load(f)
        self.fields = store["fields"]          # id -> {name, country, lat, lon, ...}
        self.unit = store.get("unit", "billion m3 flared per year")
        self.claim_source = store.get("claim_source", "")

        self.series = defaultdict(dict)        # field id -> {year: volume}
        self.country_series = defaultdict(dict)
        self.has_real_data = False
        self.source_label = None
        self.data_file_modified = None
        self._load_real_series(flaring_csv)
        self._load_country_series(country_csv)

        # resolution index
        self._by_id = {fid.lower(): fid for fid in self.fields}
        self._by_name = {info["name"].lower(): fid
                         for fid, info in self.fields.items()}
        self._by_country = defaultdict(list)
        for fid, info in self.fields.items():
            c = (info.get("country") or "").lower()
            if c:
                self._by_country[c].append(fid)

    # -- loading ---------------------------------------------------------

    def _load_real_series(self, path):
        if not os.path.exists(path):
            return
        with open(path, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                try:
                    self.series[row["field"]][int(row["year"])] = float(row["volume"])
                except (KeyError, ValueError, TypeError):
                    continue
                if self.source_label is None and row.get("source"):
                    self.source_label = row["source"].strip()
        self.has_real_data = any(self.series.values())
        if self.has_real_data:
            # A proxy for when the pipeline was run. Labelled as such wherever it
            # surfaces — it is a local file timestamp, not a dataset release date.
            self.data_file_modified = datetime.date.fromtimestamp(
                os.path.getmtime(path)).isoformat()

    def _load_country_series(self, path):
        if not os.path.exists(path):
            return
        with open(path, encoding="utf-8") as f:
            for row in csv.DictReader(f):
                try:
                    self.country_series[row["country"]][int(row["year"])] = \
                        float(row["volume"])
                except (KeyError, ValueError, TypeError):
                    continue

    # -- field resolution ------------------------------------------------

    def resolve_field(self, name):
        """Best-effort single field id for a name/id/country, or None."""
        cands = self.field_candidates(name)
        return cands[0][0] if cands else None

    def field_candidates(self, name):
        """
        [(field_id, resolution_score, how)] for everything `name` could mean.

        More than one result means the claim is ambiguous at field level, and the
        caller is expected to say so rather than silently take the first.
        """
        if not name:
            return []
        key = name.strip().lower()
        if key in self._by_id:
            return [(self._by_id[key], MATCH_EXACT_ID, "exact field id")]
        if key in self._by_name:
            return [(self._by_name[key], MATCH_FIELD_NAME, "field name")]
        if key in self._by_country:
            fids = self._by_country[key]
            return [(f, MATCH_COUNTRY, "country") for f in fids]
        return []

    def detect_fields(self, text):
        """Every field a report text plausibly refers to, most specific first."""
        low = (text or "").lower()
        hits = []
        for fid, info in self.fields.items():
            if info["name"].lower() in low:
                hits.append((fid, MATCH_FIELD_NAME, "field name in text"))
        if hits:
            return hits
        for country, fids in self._by_country.items():
            if country and country in low:
                hits.extend((f, MATCH_COUNTRY, "country in text") for f in fids)
        return hits

    def field_info(self, field_id):
        """Field record including its id, or None."""
        if field_id not in self.fields:
            return None
        info = dict(self.fields[field_id])
        info["id"] = field_id
        return info

    def series_for(self, field_id):
        """Real annual series {year: volume} for a field id, or {}."""
        return dict(self.series.get(field_id, {}))

    def country_totals(self, country):
        """Real national annual totals, used as a context layer only."""
        return dict(self.country_series.get(country, {}))

    def country_totals_for_field(self, field_id):
        """
        (country_key, {year: volume}) for the country containing a field.

        The facility reference and the World Bank country sheet spell some
        countries differently ("Russia" vs "Russian Federation"); the alias map
        in corroboration.py resolves those. A country with no series returns
        (None, {}) rather than an empty guess.
        """
        from .corroboration import resolve_country_key
        info = self.field_info(field_id)
        if not info:
            return None, {}
        key = resolve_country_key(info.get("country"), self.country_series)
        return key, (dict(self.country_series[key]) if key else {})

    def coverage(self):
        """What is loaded, for the interface and the dashboard."""
        years = sorted({y for s in self.series.values() for y in s})
        return dict(
            has_real_data=self.has_real_data,
            n_fields=len([f for f in self.series if self.series[f]]),
            n_fields_configured=len(self.fields),
            n_observations=sum(len(s) for s in self.series.values()),
            year_min=years[0] if years else None,
            year_max=years[-1] if years else None,
            n_countries=len([c for c in self.country_series if self.country_series[c]]),
            unit=self.unit,
            source_label=self.source_label,
            data_file_modified=self.data_file_modified,
            data_file_modified_note=("local file timestamp; a proxy for when the "
                                     "pipeline notebook was run, not a dataset "
                                     "release date"),
        )

    # -- backward-compatible names --------------------------------------
    # The first version of the app called fields "companies". server.py, the
    # existing interface and the existing tests use these names, so they stay.

    def companies(self):
        """Display names of the entities the app can check."""
        return [info["name"] for info in self.fields.values()]

    def resolve_company(self, name):
        fid = self.resolve_field(name)
        return self.fields[fid]["name"] if fid else None

    def detect_company(self, text):
        hits = self.detect_fields(text)
        return self.fields[hits[0][0]]["name"] if hits else None

    def company_facilities(self, name):
        fid = self.resolve_field(name)
        info = self.field_info(fid)
        return [info] if info else []

    def entity_annual(self, name):
        """Real annual flaring series {year: volume} for the entity, or {}."""
        fid = self.resolve_field(name)
        return self.series_for(fid) if fid else {}
