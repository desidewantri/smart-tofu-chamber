"""Explicit adapter to the canonical v2.3 mathematical implementation.

Single-source-of-truth decision
-------------------------------
The mathematics is a byte-identical vendored snapshot of the frozen v2.3
research modules under ``src/v2_3``. This package imports those modules and
wraps them with a stable, application-facing API; it does not reimplement the
formulas.

The snapshot is self-contained in both source checkout and installed-wheel
layouts. ``TOFUSENSE_REPO_SRC`` is an optional parity-testing override for the
original research checkout. There is no silent fallback: if the canonical
modules are missing, import fails with an actionable error.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path


def _discover_repo_src() -> Path:
    override = os.environ.get("TOFUSENSE_REPO_SRC")
    if override:
        candidate = Path(override).expanduser().resolve()
        if (candidate / "v2_3" / "turnbull.py").exists():
            return candidate
        raise ImportError(
            f"TOFUSENSE_REPO_SRC={override!r} does not contain v2_3/turnbull.py")
    for parent in Path(__file__).resolve().parents:
        # Source checkout: <repo>/rsl_engine/src/v2_3. Installed wheel:
        # <site-packages>/v2_3. Both are self-contained.
        for candidate in (parent / "src", parent):
            if (candidate / "v2_3" / "turnbull.py").exists():
                return candidate
    raise ImportError(
        "cannot locate the canonical v2.3 sources; set TOFUSENSE_REPO_SRC to the "
        "repository 'src' directory")


CANONICAL_SOURCE = str(_discover_repo_src())
if CANONICAL_SOURCE not in sys.path:
    sys.path.insert(0, CANONICAL_SOURCE)

from v2_3.conditional_rsl import empirical_envelope  # noqa: E402
from v2_3.turnbull import (  # noqa: E402
    IntervalInputError,
    canonical_intervals,
    conditional_support,
    presentation,
    turnbull,
)
from v2_3.weibull_comparator import EMPIRICAL_MAX_ENDPOINT_H, WeibullComparator  # noqa: E402

__all__ = [
    "CANONICAL_SOURCE",
    "EMPIRICAL_MAX_ENDPOINT_H",
    "IntervalInputError",
    "WeibullComparator",
    "canonical_intervals",
    "conditional_support",
    "empirical_envelope",
    "presentation",
    "turnbull",
]
