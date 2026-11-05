"""Engine orchestration, input contract, reference validation and v2.3 parity."""

from __future__ import annotations

import json
import math
from pathlib import Path

import pytest

from tofusense_rsl import RSLInputError, default_reference, estimate_rsl, load_reference_data
from tofusense_rsl.reference_data import ReferenceDataError

GRID = (0, 6, 12, 18, 23, 24, 24.63, 26, 28, 30, 32, 35, 40, 43)


# ------------------------------------------------------------------ contract
def test_response_structure():
    response = estimate_rsl(20)
    assert set(response) >= {"elapsed_h", "elapsed_origin", "storage_condition",
                             "sample_status", "primary_method", "primary_rsl", "methods",
                             "n_reference_sessions", "n_at_risk_sessions",
                             "tvoc_contribution", "status", "caveats"}
    assert response["elapsed_origin"] == "FIRST_SENSOR_TIMESTAMP"
    assert response["primary_method"] == "M1_EMPIRICAL_ENVELOPE"
    assert response["tvoc_contribution"] == "NOT_ESTABLISHED"
    assert response["n_reference_sessions"] == 3
    assert set(response["methods"]) == {"M1", "M2", "M3"}
    assert response["primary_rsl"]["interpretation"] == "EMPIRICAL_INTERVAL_ENVELOPE"


def test_caveats_are_attached():
    caveats = set(estimate_rsl(10)["caveats"])
    assert {"POST_HOC_EXPLORATORY", "DESCRIPTIVE", "THREE_INFORMATIVE_DRY_ENDPOINTS",
            "BATCH_INDEPENDENCE_UNVERIFIED", "TIME_ORIGIN_IS_FIRST_SENSOR_TIMESTAMP",
            "NOT_A_PROBABILISTIC_PREDICTION_INTERVAL",
            "TVOC_CONTRIBUTION_NOT_ESTABLISHED"} <= caveats


def test_methods_are_not_averaged():
    response = estimate_rsl(24.63)
    m1 = (response["methods"]["M1"]["lower_h"], response["methods"]["M1"]["upper_h"])
    m2 = response["methods"]["M2"]["components"]
    m3 = (response["methods"]["M3"]["r10_h"], response["methods"]["M3"]["r90_h"])
    assert m1 != m3
    assert all(component["upper_h"] <= m1[1] for component in m2)


def test_statuses():
    assert estimate_rsl(20)["status"] == "OK"
    assert estimate_rsl(43)["status"] == "OUTSIDE_SUPPORT"
    assert estimate_rsl(20, sample_status="SAMPLE_REPORTED_SPOILED")["status"] == \
        "SAMPLE_REPORTED_SPOILED"
    assert estimate_rsl(20, storage_condition="WATER")["status"] == "UNSUPPORTED_CONDITION"


def test_spoiled_sample_has_no_range():
    response = estimate_rsl(20, sample_status="SAMPLE_REPORTED_SPOILED")
    assert response["primary_rsl"]["lower_h"] is None
    assert response["primary_rsl"]["upper_h"] is None


def test_unsupported_condition_has_no_range_and_no_substitution():
    response = estimate_rsl(20, storage_condition="AMBIENT")
    assert response["primary_rsl"]["lower_h"] is None
    assert response["n_reference_sessions"] == 0


@pytest.mark.parametrize("elapsed", [-1, -1e-9, float("nan"), float("inf")])
def test_invalid_elapsed_rejected(elapsed):
    with pytest.raises(RSLInputError):
        estimate_rsl(elapsed)


@pytest.mark.parametrize("status", ["MAYBE", "", None])
def test_invalid_status_rejected(status):
    with pytest.raises(RSLInputError):
        estimate_rsl(1, sample_status=status)


def test_invalid_condition_type_rejected():
    with pytest.raises(RSLInputError):
        estimate_rsl(1, storage_condition="")


# -------------------------------------------------------- reference loading
def test_reference_files_validate():
    reference = default_reference()
    assert reference.n_reference_sessions == 3
    assert reference.research_status == "POST_HOC_EXPLORATORY_DESCRIPTIVE"
    assert all(endpoint.lower_h < endpoint.upper_h for endpoint in reference.endpoints)


def test_missing_reference_file_is_an_error(tmp_path):
    with pytest.raises(ReferenceDataError):
        load_reference_data(tmp_path)


def test_invalid_masses_are_rejected(tmp_path):
    source = Path(__file__).resolve().parents[1] / "src" / "tofusense_rsl" / "reference"
    for name in ("dry_endpoints.json", "weibull_a0.json", "provenance.json"):
        (tmp_path / name).write_text((source / name).read_text(encoding="utf-8"), encoding="utf-8")
    payload = json.loads((source / "turnbull_npmle.json").read_text(encoding="utf-8"))
    payload["probability_masses"] = [0.5, 0.2]
    (tmp_path / "turnbull_npmle.json").write_text(json.dumps(payload), encoding="utf-8")
    with pytest.raises(ReferenceDataError):
        load_reference_data(tmp_path)


def test_water_sessions_are_not_in_the_dry_reference():
    sessions = {endpoint.session_id for endpoint in default_reference().endpoints}
    assert sessions == {"S3", "S4", "S5"}


# -------------------------------------------------------------------- parity
def test_parity_with_canonical_v2_3_across_the_grid():
    import sys
    from tofusense_rsl._canonical import CANONICAL_SOURCE

    if CANONICAL_SOURCE not in sys.path:
        sys.path.insert(0, CANONICAL_SOURCE)
    from v2_3.conditional_rsl import ReferenceSet, estimate_rsl as v23_estimate
    from v2_3.turnbull import turnbull
    from v2_3.weibull_comparator import WeibullComparator

    reference = default_reference()
    # The runtime never fits Weibull; use the frozen parameters in the parity
    # oracle so the test does not pull the offline v2 research fitter.
    canonical = ReferenceSet(
        intervals=list(reference.intervals),
        turnbull=turnbull(list(reference.intervals)),
        weibull=WeibullComparator(shape=reference.weibull_shape,
                                  scale=reference.weibull_scale),
    )
    for elapsed in GRID:
        expected = v23_estimate(elapsed, reference=canonical)
        actual = estimate_rsl(elapsed)
        assert actual["status"] == expected["status"], elapsed
        assert actual["n_at_risk_sessions"] == expected["n_at_risk_sessions"], elapsed
        if expected["status"] != "OK":
            assert actual["primary_rsl"]["lower_h"] is None
            continue
        assert actual["primary_rsl"]["lower_h"] == pytest.approx(expected["rsl_low_h"], abs=1e-12)
        assert actual["primary_rsl"]["upper_h"] == pytest.approx(expected["rsl_high_h"], abs=1e-12)
        expected_m2 = expected["m2_support_components"]
        actual_m2 = actual["methods"]["M2"]["components"]
        assert len(actual_m2) == len(expected_m2)
        for got, want in zip(actual_m2, expected_m2):
            assert got["lower_h"] == pytest.approx(want["rsl_low_h"], abs=1e-12)
            assert got["upper_h"] == pytest.approx(want["rsl_high_h"], abs=1e-12)
            assert got["mass"] == pytest.approx(want["mass"], abs=1e-12)
        expected_m3 = expected["m3_comparator"]
        actual_m3 = actual["methods"]["M3"]
        assert actual_m3["available"] == expected_m3.get("available")
        if expected_m3.get("available"):
            assert actual_m3["r10_h"] == pytest.approx(expected_m3["r10_h"], abs=1e-12)
            assert actual_m3["r90_h"] == pytest.approx(expected_m3["r90_h"], abs=1e-12)
            assert actual_m3["support_warning"] == expected_m3.get("support_warning")


def test_engine_is_deterministic():
    first = estimate_rsl(24.63)
    second = estimate_rsl(24.63)
    assert first == second


def test_elapsed_zero_is_documented_support_not_a_guarantee():
    response = estimate_rsl(0)
    assert response["primary_rsl"]["lower_h"] == pytest.approx(23.068924, abs=1e-6)
    assert "NOT A PROBABILISTIC" in response["methods"]["M1"]["label"]


def test_no_nan_in_response():
    def walk(value):
        if isinstance(value, float):
            assert not math.isnan(value)
        elif isinstance(value, dict):
            for item in value.values():
                walk(item)
        elif isinstance(value, (list, tuple)):
            for item in value:
                walk(item)

    walk(estimate_rsl(24.63))


def test_input_validation_matches_canonical_rules():
    """The engine accepts and rejects the same numeric/status inputs as v2.3."""
    import sys
    from tofusense_rsl._canonical import CANONICAL_SOURCE

    if CANONICAL_SOURCE not in sys.path:
        sys.path.insert(0, CANONICAL_SOURCE)
    from v2_3.conditional_rsl import RSLInputError as CanonicalInputError
    from v2_3.conditional_rsl import _validate as canonical_validate

    cases = [(0.0, "NOT_SPOILED", "DRY"), (24.63, "NOT_SPOILED", "DRY"),
             (-1.0, "NOT_SPOILED", "DRY"), (float("nan"), "NOT_SPOILED", "DRY"),
             (float("inf"), "NOT_SPOILED", "DRY"), ("x", "NOT_SPOILED", "DRY"),
             (1.0, "MAYBE", "DRY"), (1.0, "NOT_SPOILED", "")]
    for elapsed, status, condition in cases:
        try:
            canonical_validate(elapsed, status, condition)
            canonical_ok = True
        except (CanonicalInputError, TypeError, ValueError):
            canonical_ok = False
        try:
            estimate_rsl(elapsed, sample_status=status, storage_condition=condition)
            engine_ok = True
        except (RSLInputError, TypeError, ValueError):
            engine_ok = False
        assert engine_ok == canonical_ok, (elapsed, status, condition)
