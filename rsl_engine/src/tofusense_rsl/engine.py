"""Public orchestration for the TofuSense RSL Estimation Engine.

One entry point, three methods, no mixing into a single number. M1 is the
primary displayed range; M2 and M3 are supporting statistical results.
"""

from __future__ import annotations

import math
from functools import lru_cache

from .methods import conditional_support_at, estimate_m1, estimate_m3
from .reference_data import ReferenceData, load_reference_data
from .schemas import (
    CAVEATS,
    ELAPSED_ORIGIN,
    PRIMARY_METHOD,
    STATUS_OK,
    STATUS_OUTSIDE_SUPPORT,
    STATUS_SAMPLE_REPORTED_SPOILED,
    STATUS_UNSUPPORTED_CONDITION,
    TVOC_CONTRIBUTION,
)

VALID_SAMPLE_STATUSES = ("NOT_SPOILED", "SAMPLE_REPORTED_SPOILED")
SUPPORTED_STORAGE = ("DRY",)


class RSLInputError(ValueError):
    """Raised for invalid elapsed time or sample status."""


@lru_cache(maxsize=1)
def default_reference() -> ReferenceData:
    """Load the packaged reference data once per process."""
    return load_reference_data()


def _validate(elapsed_h: float, sample_status: str, storage_condition: str) -> float:
    try:
        value = float(elapsed_h)
    except (TypeError, ValueError) as exc:
        raise RSLInputError(f"elapsed_h must be numeric, got {elapsed_h!r}") from exc
    if not math.isfinite(value):
        raise RSLInputError("elapsed_h must be finite")
    if value < 0:
        raise RSLInputError("elapsed_h must not be negative")
    if sample_status not in VALID_SAMPLE_STATUSES:
        raise RSLInputError(f"sample_status must be one of {VALID_SAMPLE_STATUSES}")
    if not isinstance(storage_condition, str) or not storage_condition:
        raise RSLInputError("storage_condition must be a non-empty string")
    return value


def _terminal(status: str, mapping: dict, note: str) -> dict:
    return {
        "elapsed_h": mapping["elapsed_h"],
        "elapsed_origin": ELAPSED_ORIGIN,
        "storage_condition": mapping["storage_condition"],
        "sample_status": mapping["sample_status"],
        "primary_method": PRIMARY_METHOD,
        "primary_rsl": {"lower_h": None, "upper_h": None, "interpretation": note},
        "methods": {name: {"status": "NOT_APPLICABLE", "reason": note}
                    for name in ("M1", "M2", "M3")},
        "n_reference_sessions": 0,
        "n_at_risk_sessions": 0,
        "tvoc_contribution": TVOC_CONTRIBUTION,
        "status": status,
        "caveats": list(CAVEATS),
        "note": note,
    }


def estimate_rsl(elapsed_h: float, sample_status: str = "NOT_SPOILED",
                 storage_condition: str = "DRY",
                 reference: ReferenceData | None = None) -> dict:
    """Estimate conditional RSL for one sample at one elapsed monitoring time.

    Parameters
    ----------
    elapsed_h
        Hours since the first sensor timestamp of the monitoring session.
    sample_status
        ``NOT_SPOILED`` or ``SAMPLE_REPORTED_SPOILED``.
    storage_condition
        ``DRY`` is the only supported reference condition.
    reference
        Optional injected reference data (tests). Defaults to the packaged files.
    """
    value = _validate(elapsed_h, sample_status, storage_condition)
    base = {"elapsed_h": value, "storage_condition": storage_condition,
            "sample_status": sample_status}

    if sample_status == "SAMPLE_REPORTED_SPOILED":
        return _terminal(STATUS_SAMPLE_REPORTED_SPOILED, base,
                         "NO_RANGE_SAMPLE_REPORTED_SPOILED")
    if storage_condition not in SUPPORTED_STORAGE:
        return _terminal(STATUS_UNSUPPORTED_CONDITION, base,
                         "NO_RANGE_UNSUPPORTED_CONDITION")

    loaded = reference or default_reference()
    m1 = estimate_m1(value, loaded)
    if m1.status == STATUS_OUTSIDE_SUPPORT:
        response = _terminal(STATUS_OUTSIDE_SUPPORT, base, "NO_RANGE_OUTSIDE_SUPPORT")
        response["n_reference_sessions"] = m1.n_reference_sessions
        response["methods"]["M1"] = m1.to_dict()
        response["methods"]["M2"] = conditional_support_at(value, loaded).to_dict()
        response["methods"]["M3"] = estimate_m3(value, loaded).to_dict()
        return response

    m2 = conditional_support_at(value, loaded)
    m3 = estimate_m3(value, loaded)
    return {
        "elapsed_h": value,
        "elapsed_origin": ELAPSED_ORIGIN,
        "storage_condition": storage_condition,
        "sample_status": sample_status,
        "primary_method": PRIMARY_METHOD,
        "primary_rsl": {"lower_h": m1.lower_h, "upper_h": m1.upper_h,
                        "interpretation": m1.interpretation},
        "methods": {"M1": m1.to_dict(), "M2": m2.to_dict(), "M3": m3.to_dict()},
        "n_reference_sessions": m1.n_reference_sessions,
        "n_at_risk_sessions": m1.n_at_risk_sessions,
        "tvoc_contribution": TVOC_CONTRIBUTION,
        "status": STATUS_OK,
        "caveats": list(CAVEATS),
    }
