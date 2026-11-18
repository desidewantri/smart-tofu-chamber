"""Bounded Exponential Backoff Recovery Manager (Non-Blocking & Synchronous Modes + Concurrency Guard)."""

from __future__ import annotations

import logging
import threading
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Iterator, TypeVar

from .estimation_state import DuplicateEstimationJobError, TransientDependencyError

logger = logging.getLogger(__name__)
T = TypeVar("T")


@dataclass
class RecoveryConfig:
    """Configurable bounded retry policy."""

    max_retries: int = 3
    base_delay_s: float = 0.5
    backoff_factor: float = 2.0
    max_delay_s: float = 10.0


@dataclass
class RecoveryStatus:
    """Observable recovery attempt state surfaced in API payloads."""

    retry_active: bool = False
    attempt_count: int = 0
    exhausted: bool = False
    next_retry_at: str | None = None
    attempt_log: list[dict[str, Any]] = field(default_factory=list)


class RecoveryManager:
    """Executes recoverable operations with bounded exponential backoff, non-blocking state, and session locks."""

    def __init__(
        self,
        *,
        config: RecoveryConfig | None = None,
        sleep_fn: Callable[[float], None] = time.sleep,
        now_fn: Callable[[], datetime] | None = None,
    ) -> None:
        self.config = config or RecoveryConfig()
        self.sleep_fn = sleep_fn
        self.now_fn = now_fn or (lambda: datetime.now(timezone.utc))
        self._locks_guard = threading.Lock()
        self._session_locks: dict[str, threading.Lock] = {}
        self._retry_states: dict[str, RecoveryStatus] = {}
        self._shutdown_event = threading.Event()
        self._bg_threads: dict[str, threading.Thread] = {}

    def _get_session_lock(self, session_id: str) -> threading.Lock:
        with self._locks_guard:
            if session_id not in self._session_locks:
                self._session_locks[session_id] = threading.Lock()
            return self._session_locks[session_id]

    @contextmanager
    def acquire_session_slot(self, session_id: str) -> Iterator[None]:
        """Non-blocking per-session guard preventing duplicate concurrent estimation jobs."""
        lock = self._get_session_lock(session_id)
        acquired = lock.acquire(blocking=False)
        if not acquired:
            raise DuplicateEstimationJobError(
                f"Concurrent estimation job already running for session {session_id!r}."
            )
        try:
            yield
        finally:
            lock.release()

    def reset_session_retry_state(self, session_id: str) -> None:
        with self._locks_guard:
            self._retry_states.pop(session_id, None)

    def execute_nonblocking(
        self,
        session_id: str,
        op_name: str,
        fn: Callable[[], T],
    ) -> tuple[T | None, RecoveryStatus, Exception | None]:
        """Execute one attempt without blocking caller thread; schedule bounded next_retry_at on transient failure."""
        with self._locks_guard:
            prev = self._retry_states.get(session_id)
            status = (
                RecoveryStatus(
                    retry_active=prev.retry_active,
                    attempt_count=prev.attempt_count,
                    exhausted=prev.exhausted,
                    next_retry_at=prev.next_retry_at,
                    attempt_log=list(prev.attempt_log),
                )
                if prev is not None
                else RecoveryStatus()
            )

        max_attempts = 1 + max(int(self.config.max_retries), 0)
        if status.exhausted:
            return None, status, TransientDependencyError("Retry budget exhausted.")

        status.attempt_count += 1
        try:
            result = fn()
            status.retry_active = False
            status.exhausted = False
            status.next_retry_at = None
            status.attempt_log.append(
                {
                    "operation": op_name,
                    "attempt": status.attempt_count,
                    "outcome": "SUCCESS",
                    "timestamp": self.now_fn().isoformat(),
                }
            )
            with self._locks_guard:
                self._retry_states.pop(session_id, None)
            return result, status, None
        except (TransientDependencyError, TimeoutError, ConnectionError) as exc:
            is_last = status.attempt_count >= max_attempts
            delay_s = min(
                self.config.base_delay_s * (self.config.backoff_factor ** (status.attempt_count - 1)),
                self.config.max_delay_s,
            )
            next_at = None if is_last else (self.now_fn() + timedelta(seconds=delay_s)).isoformat()
            status.retry_active = not is_last
            status.exhausted = is_last
            status.next_retry_at = next_at
            status.attempt_log.append(
                {
                    "operation": op_name,
                    "attempt": status.attempt_count,
                    "outcome": "TRANSIENT_FAILURE",
                    "error_type": type(exc).__name__,
                    "error": str(exc),
                    "delay_s": 0.0 if is_last else delay_s,
                    "timestamp": self.now_fn().isoformat(),
                }
            )
            with self._locks_guard:
                self._retry_states[session_id] = status
            logger.warning(
                "Non-blocking transient failure (%s attempt %d/%d): %s",
                session_id,
                status.attempt_count,
                max_attempts,
                exc,
            )
            return None, status, exc
        except Exception as exc:  # noqa: BLE001
            status.retry_active = False
            status.exhausted = False
            status.next_retry_at = None
            status.attempt_log.append(
                {
                    "operation": op_name,
                    "attempt": status.attempt_count,
                    "outcome": "NON_RETRYABLE_FAILURE",
                    "error_type": type(exc).__name__,
                    "error": str(exc),
                    "timestamp": self.now_fn().isoformat(),
                }
            )
            with self._locks_guard:
                self._retry_states.pop(session_id, None)
            return None, status, exc

    def execute_with_retry(self, op_name: str, fn: Callable[[], T]) -> tuple[T | None, RecoveryStatus, Exception | None]:
        """Run fn() inline with bounded retries ONLY for transient recoverable errors."""
        status = RecoveryStatus()
        max_attempts = 1 + max(int(self.config.max_retries), 0)
        for attempt in range(1, max_attempts + 1):
            if self._shutdown_event.is_set():
                status.retry_active = False
                return None, status, TransientDependencyError("RecoveryManager shutdown requested.")
            status.attempt_count = attempt
            try:
                result = fn()
                status.retry_active = False
                status.next_retry_at = None
                status.attempt_log.append(
                    {
                        "operation": op_name,
                        "attempt": attempt,
                        "outcome": "SUCCESS",
                        "timestamp": self.now_fn().isoformat(),
                    }
                )
                return result, status, None
            except (TransientDependencyError, TimeoutError, ConnectionError) as exc:
                is_last = attempt >= max_attempts
                delay_s = min(
                    self.config.base_delay_s * (self.config.backoff_factor ** (attempt - 1)),
                    self.config.max_delay_s,
                )
                next_at = None if is_last else (self.now_fn() + timedelta(seconds=delay_s)).isoformat()
                status.retry_active = not is_last
                status.exhausted = is_last
                status.next_retry_at = next_at
                status.attempt_log.append(
                    {
                        "operation": op_name,
                        "attempt": attempt,
                        "outcome": "TRANSIENT_FAILURE",
                        "error_type": type(exc).__name__,
                        "error": str(exc),
                        "delay_s": 0.0 if is_last else delay_s,
                        "timestamp": self.now_fn().isoformat(),
                    }
                )
                if is_last:
                    return None, status, exc
                self.sleep_fn(delay_s)
            except Exception as exc:  # noqa: BLE001
                status.retry_active = False
                status.exhausted = False
                status.next_retry_at = None
                status.attempt_log.append(
                    {
                        "operation": op_name,
                        "attempt": attempt,
                        "outcome": "NON_RETRYABLE_FAILURE",
                        "error_type": type(exc).__name__,
                        "error": str(exc),
                        "timestamp": self.now_fn().isoformat(),
                    }
                )
                return None, status, exc
        return None, status, None

    def schedule_background_retry(self, session_id: str, callback: Callable[[], Any], delay_s: float = 0.01) -> bool:
        """Spawn a single daemon-safe background retry thread per session if not shutting down."""
        if self._shutdown_event.is_set():
            return False
        with self._locks_guard:
            existing = self._bg_threads.get(session_id)
            if existing is not None and existing.is_alive():
                return False

            def _worker() -> None:
                if not self._shutdown_event.wait(timeout=max(delay_s, 0.0)):
                    try:
                        callback()
                    except Exception as exc:  # noqa: BLE001
                        logger.warning("Background retry for %s failed: %s", session_id, exc)

            th = threading.Thread(target=_worker, name=f"rsl-retry-{session_id}", daemon=True)
            self._bg_threads[session_id] = th
            th.start()
            return True

    def shutdown(self, wait: bool = True, timeout: float = 2.0) -> None:
        """Signal any scheduled retries to cancel safely and join active workers."""
        self._shutdown_event.set()
        if wait:
            with self._locks_guard:
                threads = list(self._bg_threads.values())
            for th in threads:
                th.join(timeout=timeout)


__all__ = ["RecoveryConfig", "RecoveryManager", "RecoveryStatus"]
