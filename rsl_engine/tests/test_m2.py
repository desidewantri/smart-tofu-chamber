"""M2 support intervals, masses, disconnected components and boundaries."""

from __future__ import annotations

import pytest

from tofusense_rsl import default_reference
from tofusense_rsl.methods import conditional_support_at

REFERENCE = default_reference()


def test_support_intervals_and_masses_loaded():
    assert len(REFERENCE.turnbull_support) == 2
    assert sum(REFERENCE.turnbull_masses) == pytest.approx(1.0, abs=1e-12)
    assert REFERENCE.turnbull_masses[0] == pytest.approx(1 / 3, abs=1e-8)
    assert REFERENCE.turnbull_masses[1] == pytest.approx(2 / 3, abs=1e-8)
    assert REFERENCE.turnbull_support[0][0] == pytest.approx(23.068924, abs=1e-6)
    assert REFERENCE.turnbull_support[1][0] == pytest.approx(31.1388, abs=1e-6)


def test_disconnected_support_is_preserved_at_zero():
    result = conditional_support_at(0, REFERENCE)
    assert len(result.components) == 2
    assert result.components[0].lower_h == pytest.approx(23.068924, abs=1e-6)
    assert result.components[1].lower_h == pytest.approx(31.1388, abs=1e-6)
    assert all(component.mass > 0 for component in result.components)


def test_components_are_never_flattened():
    result = conditional_support_at(0, REFERENCE)
    lows = [component.lower_h for component in result.components]
    assert len(set(lows)) == len(lows)


def test_residual_component_at_24_63():
    result = conditional_support_at(24.63, REFERENCE)
    assert len(result.components) == 2
    narrow, wide = sorted(result.components, key=lambda item: item.upper_h)
    assert narrow.lower_h == pytest.approx(0.0, abs=1e-12)
    assert narrow.upper_h == pytest.approx(0.003924, abs=1e-6)
    assert wide.lower_h == pytest.approx(6.5088, abs=1e-6)
    assert wide.upper_h == pytest.approx(7.603195555555554, abs=1e-12)


@pytest.mark.parametrize("offset,expected_components", [
    (-1e-3, 2), (-1e-9, 2), (0.0, 1), (1e-9, 1), (1e-3, 1),
])
def test_component_count_across_u_s5(offset, expected_components):
    u5 = REFERENCE.intervals[2][1]
    result = conditional_support_at(u5 + offset, REFERENCE)
    assert len(result.components) == expected_components


def test_support_ends_before_the_envelope_does():
    assert conditional_support_at(35, REFERENCE).components == ()
    assert conditional_support_at(35, REFERENCE).status == "OUTSIDE_SUPPORT"


def test_no_mean_residual_life_is_reported():
    payload = conditional_support_at(20, REFERENCE).to_dict()
    assert "mean" not in payload
    assert payload["advisory"].startswith("ESTIMATOR_DEPENDENT")


def test_runtime_does_not_refit_the_npmle(monkeypatch):
    import v2_3.turnbull as canonical
    import tofusense_rsl.methods.m2_turnbull as module

    def _forbidden(*args, **kwargs):
        raise AssertionError("the engine must not refit the NPMLE at runtime")

    monkeypatch.setattr(canonical, "turnbull", _forbidden)
    result = module.conditional_support_at(20, REFERENCE)
    # At t = 20 both support intervals are still ahead of the elapsed time.
    assert len(result.components) == 2
