"""Receives frames POSTed by a capture page (tools/scan-capture.html) and
writes them into the site's images/ folder.

The browser can't write files, so the capture page renders each frame and
POSTs it here. Only paths like images/<folder>/<name>.webp are accepted.
Usage: python3 tools/save_frames.py [port]   (default 8432)
"""
import http.server
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ALLOWED = re.compile(r"images/[a-z0-9_-]+/[a-z0-9_-]+\.(webp|png|jpg)")


class SaveHandler(http.server.BaseHTTPRequestHandler):
    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_POST(self):
        rel = self.path.lstrip("/")
        if not ALLOWED.fullmatch(rel):
            self.send_response(400)
            self.cors()
            self.end_headers()
            return
        data = self.rfile.read(int(self.headers["Content-Length"]))
        path = os.path.join(ROOT, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
        self.send_response(200)
        self.cors()
        self.end_headers()
        self.wfile.write(b"ok")


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8432
    http.server.ThreadingHTTPServer(("127.0.0.1", port), SaveHandler).serve_forever()
