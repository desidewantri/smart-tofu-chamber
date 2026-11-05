"""Minimal threaded HTTP server for the internal RSL engine.

Endpoints:
  GET  /health
  GET  /version
  POST /estimate   {"elapsedHours": number, "sampleStatus": "...", "storageCondition": "DRY"}

No external network access, no runtime fitting, no sensor predictors.
"""

from __future__ import annotations

import json
import os
import signal
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from .app import RequestError, estimate_payload, health_payload, version_payload

HOST = os.environ.get("RSL_HOST", "0.0.0.0")
PORT = int(os.environ.get("RSL_PORT", "8001"))
MAX_BODY = 64 * 1024


class Server(ThreadingHTTPServer):
    daemon_threads = True
    # The default backlog is 5; the dashboard can issue two calls and a small
    # burst of API requests concurrently. 128 absorbs local bursts without
    # changing the single-process runtime model.
    request_queue_size = 128


class Handler(BaseHTTPRequestHandler):
    server_version = "TofuSenseRSL/1.0"

    def log_message(self, fmt, *args):  # noqa: N802 - stdlib hook
        sys.stderr.write("[rsl] %s - %s\n" % (self.address_string(), fmt % args))

    def _send(self, status: int, payload: dict) -> None:
        raw = json.dumps(payload, ensure_ascii=False, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _error(self, status: int, message: str, code: str) -> None:
        self._send(status, {"success": False, "error": {"code": code, "message": message}})

    def do_GET(self):  # noqa: N802 - stdlib hook
        if self.path == "/health":
            self._send(200, health_payload())
        elif self.path == "/version":
            self._send(200, version_payload())
        else:
            self._error(404, "not found", "NOT_FOUND")

    def do_POST(self):  # noqa: N802 - stdlib hook
        if self.path != "/estimate":
            self._error(404, "not found", "NOT_FOUND")
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._error(400, "invalid Content-Length", "INVALID_REQUEST")
            return
        if length <= 0 or length > MAX_BODY:
            self._error(413 if length > MAX_BODY else 400, "invalid body size", "INVALID_REQUEST")
            return
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._error(400, "invalid JSON", "INVALID_JSON")
            return
        try:
            self._send(200, estimate_payload(body))
        except RequestError as exc:
            self._error(400, str(exc), exc.code)
        except Exception as exc:  # never leak a stack trace to the caller
            self.log_message("estimate failed: %s", exc.__class__.__name__)
            self._error(500, "engine unavailable", "ENGINE_ERROR")


def main() -> None:
    server = Server((HOST, PORT), Handler)

    def shutdown(_signum, _frame):
        # socketserver.shutdown() must be called from a different thread than
        # serve_forever(); calling it inline deadlocks the process.
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    print(f"[rsl] listening on {HOST}:{PORT}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
