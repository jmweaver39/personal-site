"""Local dev server for the site that tells the browser never to cache.

python's plain http.server sends no cache headers, so browsers reuse stale
copies of edited pages and frames. Usage: python3 tools/serve.py [port]
"""
import http.server
import os
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8431
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(root)
    http.server.ThreadingHTTPServer(("", port), NoCacheHandler).serve_forever()
