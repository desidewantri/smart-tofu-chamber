"""Pure request/response logic for the internal RSL HTTP service.

The service is deliberately thin: it validates transport-level input, maps the
operator status vocabulary to the canonical engine vocabulary, and returns the
canonical engine response. It never fits, trains, or reads sensor values.
"""

from __future__ import annotations

import math
import os
from datetime import datetime, timezone
from typing import Any

from tofusense_rsl import __version__ as ENGINE_VERSION
from tofusense_rsl import default_reference, estimate_rsl
from tofusense_rsl.engine import RSLInputError

REFERENCE_VERSION = "v2.3-frozen-2026-11-04"
OPERATOR_TO_ENGINE_STATUS = {
    "NOT_SPOILED": "NOT_SPOILED",
    "SPOILED": "SAMPLE_REPORTED_SPOILED",
    "SAMPLE_REPORTED_SPOILED": "SAMPLE_REPORTED_SPOILED",
}
SUPPORTED_STORAGE = ("DRY", "WATER", "AMBIENT", "UNKNOWN")


class RequestError(ValueError):
    """A client-visible validation error with a stable code."""

    def __init__(self, message: str, code: str = "INVALID_REQUEST"):
        super().__init__(message)
        self.code = code


def _metadata() -> dict[str, Any]:
    reference = default_reference()
    return {
        "engineVersion": ENGINE_VERSION,
        "referenceVersion": REFERENCE_VERSION,
        "referencePopulation": reference.n_reference_sessions,
        "referenceStorageCondition": "DRY",
        "elapsedOrigin": "EXPERIMENT_STARTED_AT",
        "researchStatus": reference.research_status,
        "tvocContribution": "NOT_ESTABLISHED",
    }


def health_payload() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "tofusense-rsl",
        "engineVersion": ENGINE_VERSION,
        "referenceVersion": REFERENCE_VERSION,
        "referencePopulation": 3,
        "referenceStorageCondition": "DRY",
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


def version_payload() -> dict[str, Any]:
    return {
        "service": "tofusense-rsl",
        "engineVersion": ENGINE_VERSION,
        "referenceVersion": REFERENCE_VERSION,
        "metadata": _metadata(),
    }


def estimate_payload(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise RequestError("body must be a JSON object")
    elapsed = body.get("elapsedHours")
    if elapsed is None:
        elapsed = body.get("elapsed_h")
    try:
        elapsed_value = float(elapsed)
    except (TypeError, ValueError) as exc:
        raise RequestError("elapsedHours must be numeric", "INVALID_ELAPSED_TIME") from exc
    if not math.isfinite(elapsed_value):
        raise RequestError("elapsedHours must be finite", "INVALID_ELAPSED_TIME")

    raw_status = body.get("sampleStatus", body.get("sample_status"))
    if raw_status not in OPERATOR_TO_ENGINE_STATUS:
        raise RequestError(
            "sampleStatus must be NOT_SPOILED or SPOILED", "INVALID_SAMPLE_STATUS"
        )
    status = OPERATOR_TO_ENGINE_STATUS[raw_status]

    condition = body.get("storageCondition", body.get("storage_condition", "UNKNOWN"))
    if not isinstance(condition, str) or condition not in SUPPORTED_STORAGE:
        raise RequestError(
            "storageCondition must be DRY, WATER, AMBIENT, or UNKNOWN",
            "INVALID_STORAGE_CONDITION",
        )

    try:
        result = estimate_rsl(
            elapsed_value, sample_status=status, storage_condition=condition
        )
    except RSLInputError as exc:
        raise RequestError(str(exc), "INVALID_INPUT") from exc

    return {
        "success": True,
        "data": result,
        "metadata": _metadata(),
    }
