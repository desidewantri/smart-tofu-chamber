"""M3 parameter loading, conditional quantiles and support suppression."""

from __future__ import annotations

import numpy as np
import pytest

from tofusense_rsl import default_reference
from tofusense_rsl._canonical import WeibullComparator
from tofusense_rsl.methods import estimate_m3

REFERENCE = default_reference()


def test_parameters_loaded_from_reference():
    assert REFERENCE.weibull_shape == pytest.approx(7.6967264161196045, abs=1e-12)
    assert REFERENCE.weibull_scale == pytest.approx(30.757113200124557, abs=1e-12)


@pytest.mark.parametrize("elapsed", [0, 6, 12, 20, 24, 30])
def test_conditional_identity(elapsed):
    result = estimate_m3(elapsed, REFERENCE)
    comparator = WeibullComparator(shape=REFERENCE.weibull_shape, scale=REFERENCE.weibull_scale)
    for probability, value in ((0.10, result.r10_h), (0.90, result.r90_h)):
        realised = 1.0 - comparator.survival(elapsed + value) / comparator.survival(elapsed)
        assert realised == pytest.approx(probability, abs=1e-9)


def test_conditional_is_not_unconditional_minus_elapsed():
    result = estimate_m3(24, REFERENCE)
    comparator = WeibullComparator(shape=REFERENCE.weibull_shape, scale=REFERENCE.weibull_scale)
    unconditional = comparator.scale * np.log(2.0) ** (1.0 / comparator.shape)
    assert abs(result.r90_h - (unconditional - 24)) > 1e-6


def test_tail_beyond_empirical_support_is_flagged():
    result = estimate_m3(42, REFERENCE)
    assert result.support_warning == "EXCEEDS_EMPIRICAL_SUPPORT"
    assert result.suppressed is True


def test_outside_support_at_maximum_endpoint():
    assert estimate_m3(42.89, REFERENCE).status == "OUTSIDE_SUPPORT"
    assert estimate_m3(43, REFERENCE).available is False


def test_m3_is_labelled_a_comparator():
    result = estimate_m3(20, REFERENCE)
    assert result.label == "WEIBULL_A0_PARAMETRIC_COMPARATOR"
    assert "not the primary" in result.note
