"""Persistent SQLite-Backed & In-Memory Elapsed-Time Recalculation Scheduler (Workstream D)."""

from __future__ import annotations

import json
import logging
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .estimation_state import ApplicationState

logger = logging.getLogger(__name__)


@dataclass
class ScheduleDecision:
    should_recalculate: bool
    reason: str
    is_stale: bool = False


class EstimationScheduler:
    """Recalculation scheduler with SQLite WAL persistence across restarts."""

    def __init__(
        self,
        *,
        db_path: str | Path | None = None,
        min_elapsed_advance_h: float = 0.25,
        stale_after_seconds: float = 3600.0,
    ) -> None:
        self.db_path = Path(db_path) if db_path is not None else None
        self.min_elapsed_advance_h = float(min_elapsed_advance_h)
        self.stale_after_seconds = float(stale_after_seconds)
        self._last_by_session: dict[str, dict[str, Any]] = {}
        if self.db_path is not None:
            self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        assert self.db_path is not None
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(self.db_path), timeout=5.0, isolation_level=None)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        return conn

    def _init_schema(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS scheduler_state (
                    session_id TEXT PRIMARY KEY,
                    last_elapsed_h REAL,
                    last_calculated_at TEXT,
                    last_app_state TEXT,
                    last_model_status TEXT,
                    model_artifact_id TEXT,
                    last_attempted_at TEXT,
                    last_payload_json TEXT,
                    retry_state_json TEXT
                );
                """
            )

    def _load_persisted(self, session_id: str) -> dict[str, Any] | None:
        if session_id in self._last_by_session:
            return self._last_by_session[session_id]
        if self.db_path is None:
            return None
        try:
            with self._connect() as conn:
                row = conn.execute(
                    "SELECT * FROM scheduler_state WHERE session_id = ?",
                    (session_id,),
                ).fetchone()
            if row is None or row["last_payload_json"] is None or row["last_calculated_at"] is None:
                return None
            payload = json.loads(str(row["last_payload_json"]))
            calc_dt = datetime.fromisoformat(str(row["last_calculated_at"]))
            if calc_dt.tzinfo is None:
                calc_dt = calc_dt.replace(tzinfo=timezone.utc)
            rec = {
                "elapsed_h": float(row["last_elapsed_h"]),
                "calculated_at": calc_dt,
                "payload": payload,
                "app_state": row["last_app_state"],
            }
            self._last_by_session[session_id] = rec
            return rec
        except Exception as exc:  # noqa: BLE001 - Corrupt/unavailable DB must fail safely
            logger.warning("Scheduler failed reading persisted state for %s: %s", session_id, exc)
            return None

    def record_attempt(
        self,
        session_id: str,
        attempted_at: datetime,
        app_state: ApplicationState,
        retry_state: dict[str, Any] | None = None,
    ) -> None:
        if self.db_path is None:
            return
        try:
            with self._connect() as conn:
                conn.execute("BEGIN IMMEDIATE;")
                conn.execute(
                    """
                    INSERT INTO scheduler_state (session_id, last_attempted_at, last_app_state, retry_state_json)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(session_id) DO UPDATE SET
                        last_attempted_at = excluded.last_attempted_at,
                        last_app_state = excluded.last_app_state,
                        retry_state_json = excluded.retry_state_json
                    """,
                    (
                        session_id,
                        attempted_at.isoformat(),
                        app_state.value,
                        json.dumps(retry_state or {}),
                    ),
                )
                conn.execute("COMMIT;")
        except Exception as exc:  # noqa: BLE001
            logger.error("Scheduler failed persisting attempt for %s: %s", session_id, exc)

    def record_success(self, session_id: str, elapsed_h: float, calculated_at: datetime, payload: dict[str, Any]) -> None:
        rec = {
            "elapsed_h": float(elapsed_h),
            "calculated_at": calculated_at,
            "payload": dict(payload),
            "app_state": payload.get("application_state"),
        }
        self._last_by_session[session_id] = rec
        if self.db_path is None:
            return
        try:
            with self._connect() as conn:
                conn.execute("BEGIN IMMEDIATE;")
                conn.execute(
                    """
                    INSERT INTO scheduler_state (
                        session_id, last_elapsed_h, last_calculated_at, last_app_state,
                        last_model_status, model_artifact_id, last_attempted_at,
                        last_payload_json, retry_state_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(session_id) DO UPDATE SET
                        last_elapsed_h = excluded.last_elapsed_h,
                        last_calculated_at = excluded.last_calculated_at,
                        last_app_state = excluded.last_app_state,
                        last_model_status = excluded.last_model_status,
                        model_artifact_id = excluded.model_artifact_id,
                        last_attempted_at = excluded.last_attempted_at,
                        last_payload_json = excluded.last_payload_json,
                        retry_state_json = excluded.retry_state_json
                    """,
                    (
                        session_id,
                        float(elapsed_h),
                        calculated_at.isoformat(),
                        str(payload.get("application_state", "")),
                        str(payload.get("model_status", "")),
                        str(payload.get("model_artifact_id", "")),
                        calculated_at.isoformat(),
                        json.dumps(payload),
                        json.dumps(payload.get("recovery", {})),
                    ),
                )
                conn.execute("COMMIT;")
        except Exception as exc:  # noqa: BLE001
            logger.error("Scheduler failed persisting success for %s: %s", session_id, exc)

    def get_last_valid(self, session_id: str, now_dt: datetime) -> dict[str, Any] | None:
        rec = self._load_persisted(session_id)
        if rec is None:
            return None
        age_s = (now_dt - rec["calculated_at"]).total_seconds()
        out = dict(rec["payload"])
        out["is_stale"] = age_s > self.stale_after_seconds
        out["age_seconds"] = round(max(age_s, 0.0), 2)
        return out

    def evaluate_trigger(
        self,
        *,
        session_id: str,
        current_elapsed_h: float,
        now_dt: datetime,
        previous_app_state: ApplicationState | None = None,
        dependency_recovered: bool = False,
        force: bool = False,
    ) -> ScheduleDecision:
        if force:
            return ScheduleDecision(True, "Forced recalculation requested.")
        if dependency_recovered:
            return ScheduleDecision(True, "Dependency recovered after previous failure.")
        if previous_app_state in (
            ApplicationState.INITIALIZING,
            ApplicationState.WAITING_FOR_DATA,
            ApplicationState.TEMPORARILY_UNAVAILABLE,
            ApplicationState.RETRYING,
        ):
            return ScheduleDecision(True, f"Initial or recovery trigger from state {previous_app_state}.")

        prev = self._load_persisted(session_id)
        if prev is None:
            return ScheduleDecision(True, "No prior persisted calculation for session.")

        delta_h = current_elapsed_h - float(prev["elapsed_h"])
        age_s = (now_dt - prev["calculated_at"]).total_seconds()
        if delta_h >= self.min_elapsed_advance_h - 1e-9:
            return ScheduleDecision(True, f"Elapsed time advanced by {delta_h:.3f}h >= {self.min_elapsed_advance_h}h.")
        if age_s > self.stale_after_seconds:
            return ScheduleDecision(True, f"Prior estimate aged {age_s:.1f}s > stale limit {self.stale_after_seconds:.1f}s.", is_stale=True)
        return ScheduleDecision(False, f"Elapsed advance {delta_h:.3f}h < {self.min_elapsed_advance_h}h; using fresh cache.", is_stale=False)


__all__ = ["EstimationScheduler", "ScheduleDecision"]
