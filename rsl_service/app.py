"""FastAPI application untuk RSL V2.1 inference service."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from engine import (
    ARTIFACT_PATH,
    DOMAIN_MAX_HOURS,
    EXPECTED_SHA256,
    build_orchestrator,
    estimate,
    sha256_file,
    verify_artifact,
)


def create_app(
    *,
    artifact_path: Path = ARTIFACT_PATH,
    expected_sha256: str = EXPECTED_SHA256,
    db_path: Path | None = None,
    orchestrator=None,
) -> FastAPI:
    """Factory untuk membuat instance FastAPI app dengan fail-closed artifact check."""
    # Verifikasi langsung saat pembuatan app
    verify_artifact(artifact_path, expected_sha256)

    orch = orchestrator or build_orchestrator(
        artifact_path=artifact_path,
        expected_sha256=expected_sha256,
        db_path=db_path,
    )

    app = FastAPI(title="TofuSense RSL V2.1 Service")

    @app.exception_handler(HTTPException)
    async def http_exception_handler(_request: Request, exc: HTTPException):
        content = exc.detail if isinstance(exc.detail, dict) else {"error": {"code": "HTTP_ERROR", "message": str(exc.detail)}}
        return JSONResponse(status_code=exc.status_code, content=content)

    @app.get("/health")
    async def health():
        sha = sha256_file(artifact_path)
        return {
            "ok": True,
            "model_artifact_id": f"{artifact_path.name}:{sha[:12]}",
            "sha256": sha,
            "domain_max_hours": DOMAIN_MAX_HOURS,
        }

    @app.post("/estimate")
    async def run_estimate(request: Request):
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(
                status_code=400,
                detail={"error": {"code": "INVALID_REQUEST", "message": "Invalid JSON body"}},
            )

        if not isinstance(body, dict):
            raise HTTPException(
                status_code=400,
                detail={"error": {"code": "INVALID_REQUEST", "message": "Body must be a JSON object"}},
            )

        session_id = body.get("session_id")
        if not isinstance(session_id, str) or not session_id.strip():
            raise HTTPException(
                status_code=400,
                detail={"error": {"code": "INVALID_REQUEST", "message": "session_id must be a non-empty string"}},
            )

        for numeric_field in ("temp_c", "humid_pct"):
            val = body.get(numeric_field)
            if val is not None and (not isinstance(val, (int, float)) or isinstance(val, bool)):
                raise HTTPException(
                    status_code=400,
                    detail={"error": {"code": "INVALID_REQUEST", "message": f"{numeric_field} must be numeric"}},
                )

        esp32_conn = body.get("esp32_connected")
        if esp32_conn is not None and not isinstance(esp32_conn, bool):
            raise HTTPException(
                status_code=400,
                detail={"error": {"code": "INVALID_REQUEST", "message": "esp32_connected must be a boolean"}},
            )

        monitoring_start_at = body.get("monitoring_start_at")
        current_timestamp = body.get("current_timestamp")
        temp_c = float(body["temp_c"]) if body.get("temp_c") is not None else None
        humid_pct = float(body["humid_pct"]) if body.get("humid_pct") is not None else None
        connected = bool(esp32_conn) if esp32_conn is not None else True

        result = await run_in_threadpool(
            estimate,
            orch,
            session_id=session_id,
            monitoring_start_at=monitoring_start_at,
            current_timestamp=current_timestamp,
            temp_c=temp_c,
            humid_pct=humid_pct,
            esp32_connected=connected,
        )
        return result

    return app


_db_env = os.environ.get("RSL_DB_PATH")
_db_path = Path(_db_env) if _db_env else None
app = create_app(db_path=_db_path)
