"""Application-Layer Estimation States, Domain Statuses, Failure Taxonomy & Typed Exceptions."""

from __future__ import annotations

from enum import Enum


class ApplicationState(str, Enum):
    """Consumer-facing and orchestration-level lifecycle states."""

    INITIALIZING = "INITIALIZING"
    WAITING_FOR_DATA = "WAITING_FOR_DATA"
    PROCESSING = "PROCESSING"
    RETRYING = "RETRYING"
    ESTIMATE_AVAILABLE = "ESTIMATE_AVAILABLE"
    ACTION_REQUIRED = "ACTION_REQUIRED"
    TEMPORARILY_UNAVAILABLE = "TEMPORARILY_UNAVAILABLE"
    PROCESSING_FAILED = "PROCESSING_FAILED"


class DomainStatus(str, Enum):
    """Explicit validation-domain boundary classification (Workstream A)."""

    WITHIN_DOMAIN = "WITHIN_DOMAIN"
    AT_BOUNDARY = "AT_BOUNDARY"
    BEYOND_DOMAIN = "BEYOND_DOMAIN"
    UNKNOWN_DOMAIN = "UNKNOWN_DOMAIN"
    INVALID_ELAPSED_TIME = "INVALID_ELAPSED_TIME"


class FailureCategory(str, Enum):
    """Explicit failure classification separating transient infra from evidence/input limits."""

    NONE = "NONE"
    RECOVERABLE_INFRA = "RECOVERABLE_INFRA"
    INPUT_TIMESTAMP = "INPUT_TIMESTAMP"
    INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"
    OUT_OF_DOMAIN = "OUT_OF_DOMAIN"
    HIGH_UNCERTAINTY = "HIGH_UNCERTAINTY"
    MODEL_FAILURE = "MODEL_FAILURE"
    PERSISTENCE_FAILURE = "PERSISTENCE_FAILURE"


class TransientDependencyError(RuntimeError):
    """Recoverable API timeout, temporary DB outage, model-service timeout, or transport glitch."""


class InputTimestampError(ValueError):
    """Missing, malformed, or non-monotonic monitoring timestamp or session mismatch."""


class DuplicateEstimationJobError(RuntimeError):
    """Raised when a concurrent estimation job is already active for the same session."""


__all__ = [
    "ApplicationState",
    "DomainStatus",
    "DuplicateEstimationJobError",
    "FailureCategory",
    "InputTimestampError",
    "TransientDependencyError",
]
