"""Statuses, caveats and the public response schema for the RSL engine."""

from __future__ import annotations

from typing import Any

STATUS_OK = "OK"
STATUS_OUTSIDE_SUPPORT = "OUTSIDE_SUPPORT"
STATUS_SAMPLE_REPORTED_SPOILED = "SAMPLE_REPORTED_SPOILED"
STATUS_UNSUPPORTED_CONDITION = "UNSUPPORTED_CONDITION"
STATUSES = (STATUS_OK, STATUS_OUTSIDE_SUPPORT, STATUS_SAMPLE_REPORTED_SPOILED,
            STATUS_UNSUPPORTED_CONDITION)

ELAPSED_ORIGIN = "FIRST_SENSOR_TIMESTAMP"
TVOC_CONTRIBUTION = "NOT_ESTABLISHED"
PRIMARY_METHOD = "M1_EMPIRICAL_ENVELOPE"
M1_INTERPRETATION = "EMPIRICAL_INTERVAL_ENVELOPE"
M1_LABEL = ("EMPIRICAL INTERVAL ENVELOPE - NOT A PROBABILISTIC PREDICTION "
            "INTERVAL OR CONFIDENCE INTERVAL.")
M2_LABEL = "TURNBULL_NPMLE_CONDITIONAL_SUPPORT"
M2_ADVISORY = "ESTIMATOR_DEPENDENT - POTENTIALLY ANTI-CONSERVATIVE"
M3_LABEL = "WEIBULL_A0_PARAMETRIC_COMPARATOR"

CAVEATS = (
    "POST_HOC_EXPLORATORY",
    "DESCRIPTIVE",
    "THREE_INFORMATIVE_DRY_ENDPOINTS",
    "BATCH_INDEPENDENCE_UNVERIFIED",
    "TIME_ORIGIN_IS_FIRST_SENSOR_TIMESTAMP",
    "NOT_A_PROBABILISTIC_PREDICTION_INTERVAL",
    "TVOC_CONTRIBUTION_NOT_ESTABLISHED",
)

RESPONSE_JSON_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "TofuSense RSL Estimation Engine response",
    "type": "object",
    "required": ["elapsed_h", "elapsed_origin", "storage_condition", "sample_status",
                 "primary_method", "primary_rsl", "methods", "n_reference_sessions",
                 "n_at_risk_sessions", "tvoc_contribution", "status", "caveats"],
    "properties": {
        "elapsed_h": {"type": "number", "minimum": 0},
        "elapsed_origin": {"const": ELAPSED_ORIGIN},
        "storage_condition": {"type": "string"},
        "sample_status": {"enum": ["NOT_SPOILED", "SAMPLE_REPORTED_SPOILED"]},
        "primary_method": {"const": PRIMARY_METHOD},
        "primary_rsl": {
            "type": "object",
            "required": ["lower_h", "upper_h", "interpretation"],
            "properties": {
                "lower_h": {"type": ["number", "null"], "minimum": 0},
                "upper_h": {"type": ["number", "null"], "minimum": 0},
                "interpretation": {"type": "string"},
            },
        },
        "methods": {"type": "object"},
        "n_reference_sessions": {"type": "integer", "minimum": 0},
        "n_at_risk_sessions": {"type": "integer", "minimum": 0},
        "tvoc_contribution": {"const": TVOC_CONTRIBUTION},
        "status": {"enum": list(STATUSES)},
        "caveats": {"type": "array", "items": {"type": "string"}},
        "note": {"type": "string"},
    },
}
