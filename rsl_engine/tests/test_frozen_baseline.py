"""Parity against the frozen v2.3 published baseline artifacts."""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path

from tofusense_rsl import default_reference, estimate_rsl

FIXTURES = Path(__file__).resolve().parent / "fixtures"


def _range(text: str) -> tuple[float, float]:
    numbers = [float(value) for value in re.findall(r"-?\d+(?:\.\d+)?", text)]
    assert len(numbers) == 2, text
    return numbers[0], numbers[1]


def test_turnbull_summary_matches_frozen_reference():
    frozen = json.loads((FIXTURES / "turnbull_summary.json").read_text(encoding="utf-8"))
    reference = default_reference()
    assert sorted(tuple(item) for item in frozen["reference_intervals"]) == sorted(reference.intervals)
    assert len(frozen["support_intervals"]) == len(reference.turnbull_support)
    for expected, actual, mass in zip(
        frozen["support_intervals"], reference.turnbull_support, reference.turnbull_masses
    ):
        assert (expected["a"], expected["b"]) == actual
        assert expected["mass"] == mass


def test_m1_and_m2_grid_match_frozen_csv_within_presentation_tolerance():
    with (FIXTURES / "conditional_rsl_grid.csv").open(encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    assert len(rows) == 14
    for row in rows:
        elapsed = float(row["elapsed_h"])
        result = estimate_rsl(elapsed)
        assert result["status"] == row["status"], elapsed
        if row["status"] != "OK":
            assert result["primary_rsl"]["lower_h"] is None
            continue
        frozen_low, frozen_high = _range(row["M1_empirical_envelope"])
        assert abs(result["primary_rsl"]["lower_h"] - frozen_low) <= 0.005
        assert abs(result["primary_rsl"]["upper_h"] - frozen_high) <= 0.005
        assert result["n_at_risk_sessions"] == int(row["n_at_risk_sessions"])
        frozen_components = row["M2_turnbull_components"]
        if frozen_components.strip() == "UNDEFINED":
            assert result["methods"]["M2"]["components"] == []
        else:
            assert len(result["methods"]["M2"]["components"]) == len(
                [part for part in frozen_components.split(";") if part.strip()]
            )
