"""
GreenTruth server (standard library only).

    python3 server.py            ->  http://localhost:8000
    python3 server.py 8080       ->  another port

No install step, no API key, no external service. That property is deliberate:
the demo must not be able to die because of a network call or a missing wheel.

API
---
  GET  /api/health                      liveness + which claim detector runs (loads it)
  GET  /api/meta                        fields, unit, coverage, detector in use
  GET  /api/fields                      every monitored field + observation coverage
  GET  /api/fields/<id>/observations    one field's real annual series + provenance
  GET  /api/map                         GeoJSON of the monitored fields
  GET  /api/basemap                     Natural Earth country outlines (public domain)
  GET  /api/research                   measured results from evaluation/ (notebooks 02/03/05,
                                        rule baseline, ablation)
  GET  /api/methane/coverage            Sentinel-5P retrieval completeness per field
  GET  /api/demo                        the demo report text (labelled as a demo)
  GET  /api/demo/cases                  two contrasting demo cases on real data
  POST /api/analyze                     { text, company } -> full investigation

Every numeric value returned by this server comes from data/real/, which is
produced by notebooks/03_real_satellite_data_pipeline.ipynb from the public
World Bank Global Gas Flaring Tracker. Nothing here generates observations.
"""

import json
import mimetypes
import os
import posixpath
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

from greentruth import GreenTruth
from greentruth import provenance as provenance_mod
from greentruth.schema import (ABSTENTION_VERDICTS, VERDICT_LABELS,
                               VERDICT_MEANINGS, VERDICTS)

# Explicit types for the static assets the interface ships. On Windows the
# mimetypes table is read from the registry and can be wrong or missing for
# these (notably .js and the web fonts).
for _ext, _type in ((".js", "text/javascript"), (".css", "text/css"),
                    (".woff2", "font/woff2"), (".woff", "font/woff"),
                    (".svg", "image/svg+xml"), (".mp4", "video/mp4"),
                    (".jpg", "image/jpeg"), (".png", "image/png")):
    mimetypes.add_type(_type, _ext)

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, "web")
ENGINE = GreenTruth()

# A demo claim, labelled as such. It is written to exercise the pipeline
# (a compound sentence carrying both a past result and a pledge); it is NOT a
# quotation from any real company report, and the interface says so. The
# evidence it is checked against is real.
DEMO_TEXT = (
    "We reduced routine gas flaring by 40% from 2019 levels and will "
    "eliminate routine flaring by 2030. We also cut methane emissions by 30% "
    "and are committed to reaching net zero by 2050."
)
DEMO_NOTE = ("Written for the demo, not quoted from any company. The data it is "
             "checked against is real.")

# Two contrasting cases, both against REAL observations. The claim wording is
# written to exercise the pipeline and is not quoted from any company; the fields,
# the series and every number the system returns are real.
#
# They exist to show the system is not wired to agree. One reaches a supported
# verdict; the other refuses to reach any verdict, and says why.
DEMO_CASES = [
    {
        "id": "case1",
        "title": "Evidence supports the claim",
        "field": "Niger Delta",
        "text": ("We reduced routine gas flaring by 40% by 2023 from 2012 levels."),
        "what_to_look_for": (
            "−42% observed against −40% claimed. The 90% range (−44% to −13%) "
            "touches two outcomes, so the verdict is Supported but borderline. "
            "Methane data is too sparse here (24% of months), so the evidence is "
            "only partially sufficient."),
        "expected": "SUPPORTED",
    },
    {
        "id": "case2",
        "title": "Evidence cannot decide, and instruments disagree",
        "field": "Permian Basin",
        "text": ("We reduced routine gas flaring by 25% from 2019 levels."),
        "what_to_look_for": (
            "−29% looks like success, but the 90% range runs from −25% to +127%, "
            "so GreenTruth abstains. Methane rose +12.1 ppb above the background "
            "while flaring fell: flagged as tension, not as wrongdoing."),
        "expected": "ABSTAIN",
    },
]

MAX_BODY = 1_000_000          # 1 MB cap on posted report text


class Handler(BaseHTTPRequestHandler):
    server_version = "GreenTruth"

    def log_message(self, *args):
        pass

    # -- helpers ---------------------------------------------------------

    def _send(self, code, body, content_type="application/json; charset=utf-8"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        # Same-origin by default; allow a separately hosted frontend in dev.
        origin = os.environ.get("GREENTRUTH_CORS_ORIGIN")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Headers", "Content-Type")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        # Enable CORS for local dev environments
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _serve_static(self, path):
        """Serve anything under web/, with traversal blocked."""
        rel = posixpath.normpath(path.lstrip("/")) or "index.html"
        if rel.startswith("..") or os.path.isabs(rel):
            self._send(403, {"error": "forbidden"})
            return True
        full = os.path.join(WEB, *rel.split("/"))
        if os.path.isdir(full):
            full = os.path.join(full, "index.html")
        if not os.path.isfile(full):
            return False
        ctype, _ = mimetypes.guess_type(full)
        try:
            with open(full, "rb") as f:
                self._send(200, f.read(), ctype or "application/octet-stream")
        except OSError:
            self._send(500, {"error": "could not read file"})
        return True

    # -- routes ----------------------------------------------------------

    def do_OPTIONS(self):
        self._send(204, b"")

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/api/health":
            cov = ENGINE.evidence.coverage()
            self._send(200, {
                "status": "ok",
                "has_real_data": cov["has_real_data"],
                "n_fields": cov["n_fields"],
                "n_observations": cov["n_observations"],
                # Resolves the detector (loading the model on first call), so
                # this always reports the detector that actually runs.
                "detector": ENGINE.detector_info,
            })
            return

        if path == "/api/meta":
            self._send(200, {
                "companies": ENGINE.companies(),      # legacy name, kept
                "fields": [f["name"] for f in ENGINE.fields()],
                "unit": ENGINE.evidence.unit,
                "has_real_data": ENGINE.evidence.has_real_data,
                "claim_source": ENGINE.evidence.claim_source,
                "coverage": ENGINE.evidence.coverage(),
                # Never waits for the model: "pending" until it has been loaded
                # (by /api/health or the first analysis).
                "detector": ENGINE.detector_status(),
                # Declared before any analysis runs, so the interface can show
                # what cannot be checked without waiting for a claim.
                "unavailable_channels": provenance_mod.unavailable_channels(),
                # The verdict vocabulary straight from schema.py, so the
                # interface cannot drift from the backend's wording.
                "verdict_vocabulary": [
                    {"id": v, "label": VERDICT_LABELS.get(v, v),
                     "meaning": VERDICT_MEANINGS.get(v, ""),
                     "is_abstention": v in ABSTENTION_VERDICTS}
                    for v in VERDICTS],
            })
            return

        if path == "/api/fields":
            self._send(200, {"fields": ENGINE.fields(),
                             "unit": ENGINE.evidence.unit})
            return

        if path.startswith("/api/fields/") and path.endswith("/observations"):
            field_id = path[len("/api/fields/"):-len("/observations")]
            out = ENGINE.observations(field_id)
            if out is None:
                self._send(404, {"error": f"unknown field '{field_id}'"})
            else:
                self._send(200, out)
            return

        if path == "/api/map":
            self._send(200, self._map_geojson())
            return

        if path == "/api/basemap":
            # Public-domain world boundaries (Natural Earth 110m), served from
            # disk so the map works with no network and no tile provider.
            try:
                with open(os.path.join(ROOT, "data", "geo", "world_110m.json"),
                          "rb") as f:
                    self._send(200, f.read())
            except FileNotFoundError:
                self._send(404, {"error": "basemap not installed",
                                 "detail": "data/geo/world_110m.json is missing"})
            return

        if path == "/api/research":
            # Measured experimental results only. Everything here traces to
            # evaluation/experiment_registry.json, built from the notebook runs.
            self._send(200, ENGINE.research())
            return

        if path == "/api/methane/coverage":
            self._send(200, {
                "available": ENGINE.methane.available,
                "source_label": ENGINE.methane.source_label,
                "dataset": __import__("greentruth.methane", fromlist=["DATASET"]).DATASET,
                "coverage": ENGINE.methane.coverage_report(),
                "min_completeness_required": __import__(
                    "greentruth.methane", fromlist=["MIN_COMPLETENESS"]).MIN_COMPLETENESS,
            })
            return

        if path == "/api/demo":
            self._send(200, {"text": DEMO_TEXT, "note": DEMO_NOTE,
                             "suggested_field": "Bakken", "is_demo": True})
            return

        if path == "/api/demo/cases":
            # Two contrasting cases against real observations. Both are run
            # through the identical pipeline; nothing about them is special-cased.
            self._send(200, {"cases": DEMO_CASES, "note": DEMO_NOTE})
            return

        if path.startswith("/api/"):
            self._send(404, {"error": "not found"})
            return

        if self._serve_static(path):
            return
        self._send(404, {"error": "not found"})

    def do_POST(self):
        if urlparse(self.path).path != "/api/analyze":
            self._send(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            self._send(400, {"error": "invalid Content-Length"})
            return
        if length > MAX_BODY:
            self._send(413, {"error": f"report too large (max {MAX_BODY} bytes)"})
            return
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            self._send(400, {"error": "invalid JSON body"})
            return
        if not isinstance(payload, dict):
            self._send(400, {"error": "body must be a JSON object"})
            return

        text = (payload.get("text") or "").strip()
        company = payload.get("company") or None
        if not text:
            self._send(400, {"error": "no report text was provided"})
            return
        try:
            self._send(200, ENGINE.analyze(text, company))
        except Exception as e:                       # never leak a stack trace
            self._send(500, {"error": f"analysis failed: {type(e).__name__}"})

    # -- map ---------------------------------------------------------------

    @staticmethod
    def _map_geojson():
        """
        Real monitored fields as GeoJSON.

        Coordinates come from data/facilities_international.json and the annual
        values from the real series. Nothing is interpolated or smoothed for
        display: a field with no observations reports none.
        """
        features = []
        for f in ENGINE.fields():
            series = ENGINE.evidence.series_for(f["id"])
            years = sorted(series)
            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [f["lon"], f["lat"]]},
                "properties": {
                    "id": f["id"],
                    "name": f["name"],
                    "country": f["country"],
                    "match_radius_km": f.get("match_radius_km"),
                    "unit": ENGINE.evidence.unit,
                    "years": years,
                    "values": [round(series[y], 6) for y in years],
                    "latest_year": years[-1] if years else None,
                    "latest_value": round(series[years[-1]], 6) if years else None,
                    "first_year": years[0] if years else None,
                    "first_value": round(series[years[0]], 6) if years else None,
                    "has_data": bool(years),
                    "country_series_key": f.get("country_series_key"),
                    "has_country_series": f.get("has_country_series", False),
                },
            })
        return {
            "type": "FeatureCollection",
            "features": features,
            "source": {
                "dataset": "World Bank Global Gas Flaring Tracker",
                "measurement": "VIIRS-based gas flaring volume estimate",
                "url": ("https://www.worldbank.org/en/programs/"
                        "gasflaringreduction/global-flaring-data"),
                "unit": ENGINE.evidence.unit,
            },
        }


def main(port=8000):
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    cov = ENGINE.evidence.coverage()
    print(f"GreenTruth running at http://localhost:{port}  (Ctrl-C to stop)")
    print(f"  detector : {ENGINE.detector_info.get('detector')}"
          f"{' (fallback)' if ENGINE.detector_info.get('fallback') else ''}")
    if cov["has_real_data"]:
        print(f"  evidence : {cov['n_observations']} real annual observations, "
              f"{cov['n_fields']} fields, {cov['year_min']}-{cov['year_max']}")
    else:
        print("  evidence : none loaded - run notebooks/03 to fetch the public "
              "World Bank / VIIRS data into data/real/")
    if ENGINE.methane.available:
        usable = sum(1 for f in ENGINE.methane.monthly if ENGINE.methane.usable(f))
        print(f"  methane  : Sentinel-5P loaded, {usable} of "
              f"{len(ENGINE.methane.monthly)} fields have usable retrieval coverage")
    else:
        print("  methane  : not loaded (optional independent cross-check)")
    det = ENGINE.measured.detector_headline()
    print(f"  detector measured: {det}" if det else
          "  detector measured: not measured (run notebook 02)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nstopped")


if __name__ == "__main__":
    import sys
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 8000)
