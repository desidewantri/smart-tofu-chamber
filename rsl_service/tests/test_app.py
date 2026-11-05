import math

import pytest

from rsl_service.app import RequestError, estimate_payload, health_payload, version_payload


def test_health_and_version_metadata():
    h = health_payload()
    assert h["status"] == "ok"
    assert h["referencePopulation"] == 3
    assert h["referenceStorageCondition"] == "DRY"
    v = version_payload()
    assert v["engineVersion"] == "1.0.0"
    assert v["metadata"]["referenceVersion"].startswith("v2.3")


def test_valid_dry_estimate_returns_canonical_m1():
    r = estimate_payload(
        {"elapsedHours": 20, "sampleStatus": "NOT_SPOILED", "storageCondition": "DRY"}
    )
    data = r["data"]
    assert data["status"] == "OK"
    assert data["primary_rsl"]["lower_h"] == pytest.approx(3.068924444444445, abs=1e-12)
    assert data["primary_rsl"]["upper_h"] == pytest.approx(22.888799999999996, abs=1e-12)
    assert data["primary_method"] == "M1_EMPIRICAL_ENVELOPE"
    assert data["tvoc_contribution"] == "NOT_ESTABLISHED"


def test_spoiled_and_unsupported_are_explicit_and_have_no_range():
    spoiled = estimate_payload(
        {"elapsedHours": 20, "sampleStatus": "SPOILED", "storageCondition": "DRY"}
    )["data"]
    assert spoiled["status"] == "SAMPLE_REPORTED_SPOILED"
    assert spoiled["primary_rsl"]["lower_h"] is None
    water = estimate_payload(
        {"elapsedHours": 20, "sampleStatus": "NOT_SPOILED", "storageCondition": "WATER"}
    )["data"]
    assert water["status"] == "UNSUPPORTED_CONDITION"
    assert water["primary_rsl"]["lower_h"] is None
    assert water["n_reference_sessions"] == 0


def test_outside_support_has_no_range():
    r = estimate_payload(
        {"elapsedHours": 43, "sampleStatus": "NOT_SPOILED", "storageCondition": "DRY"}
    )["data"]
    assert r["status"] == "OUTSIDE_SUPPORT"
    assert r["primary_rsl"]["lower_h"] is None


@pytest.mark.parametrize(
    "body, code",
    [
        (None, "INVALID_REQUEST"),
        ({}, "INVALID_ELAPSED_TIME"),
        ({"elapsedHours": -1, "sampleStatus": "NOT_SPOILED", "storageCondition": "DRY"}, "INVALID_INPUT"),
        ({"elapsedHours": float("nan"), "sampleStatus": "NOT_SPOILED", "storageCondition": "DRY"}, "INVALID_ELAPSED_TIME"),
        ({"elapsedHours": 1, "sampleStatus": "MAYBE", "storageCondition": "DRY"}, "INVALID_SAMPLE_STATUS"),
        ({"elapsedHours": 1, "sampleStatus": "NOT_SPOILED", "storageCondition": "COLD"}, "INVALID_STORAGE_CONDITION"),
    ],
)
def test_invalid_requests_have_stable_codes(body, code):
    with pytest.raises(RequestError) as exc:
        estimate_payload(body)
    assert exc.value.code == code


def test_response_contains_no_nan():
    r = estimate_payload(
        {"elapsedHours": 24.63, "sampleStatus": "NOT_SPOILED", "storageCondition": "DRY"}
    )["data"]

    def walk(value):
        if isinstance(value, float):
            assert math.isfinite(value)
        elif isinstance(value, dict):
            for item in value.values():
                walk(item)
        elif isinstance(value, (list, tuple)):
            for item in value:
                walk(item)

    walk(r)
