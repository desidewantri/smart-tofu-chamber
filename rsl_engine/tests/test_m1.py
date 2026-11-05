"""M1 parity, precision and risk-set behaviour."""

from __future__ import annotations

import pytest

from tofusense_rsl import default_reference
from tofusense_rsl._canonical import empirical_envelope
from tofusense_rsl.methods import estimate_m1
from tofusense_rsl.schemas import M1_LABEL, STATUS_OK, STATUS_OUTSIDE_SUPPORT

GRID = (0, 6, 12, 18, 23, 24, 24.63, 26, 28, 30, 32, 35, 40, 43)
REFERENCE = default_reference()


@pytest.mark.parametrize("elapsed", GRID)
def test_m1_matches_canonical_implementation(elapsed):
    expected = empirical_envelope(REFERENCE.intervals, float(elapsed))
    actual = estimate_m1(elapsed, REFERENCE)
    assert actual.status == expected["status"]
    if expected["status"] == STATUS_OK:
        assert actual.lower_h == pytest.approx(expected["lower_h"], abs=1e-12)
        assert actual.upper_h == pytest.approx(expected["upper_h"], abs=1e-12)
        assert actual.n_at_risk_sessions == expected["n_at_risk_sessions"]


@pytest.mark.parametrize("elapsed,low,high", [
    (0, 23.068924, 42.888800),
    (24, 0.0, 18.888800),
    (28, 0.0, 14.888800),
    (30, 0.0, 12.888800),
    (32, 0.0, 10.888800),
    (35, 0.0, 7.888800),
    (40, 0.0, 2.888800),
])
def test_m1_reference_values(elapsed, low, high):
    result = estimate_m1(elapsed, REFERENCE)
    assert result.lower_h == pytest.approx(low, abs=1e-6)
    assert result.upper_h == pytest.approx(high, abs=1e-6)


def test_m1_uses_full_precision_endpoints():
    assert REFERENCE.intervals[2][1] == pytest.approx(24.633924444444443, abs=1e-12)
    result = estimate_m1(24.63, REFERENCE)
    assert result.n_at_risk_sessions == 3
    assert result.upper_h == pytest.approx(42.888800 - 24.63, abs=1e-9)


@pytest.mark.parametrize("offset,expected_at_risk", [
    (-1e-3, 3), (-1e-9, 3), (0.0, 2), (1e-9, 2), (1e-3, 2),
])
def test_m1_risk_set_boundary_at_u_s5(offset, expected_at_risk):
    u5 = REFERENCE.intervals[2][1]
    result = estimate_m1(u5 + offset, REFERENCE)
    assert result.n_at_risk_sessions == expected_at_risk


def test_m1_outside_support():
    result = estimate_m1(43, REFERENCE)
    assert result.status == STATUS_OUTSIDE_SUPPORT
    assert result.lower_h is None and result.upper_h is None


def test_m1_label_and_interpretation():
    result = estimate_m1(20, REFERENCE)
    assert result.interpretation == "EMPIRICAL_INTERVAL_ENVELOPE"
    assert result.label == M1_LABEL
    assert "NOT A PROBABILISTIC PREDICTION" in result.label
