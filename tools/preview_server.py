#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
سرور پیش‌نمایش محلی برای دیدن GUI وب در مرورگر.

    python3 tools/preview_server.py [port]

ریشه‌ی ریپو را سرو می‌کند (پس ساختار پوشه‌ها هم قابل مرور است) ولی مسیر
.git و خروجی build را مسدود می‌کند. GUI وب بدون سخت‌افزار در «حالت
شبیه‌سازی» کامل کار می‌کند.
"""
import http.server
import os
import socketserver
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
BLOCKED = ("/.git", "/tools/hosttest/build", "/_archive")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def _blocked(self):
        return any(self.path.startswith(b) for b in BLOCKED)

    def do_GET(self):
        if self._blocked():
            self.send_error(404, "Not found")
            return
        return super().do_GET()

    def end_headers(self):
        # تا مرورگر همیشه نسخه‌ی تازه‌ی js/css را بگیرد
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("[preview] " + (fmt % args) + "\n")


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    print(f"serving {ROOT} on 0.0.0.0:{PORT}  ->  http://localhost:{PORT}/gui/")
    with Server(("0.0.0.0", PORT), Handler) as httpd:
        httpd.serve_forever()
