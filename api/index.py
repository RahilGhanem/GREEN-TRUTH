"""
Vercel entry point for the GreenTruth API.

This file adds no API or scientific logic. Vercel's Python runtime accepts a
`handler` class that subclasses `BaseHTTPRequestHandler`, which is exactly what
server.py's `Handler` already is, so the deployed API runs the same routes,
the same GreenTruth engine and the same response schemas as `python server.py`.

Only two things differ from the local server:

* vercel.json rewrites every /api/<path> request to this one function and
  passes the original <path> in the `__gt_path` query parameter. Depending on
  the runtime, the function may see either the original URL or the rewritten
  one; restoring the path here makes both cases route identically.
* Static files are served by Vercel from web/ (vercel.json `outputDirectory`),
  so this function answers /api requests only.
"""

import os
import sys
from urllib.parse import parse_qsl, urlencode, urlsplit

# The project root holds server.py, greentruth/, data/ and evaluation/.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from server import Handler  # noqa: E402  (needs the path set above)

PATH_PARAM = "__gt_path"


def restore_path(raw_path):
    """Return the request path the browser asked for.

    `/api/index?__gt_path=fields/x/observations&a=1` -> `/api/fields/x/observations?a=1`.
    A path without the parameter is returned unchanged.
    """
    parts = urlsplit(raw_path)
    query = parse_qsl(parts.query, keep_blank_values=True)
    original = [v for k, v in query if k == PATH_PARAM]
    if not original:
        return raw_path
    rest = urlencode([(k, v) for k, v in query if k != PATH_PARAM])
    path = "/api/" + original[-1].lstrip("/")
    return path + ("?" + rest if rest else "")


class handler(Handler):
    def _restore(self):
        self.path = restore_path(self.path)

    def _serve_static(self, path):
        # Static assets come from Vercel's CDN, never from this function.
        return False

    def do_GET(self):
        self._restore()
        super().do_GET()

    def do_POST(self):
        self._restore()
        super().do_POST()

    def do_OPTIONS(self):
        self._restore()
        super().do_OPTIONS()
