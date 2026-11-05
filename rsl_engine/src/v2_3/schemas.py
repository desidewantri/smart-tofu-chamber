"""Response schema for the v2.3 conditional RSL API surface (not wired to production)."""

from __future__ import annotations

from typing import Any

from .conditional_rsl import CAVEATS, ELAPSED_ORIGIN, TVOC_CONTRIBUTION

STATUSES = ["OK", "OUTSIDE_SUPPORT", "SAMPLE_REPORTED_SPOILED", "UNSUPPORTED_CONDITION"]

RSL_RESPONSE_SCHEMA: dict[str, Any] = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "title": "TofuSense v2.3 conditional RSL response",
    "type": "object",
    "additionalProperties": True,
    "required": ["elapsed_h", "elapsed_origin", "storage_condition", "sample_status",
                 "method", "status", "range_interpretation", "tvoc_contribution", "caveats"],
    "properties": {
        "elapsed_h": {"type": "number", "minimum": 0},
        "elapsed_origin": {"const": ELAPSED_ORIGIN},
        "storage_condition": {"type": "string"},
        "sample_status": {"enum": ["NOT_SPOILED", "SAMPLE_REPORTED_SPOILED"]},
        "method": {"enum": ["M1_EMPIRICAL_ENVELOPE"]},
        "rsl_low_h": {"type": ["number", "null"], "minimum": 0},
        "rsl_high_h": {"type": ["number", "null"], "minimum": 0},
        "status": {"enum": STATUSES},
        "range_interpretation": {
            "enum": ["EMPIRICAL_INTERVAL_ENVELOPE",
                     "NO_RANGE_OUTSIDE_SUPPORT",
                     "NO_RANGE_SAMPLE_REPORTED_SPOILED",
                     "NO_RANGE_UNSUPPORTED_CONDITION"]},
        "n_reference_sessions": {"type": "integer", "minimum": 0},
        "n_at_risk_sessions": {"type": "integer", "minimum": 0},
        "m1b_risk_set_low_h": {"type": ["number", "null"], "minimum": 0},
        "m1b_risk_set_high_h": {"type": ["number", "null"], "minimum": 0},
        "m2_support_components": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["rsl_low_h", "rsl_high_h"],
                "properties": {
                    "rsl_low_h": {"type": "number", "minimum": 0},
                    "rsl_high_h": {"type": "number", "minimum": 0},
                    "mass": {"type": ["number", "null"], "minimum": 0, "maximum": 1},
                },
            },
        },
        "m3_comparator": {"type": ["object", "null"]},
        "tvoc_contribution": {"const": TVOC_CONTRIBUTION},
        "caveats": {"type": "array", "items": {"type": "string"}, "minItems": len(CAVEATS)},
        "note": {"type": "string"},
    },
    "if": {"properties": {"status": {"const": "OK"}}},
    "then": {"required": ["rsl_low_h", "rsl_high_h", "m2_support_components"]},
}

M1_LABEL = ("EMPIRICAL INTERVAL ENVELOPE - NOT A PROBABILISTIC PREDICTION "
            "INTERVAL OR CONFIDENCE INTERVAL.")


def validate_response(response: dict[str, Any]) -> None:
    """Minimal structural validation without a JSON-schema dependency."""
    for field in ("elapsed_h", "elapsed_origin", "storage_condition", "sample_status",
                  "method", "status", "range_interpretation", "tvoc_contribution", "caveats"):
        if field not in response:
            raise ValueError(f"missing field: {field}")
    if response["elapsed_origin"] != ELAPSED_ORIGIN:
        raise ValueError("elapsed_origin must be FIRST_SENSOR_TIMESTAMP")
    if response["status"] not in STATUSES:
        raise ValueError(f"unknown status: {response['status']}")
    if response["tvoc_contribution"] != TVOC_CONTRIBUTION:
        raise ValueError("tvoc_contribution must be NOT_ESTABLISHED")
    if response["status"] == "OK":
        if response["rsl_low_h"] is None or response["rsl_high_h"] is None:
            raise ValueError("OK responses require both bounds")
        if response["rsl_low_h"] > response["rsl_high_h"]:
            raise ValueError("rsl_low_h must not exceed rsl_high_h")
        for component in response["m2_support_components"]:
            if component["rsl_low_h"] > component["rsl_high_h"]:
                raise ValueError("M2 component with low > high")
    else:
        if response["rsl_low_h"] is not None or response["rsl_high_h"] is not None:
            raise ValueError("non-OK responses must not carry a range")
