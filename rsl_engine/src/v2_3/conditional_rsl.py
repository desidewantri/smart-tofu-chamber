"""T3: conditional RSL calculators.

Three methods, deliberately different in meaning:

M1  EMPIRICAL_INTERVAL_ENVELOPE (displayed). Lower bound uses the smallest
    reference L over all sessions and is therefore conservative and monotone;
    upper bound uses the largest remaining U among sessions still at risk.
M1b risk-set variant (secondary). Lower bound uses only at-risk sessions. It is
    non-monotone and its rise between 24.63 h and 26.19 h is caused solely by S5
    leaving the risk set; it is not a safety margin.
M2  TURNBULL_NPMLE_CONDITIONAL_SUPPORT. Disconnected components preserved.
M3  WEIBULL_A0_PARAMETRIC_COMPARATOR. Conditional 10th/90th percentiles.

None of these is a probabilistic prediction interval or a food-safety threshold.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Sequence

import numpy as np

from .turnbull import TurnbullResult, conditional_support, reference_intervals, turnbull
from .weibull_comparator import WeibullComparator

ELAPSED_ORIGIN = "FIRST_SENSOR_TIMESTAMP"
TVOC_CONTRIBUTION = "NOT_ESTABLISHED"
VALID_STATUSES = ("NOT_SPOILED", "SAMPLE_REPORTED_SPOILED")
VALID_CONDITIONS = ("DRY",)
OUTSIDE_SUPPORT = "OUTSIDE_SUPPORT"

CAVEATS = [
    "POST_HOC_EXPLORATORY",
    "DESCRIPTIVE",
    "THREE_INFORMATIVE_DRY_ENDPOINTS",
    "BATCH_INDEPENDENCE_UNVERIFIED",
    "TIME_ORIGIN_IS_FIRST_SENSOR_TIMESTAMP",
    "NOT_A_PROBABILISTIC_PREDICTION_INTERVAL",
    "TVOC_CONTRIBUTION_NOT_ESTABLISHED",
]


class RSLInputError(ValueError):
    """Raised for invalid elapsed time or status inputs."""


@dataclass
class ReferenceSet:
    intervals: list[tuple[float, float]]
    turnbull: TurnbullResult
    weibull: WeibullComparator

    @property
    def min_lower(self) -> float:
        return min(lower for lower, _ in self.intervals)


def build_reference(exact_intervals: Sequence[tuple[float, float]] | None = None) -> ReferenceSet:
    intervals = reference_intervals(exact_intervals)
    return ReferenceSet(intervals=intervals, turnbull=turnbull(intervals),
                        weibull=WeibullComparator().fit(intervals))


def _validate(elapsed_h: float, sample_status: str, storage_condition: str) -> float:
    try:
        value = float(elapsed_h)
    except (TypeError, ValueError) as exc:
        raise RSLInputError(f"elapsed_h must be numeric, got {elapsed_h!r}") from exc
    if not np.isfinite(value):
        raise RSLInputError("elapsed_h must be finite")
    if value < 0:
        raise RSLInputError("elapsed_h must not be negative")
    if sample_status not in VALID_STATUSES:
        raise RSLInputError(f"sample_status must be one of {VALID_STATUSES}")
    if not isinstance(storage_condition, str) or not storage_condition:
        raise RSLInputError("storage_condition must be a non-empty string")
    return value


def empirical_envelope(intervals: Sequence[tuple[float, float]], elapsed_h: float) -> dict[str, Any]:
    """M1: conservative empirical interval envelope.

    The lower bound is the smallest reference L over *all* reference sessions,
    clamped at zero, so it is monotone and conservative. The upper bound is the
    largest remaining U among sessions still at risk under the strict condition
    ``U_i > elapsed_h``. Endpoints are used at full precision; rounding is a
    presentation concern only.
    """
    intervals = [(float(lower), float(upper)) for lower, upper in intervals]
    if not intervals:
        raise RSLInputError("at least one reference interval is required")
    reference_lower = min(lower for lower, _ in intervals)
    at_risk = [(lower, upper) for lower, upper in intervals if upper > float(elapsed_h)]
    if not at_risk:
        return {"status": OUTSIDE_SUPPORT, "lower_h": None, "upper_h": None,
                "risk_set_lower_h": None, "n_reference_sessions": len(intervals),
                "n_at_risk_sessions": 0}
    return {
        "status": "OK",
        "lower_h": max(reference_lower - float(elapsed_h), 0.0),
        "upper_h": max(upper - float(elapsed_h) for _, upper in at_risk),
        "risk_set_lower_h": min(max(lower - float(elapsed_h), 0.0) for lower, _ in at_risk),
        "n_reference_sessions": len(intervals),
        "n_at_risk_sessions": len(at_risk),
    }


def estimate_rsl(elapsed_h: float, sample_status: str = "NOT_SPOILED",
                 storage_condition: str = "DRY",
                 reference: ReferenceSet | None = None) -> dict[str, Any]:
    value = _validate(elapsed_h, sample_status, storage_condition)
    base = {
        "elapsed_h": value,
        "elapsed_origin": ELAPSED_ORIGIN,
        "storage_condition": storage_condition,
        "sample_status": sample_status,
        "tvoc_contribution": TVOC_CONTRIBUTION,
        "caveats": list(CAVEATS),
    }
    if sample_status == "SAMPLE_REPORTED_SPOILED":
        return {**base, "method": "M1_EMPIRICAL_ENVELOPE", "status": "SAMPLE_REPORTED_SPOILED",
                "rsl_low_h": None, "rsl_high_h": None,
                "range_interpretation": "NO_RANGE_SAMPLE_REPORTED_SPOILED",
                "n_reference_sessions": 0, "n_at_risk_sessions": 0,
                "m2_support_components": [], "m3_comparator": None,
                "note": "a sample reported spoiled has no remaining shelf life estimate"}
    if storage_condition not in VALID_CONDITIONS:
        return {**base, "method": "M1_EMPIRICAL_ENVELOPE", "status": "UNSUPPORTED_CONDITION",
                "rsl_low_h": None, "rsl_high_h": None,
                "range_interpretation": "NO_RANGE_UNSUPPORTED_CONDITION",
                "n_reference_sessions": 0, "n_at_risk_sessions": 0,
                "m2_support_components": [], "m3_comparator": None,
                "note": "only DRY-storage reference intervals are registered; water sessions are never substituted"}

    reference = reference or build_reference()
    envelope = empirical_envelope(reference.intervals, value)
    if envelope["status"] == OUTSIDE_SUPPORT:
        return {**base, "method": "M1_EMPIRICAL_ENVELOPE", "status": OUTSIDE_SUPPORT,
                "rsl_low_h": None, "rsl_high_h": None,
                "range_interpretation": "NO_RANGE_OUTSIDE_SUPPORT",
                "n_reference_sessions": envelope["n_reference_sessions"],
                "n_at_risk_sessions": 0,
                "m2_support_components": [], "m3_comparator": None,
                "note": "elapsed time is at or beyond every reference upper endpoint"}

    m1_low = envelope["lower_h"]
    m1_high = envelope["upper_h"]
    m1b_low = envelope["risk_set_lower_h"]
    n_at_risk = envelope["n_at_risk_sessions"]
    components = conditional_support(reference.turnbull.support, reference.turnbull.masses, value)
    m2_components = [{"rsl_low_h": component["rsl_low_h"],
                      "rsl_high_h": component["rsl_high_h"],
                      "mass": component["mass"]} for component in components]
    m3 = reference.weibull.conditional_quantiles(value)
    return {
        **base,
        "method": "M1_EMPIRICAL_ENVELOPE",
        "status": "OK",
        "rsl_low_h": m1_low,
        "rsl_high_h": m1_high,
        "range_interpretation": "EMPIRICAL_INTERVAL_ENVELOPE",
        "n_reference_sessions": len(reference.intervals),
        "n_at_risk_sessions": n_at_risk,
        "m1b_risk_set_low_h": m1b_low,
        "m1b_risk_set_high_h": m1_high,
        "m2_support_components": m2_components,
        "m3_comparator": m3,
        "note": ("empirical interval envelope; not a probabilistic prediction "
                 "interval or confidence interval"),
    }


def containment_check_lower_bound_non_increasing(times: Sequence[float]) -> dict:
    """M1's lower bound may never increase as elapsed time grows."""
    lows = []
    for t in times:
        at_risk = [(lower, upper) for lower, upper in reference_intervals() if upper > t]
        lows.append(max(min((lower for lower, _ in reference_intervals()), default=0.0) - t, 0.0)
                    if at_risk else None)
    defined = [(t, low) for t, low in zip(times, lows) if low is not None]
    monotone = all(defined[i][1] >= defined[i + 1][1] - 1e-12
                   for i in range(len(defined) - 1))
    return {"monotone_non_increasing": bool(monotone), "values": defined}
