"""RSL Estimation Orchestrator with Domain Enforcement, Persistent Scheduler & Non-Blocking Recovery."""

from __future__ import annotations

import logging
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping

from tofu_ml.autonomous_rsl_v2.time_only_models import BayesianWeibullIC
from tofu_ml.autonomous_rsl_v2_1.phase5_6_contract_and_protocol import (
    FailClosedStateV21,
    evaluate_fail_closed_contract_v21,
)

from .estimation_scheduler import EstimationScheduler
from .estimation_state import (
    ApplicationState,
    DomainStatus,
    FailureCategory,
    InputTimestampError,
    TransientDependencyError,
)
from .recovery_manager import RecoveryConfig, RecoveryManager, RecoveryStatus

logger = logging.getLogger(__name__)


def _parse_iso_dt(val: str | None, field_name: str) -> datetime:
    if not val or not isinstance(val, str):
        raise InputTimestampError(f"Missing required timestamp field: {field_name}.")
    try:
        dt = datetime.fromisoformat(val)
    except ValueError as exc:
        raise InputTimestampError(f"Invalid ISO-8601 timestamp for {field_name}: {val!r}.") from exc
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def evaluate_domain_status(elapsed_h: float | None, max_validation_domain_h: float | None) -> DomainStatus:
    """Workstream A: Strict domain classification independent of model validation status."""
    if elapsed_h is None or not math.isfinite(elapsed_h) or elapsed_h < 0.0:
        return DomainStatus.INVALID_ELAPSED_TIME
    if max_validation_domain_h is None or not math.isfinite(max_validation_domain_h) or max_validation_domain_h <= 0.0:
        return DomainStatus.UNKNOWN_DOMAIN
    if abs(elapsed_h - max_validation_domain_h) <= 1e-12:
        return DomainStatus.AT_BOUNDARY
    if elapsed_h < max_validation_domain_h:
        return DomainStatus.WITHIN_DOMAIN
    return DomainStatus.BEYOND_DOMAIN


class RSLOrchestrator:
    """Application-layer orchestrator preserving V2.1 research & authorization contracts."""

    def __init__(
        self,
        *,
        model_artifact_path: str | Path,
        expected_model_sha256: str,
        model_loader: Callable[[], BayesianWeibullIC] | None = None,
        session_fetcher: Callable[[str], Mapping[str, Any]] | None = None,
        recovery_config: RecoveryConfig | None = None,
        scheduler: EstimationScheduler | None = None,
        db_path: str | Path | None = None,
        blocking_retry: bool = True,
        sleep_fn: Callable[[float], None] = lambda _: None,
        now_fn: Callable[[], datetime] | None = None,
        research_estimate_display_enabled: bool = True,
        max_validation_domain_h: float | None = 42.8888,
        max_pi80_width_provisional_h: float = 40.0,
    ) -> None:
        self.model_artifact_path = Path(model_artifact_path)
        self.expected_model_sha256 = str(expected_model_sha256)
        self._custom_model_loader = model_loader
        self._custom_session_fetcher = session_fetcher
        self.now_fn = now_fn or (lambda: datetime.now(timezone.utc))
        self.recovery = RecoveryManager(config=recovery_config, sleep_fn=sleep_fn, now_fn=self.now_fn)
        self.scheduler = scheduler or EstimationScheduler(db_path=db_path)
        self.blocking_retry = bool(blocking_retry)
        self.research_estimate_display_enabled = bool(research_estimate_display_enabled)
        self.max_validation_domain_h = max_validation_domain_h
        self.max_pi80_width_provisional_h = float(max_pi80_width_provisional_h)
        self._last_state_by_session: dict[str, ApplicationState] = {}
        self._last_valid_ts_by_session: dict[str, datetime] = {}

    def _load_frozen_v21_model(self) -> BayesianWeibullIC:
        if self._custom_model_loader is not None:
            return self._custom_model_loader()
        return BayesianWeibullIC.load_artifact(self.model_artifact_path, expected_sha256=self.expected_model_sha256)

    def _run_recoverable(self, session_id: str, op_name: str, fn: Callable[[], Any]):
        if self.blocking_retry:
            return self.recovery.execute_with_retry(op_name, fn)
        return self.recovery.execute_nonblocking(session_id, op_name, fn)

    def _build_response(
        self,
        *,
        session_id: str,
        app_state: ApplicationState,
        model_status: str,
        domain_status: DomainStatus,
        failure_category: FailureCategory,
        elapsed_h: float | None,
        timestamp_valid: bool,
        sensor_connection: str,
        temp_c: float | None,
        humid_pct: float | None,
        median_h: float | None,
        pi80_low_h: float | None,
        pi80_high_h: float | None,
        recovery_status: RecoveryStatus,
        last_calculated_at: str | None,
        research_display_eligible: bool,
        previous_valid_estimate: dict[str, Any] | None = None,
        uncertainty_diagnostics: dict[str, Any] | None = None,
        error_detail: str | None = None,
    ) -> dict[str, Any]:
        # Invariant: operational_prediction_authorized is ALWAYS False for unvalidated artifacts
        diag = uncertainty_diagnostics or {
            "evaluated": False,
            "uncertainty_status": "NOT_EVALUATED",
            "pi80_width_hours": None,
            "max_pi80_width_provisional_h": self.max_pi80_width_provisional_h,
            "exceeds_threshold": False,
            "secondary_statuses": [],
        }
        return {
            "session_id": session_id,
            "application_state": app_state.value,
            "model_status": model_status,
            "secondary_model_statuses": list(diag.get("secondary_statuses", [])),
            "uncertainty_diagnostics": diag,
            "domain_status": domain_status.value,
            "failure_category": failure_category.value,
            "research_estimate_display_enabled": self.research_estimate_display_enabled,
            "research_display_eligible": research_display_eligible,
            "operational_prediction_authorized": False,
            "estimate": {
                "median_rsl_hours": None if median_h is None else round(float(median_h), 4),
                "pi80_lower_hours": None if pi80_low_h is None else round(float(pi80_low_h), 4),
                "pi80_upper_hours": None if pi80_high_h is None else round(float(pi80_high_h), 4),
            },
            "monitoring": {
                "elapsed_hours": None if elapsed_h is None else round(float(elapsed_h), 6),
                "timestamp_valid": bool(timestamp_valid),
                "sensor_connection": sensor_connection,
                "temp_c": temp_c,
                "humid_pct": humid_pct,
            },
            "recovery": {
                "retry_active": recovery_status.retry_active,
                "attempt_count": recovery_status.attempt_count,
                "exhausted": recovery_status.exhausted,
                "next_retry_at": recovery_status.next_retry_at,
                "attempt_log": recovery_status.attempt_log,
            },
            "last_calculated_at": last_calculated_at,
            "model_artifact_id": f"{self.model_artifact_path.name}:{self.expected_model_sha256[:12]}",
            "previous_valid_estimate": previous_valid_estimate,
            "error_detail": error_detail,
        }

    def estimate_for_session(
        self,
        *,
        session_id: str,
        session_data: Mapping[str, Any] | None = None,
        force: bool = False,
    ) -> dict[str, Any]:
        """Run one guarded orchestration cycle for session_id."""
        now_dt = self.now_fn()
        with self.recovery.acquire_session_slot(session_id):
            prev_app_state = self._last_state_by_session.get(session_id)

            # Step 1: Retrieve session (supporting retryable DB/API fetcher)
            if session_data is None:
                if self._custom_session_fetcher is None:
                    raise InputTimestampError(f"No session_data or session_fetcher provided for {session_id!r}.")
                fetched, rec_fetch, exc_fetch = self._run_recoverable(
                    session_id, "fetch_session", lambda: self._custom_session_fetcher(session_id)  # type: ignore[misc]
                )
                if exc_fetch is not None or fetched is None:
                    is_trans = isinstance(exc_fetch, (TransientDependencyError, TimeoutError, ConnectionError))
                    app_st = (
                        (ApplicationState.RETRYING if rec_fetch.retry_active else ApplicationState.TEMPORARILY_UNAVAILABLE)
                        if is_trans
                        else ApplicationState.PROCESSING_FAILED
                    )
                    self._last_state_by_session[session_id] = app_st
                    self.scheduler.record_attempt(session_id, now_dt, app_st, {"attempt_count": rec_fetch.attempt_count})
                    return self._build_response(
                        session_id=session_id,
                        app_state=app_st,
                        model_status=FailClosedStateV21.MODEL_FAILURE.value,
                        domain_status=DomainStatus.INVALID_ELAPSED_TIME,
                        failure_category=FailureCategory.RECOVERABLE_INFRA if is_trans else FailureCategory.MODEL_FAILURE,
                        elapsed_h=None,
                        timestamp_valid=False,
                        sensor_connection="UNKNOWN",
                        temp_c=None,
                        humid_pct=None,
                        median_h=None,
                        pi80_low_h=None,
                        pi80_high_h=None,
                        recovery_status=rec_fetch,
                        last_calculated_at=None,
                        research_display_eligible=False,
                        previous_valid_estimate=self.scheduler.get_last_valid(session_id, now_dt),
                        error_detail=str(exc_fetch),
                    )
                sdata = fetched
            else:
                rec_fetch = RecoveryStatus()
                sdata = session_data

            sensor_conn = "CONNECTED" if bool(sdata.get("esp32_connected", True)) else "DISCONNECTED"
            temp_c = sdata.get("temp_c")
            humid_pct = sdata.get("humid_pct")

            # Step 2: Validate timestamps & session identity strictly
            try:
                if sdata.get("session_id") not in (None, session_id):
                    raise InputTimestampError(f"Session ID mismatch: {sdata.get('session_id')!r} != {session_id!r}.")
                t_start = _parse_iso_dt(sdata.get("monitoring_start_at"), "monitoring_start_at")
                t_curr_raw = sdata.get("current_timestamp")
                t_curr = _parse_iso_dt(t_curr_raw, "current_timestamp") if t_curr_raw is not None else now_dt
                elapsed_h = (t_curr - t_start).total_seconds() / 3600.0
                if elapsed_h < -1e-9:
                    raise InputTimestampError(
                        f"Non-monotonic timestamp: current {t_curr.isoformat()} < start {t_start.isoformat()}."
                    )
                prev_ts = self._last_valid_ts_by_session.get(session_id)
                if prev_ts is not None and t_curr < prev_ts:
                    raise InputTimestampError(
                        f"Non-monotonic timestamp regression: {t_curr.isoformat()} < {prev_ts.isoformat()}."
                    )
                self._last_valid_ts_by_session[session_id] = t_curr
            except InputTimestampError as exc:
                self._last_state_by_session[session_id] = ApplicationState.ACTION_REQUIRED
                self.scheduler.record_attempt(session_id, now_dt, ApplicationState.ACTION_REQUIRED)
                return self._build_response(
                    session_id=session_id,
                    app_state=ApplicationState.ACTION_REQUIRED,
                    model_status=FailClosedStateV21.TIME_ORIGIN_UNVERIFIED.value,
                    domain_status=DomainStatus.INVALID_ELAPSED_TIME,
                    failure_category=FailureCategory.INPUT_TIMESTAMP,
                    elapsed_h=None,
                    timestamp_valid=False,
                    sensor_connection=sensor_conn,
                    temp_c=temp_c,
                    humid_pct=humid_pct,
                    median_h=None,
                    pi80_low_h=None,
                    pi80_high_h=None,
                    recovery_status=rec_fetch,
                    last_calculated_at=None,
                    research_display_eligible=False,
                    previous_valid_estimate=self.scheduler.get_last_valid(session_id, now_dt),
                    error_detail=str(exc),
                )

            # Workstream A: Explicit Domain Enforcement BEFORE model_status presentation
            dom_status = evaluate_domain_status(elapsed_h, self.max_validation_domain_h)
            if dom_status in (DomainStatus.BEYOND_DOMAIN, DomainStatus.UNKNOWN_DOMAIN, DomainStatus.INVALID_ELAPSED_TIME):
                m_st = (
                    FailClosedStateV21.OUT_OF_VALIDATION_DOMAIN.value
                    if dom_status == DomainStatus.BEYOND_DOMAIN
                    else FailClosedStateV21.TIME_ORIGIN_UNVERIFIED.value
                    if dom_status == DomainStatus.INVALID_ELAPSED_TIME
                    else FailClosedStateV21.INSUFFICIENT_EVIDENCE.value
                )
                self._last_state_by_session[session_id] = ApplicationState.PROCESSING_FAILED
                self.scheduler.record_attempt(session_id, now_dt, ApplicationState.PROCESSING_FAILED)
                logger.info("Domain enforcement blocked %s at elapsed=%.4fh (%s)", session_id, elapsed_h, dom_status.value)
                return self._build_response(
                    session_id=session_id,
                    app_state=ApplicationState.PROCESSING_FAILED,
                    model_status=m_st,
                    domain_status=dom_status,
                    failure_category=FailureCategory.OUT_OF_DOMAIN,
                    elapsed_h=elapsed_h,
                    timestamp_valid=True,
                    sensor_connection=sensor_conn,
                    temp_c=temp_c,
                    humid_pct=humid_pct,
                    median_h=None,
                    pi80_low_h=None,
                    pi80_high_h=None,
                    recovery_status=rec_fetch,
                    last_calculated_at=now_dt.isoformat(),
                    research_display_eligible=False,
                    previous_valid_estimate=self.scheduler.get_last_valid(session_id, now_dt),
                    error_detail=f"Elapsed {elapsed_h:.4f}h outside validation domain ({dom_status.value}).",
                )

            # Step 3: Recalculation scheduler check
            sched = self.scheduler.evaluate_trigger(
                session_id=session_id,
                current_elapsed_h=elapsed_h,
                now_dt=now_dt,
                previous_app_state=prev_app_state,
                dependency_recovered=(prev_app_state in (ApplicationState.TEMPORARILY_UNAVAILABLE, ApplicationState.RETRYING)),
                force=force,
            )
            if not sched.should_recalculate:
                cached = self.scheduler.get_last_valid(session_id, now_dt)
                if cached is not None:
                    cached["monitoring"]["sensor_connection"] = sensor_conn
                    cached["monitoring"]["temp_c"] = temp_c
                    cached["monitoring"]["humid_pct"] = humid_pct
                    return cached

            # Step 4: Load V2.1 model with bounded retry
            model, rec_mod, exc_mod = self._run_recoverable(session_id, "load_and_compute_model", self._load_frozen_v21_model)
            rec_mod.attempt_log = rec_fetch.attempt_log + rec_mod.attempt_log
            rec_mod.attempt_count = max(rec_fetch.attempt_count, rec_mod.attempt_count)

            if exc_mod is not None or model is None:
                is_transient = isinstance(exc_mod, (TransientDependencyError, TimeoutError, ConnectionError))
                app_st = (
                    (ApplicationState.RETRYING if rec_mod.retry_active else ApplicationState.TEMPORARILY_UNAVAILABLE)
                    if is_transient
                    else ApplicationState.PROCESSING_FAILED
                )
                self._last_state_by_session[session_id] = app_st
                self.scheduler.record_attempt(session_id, now_dt, app_st, {"attempt_count": rec_mod.attempt_count})
                return self._build_response(
                    session_id=session_id,
                    app_state=app_st,
                    model_status=FailClosedStateV21.MODEL_FAILURE.value,
                    domain_status=dom_status,
                    failure_category=FailureCategory.RECOVERABLE_INFRA if is_transient else FailureCategory.MODEL_FAILURE,
                    elapsed_h=elapsed_h,
                    timestamp_valid=True,
                    sensor_connection=sensor_conn,
                    temp_c=temp_c,
                    humid_pct=humid_pct,
                    median_h=None,
                    pi80_low_h=None,
                    pi80_high_h=None,
                    recovery_status=rec_mod,
                    last_calculated_at=None,
                    research_display_eligible=False,
                    previous_valid_estimate=self.scheduler.get_last_valid(session_id, now_dt),
                    error_detail=str(exc_mod),
                )

            # Step 5: Invoke frozen V2.1 conditional survival + fail-closed contract
            try:
                qs = model.conditional_rsl_quantiles(elapsed_h)
                fc = evaluate_fail_closed_contract_v21(
                    elapsed_h=elapsed_h,
                    model_integrity_ok=True,
                    clock_monotonic_ok=True,
                    time_origin_verified=True,
                    model_externally_validated=bool(model.externally_validated_),
                    q90_survival_h=qs["q90_survival_h"],
                    median_rsl_h=qs["median_rsl_h"],
                    q10_survival_h=qs["q10_survival_h"],
                    max_validation_domain_h=float(self.max_validation_domain_h),
                    max_pi80_width_provisional_h=self.max_pi80_width_provisional_h,
                )
            except Exception as exc:  # noqa: BLE001
                self._last_state_by_session[session_id] = ApplicationState.PROCESSING_FAILED
                return self._build_response(
                    session_id=session_id,
                    app_state=ApplicationState.PROCESSING_FAILED,
                    model_status=FailClosedStateV21.MODEL_FAILURE.value,
                    domain_status=dom_status,
                    failure_category=FailureCategory.MODEL_FAILURE,
                    elapsed_h=elapsed_h,
                    timestamp_valid=True,
                    sensor_connection=sensor_conn,
                    temp_c=temp_c,
                    humid_pct=humid_pct,
                    median_h=None,
                    pi80_low_h=None,
                    pi80_high_h=None,
                    recovery_status=rec_mod,
                    last_calculated_at=None,
                    research_display_eligible=False,
                    previous_valid_estimate=self.scheduler.get_last_valid(session_id, now_dt),
                    error_detail=str(exc),
                )

            m_status = str(fc["runtime_state"])
            calc_iso = now_dt.isoformat()

            # Workstream B: Independently evaluate PI80 uncertainty even when MODEL_NOT_VALIDATED returns early
            q90_h = qs.get("q90_survival_h")
            q10_h = qs.get("q10_survival_h")
            pi80_width_h = (
                float(q10_h) - float(q90_h)
                if (q90_h is not None and q10_h is not None)
                else None
            )
            uncertainty_exceeded = pi80_width_h is None or pi80_width_h > self.max_pi80_width_provisional_h
            secondary_statuses = (
                [FailClosedStateV21.HIGH_UNCERTAINTY.value]
                if (m_status == FailClosedStateV21.MODEL_NOT_VALIDATED.value and uncertainty_exceeded)
                else []
            )
            uncertainty_diag = {
                "evaluated": True,
                "uncertainty_status": (
                    FailClosedStateV21.HIGH_UNCERTAINTY.value if uncertainty_exceeded else "WITHIN_THRESHOLD"
                ),
                "pi80_width_hours": None if pi80_width_h is None else round(pi80_width_h, 4),
                "max_pi80_width_provisional_h": self.max_pi80_width_provisional_h,
                "exceeds_threshold": bool(uncertainty_exceeded),
                "secondary_statuses": secondary_statuses,
            }

            if m_status == FailClosedStateV21.INSUFFICIENT_EVIDENCE.value:
                app_st = ApplicationState.WAITING_FOR_DATA
                fail_cat = FailureCategory.INSUFFICIENT_EVIDENCE
                med_out, lo_out, hi_out = None, None, None
                disp_elig = False
            elif m_status == FailClosedStateV21.HIGH_UNCERTAINTY.value:
                app_st = ApplicationState.ESTIMATE_AVAILABLE if self.research_estimate_display_enabled else ApplicationState.PROCESSING_FAILED
                fail_cat = FailureCategory.HIGH_UNCERTAINTY
                med_out, lo_out, hi_out = qs["median_rsl_h"], qs["q90_survival_h"], qs["q10_survival_h"]
                disp_elig = self.research_estimate_display_enabled
            elif m_status == FailClosedStateV21.MODEL_NOT_VALIDATED.value:
                app_st = ApplicationState.ESTIMATE_AVAILABLE if self.research_estimate_display_enabled else ApplicationState.ACTION_REQUIRED
                fail_cat = FailureCategory.NONE
                med_out = qs["median_rsl_h"] if self.research_estimate_display_enabled else None
                lo_out = qs["q90_survival_h"] if self.research_estimate_display_enabled else None
                hi_out = qs["q10_survival_h"] if self.research_estimate_display_enabled else None
                disp_elig = self.research_estimate_display_enabled
            else:
                app_st = ApplicationState.ESTIMATE_AVAILABLE
                fail_cat = FailureCategory.NONE
                med_out, lo_out, hi_out = qs["median_rsl_h"], qs["q90_survival_h"], qs["q10_survival_h"]
                disp_elig = True

            self._last_state_by_session[session_id] = app_st
            resp = self._build_response(
                session_id=session_id,
                app_state=app_st,
                model_status=m_status,
                domain_status=dom_status,
                failure_category=fail_cat,
                elapsed_h=elapsed_h,
                timestamp_valid=True,
                sensor_connection=sensor_conn,
                temp_c=temp_c,
                humid_pct=humid_pct,
                median_h=med_out,
                pi80_low_h=lo_out,
                pi80_high_h=hi_out,
                recovery_status=rec_mod,
                last_calculated_at=calc_iso,
                research_display_eligible=disp_elig,
                uncertainty_diagnostics=uncertainty_diag,
            )
            if med_out is not None and disp_elig:
                self.scheduler.record_success(session_id, elapsed_h, now_dt, resp)
            return resp


__all__ = ["RSLOrchestrator", "evaluate_domain_status"]
