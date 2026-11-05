"""T2: Turnbull nonparametric maximum likelihood for interval-censored data.

The estimator identifies probability mass on maximal intersections (innermost
support intervals). It does not identify the event-time distribution inside a
support interval, and it is not a machine-learning model.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Sequence

import numpy as np

TOL = 1e-12
SUPPORT_TOL = 1e-10
MAX_ITER = 100_000


class IntervalInputError(ValueError):
    """Raised when an interval set violates the (L, U] convention."""


@dataclass
class TurnbullResult:
    support: list[tuple[float, float]]
    masses: np.ndarray
    log_likelihood: float
    n_iterations: int
    converged: bool
    cells: list[tuple[float, float]] = field(default_factory=list)


def validate_intervals(intervals: Sequence[tuple[float, float]]) -> list[tuple[float, float]]:
    if not intervals:
        raise IntervalInputError("at least one interval is required")
    cleaned = []
    for lower, upper in intervals:
        lower = float(lower)
        upper = float(upper)
        if not np.isfinite(lower) or not np.isfinite(upper):
            raise IntervalInputError("interval bounds must be finite")
        if upper <= lower:
            raise IntervalInputError(f"invalid interval ({lower}, {upper}]: U must exceed L")
        cleaned.append((lower, upper))
    return cleaned


def _cells(intervals: Sequence[tuple[float, float]]) -> list[tuple[float, float]]:
    boundaries = sorted({bound for interval in intervals for bound in interval})
    return [(boundaries[i], boundaries[i + 1]) for i in range(len(boundaries) - 1)
            if boundaries[i + 1] > boundaries[i]]


def _coverage(intervals: Sequence[tuple[float, float]], cells: Sequence[tuple[float, float]]) -> np.ndarray:
    matrix = np.zeros((len(intervals), len(cells)), dtype=float)
    for i, (lower, upper) in enumerate(intervals):
        for j, (cell_lower, cell_upper) in enumerate(cells):
            if cell_lower >= lower - 1e-12 and cell_upper <= upper + 1e-12:
                matrix[i, j] = 1.0
        if matrix[i].sum() == 0:
            raise IntervalInputError(f"interval ({lower}, {upper}] covers no candidate cell")
    return matrix


def _merge_equivalent_cells(cells: list[tuple[float, float]],
                            matrix: np.ndarray) -> tuple[list[tuple[float, float]], np.ndarray]:
    """Merge adjacent cells that no observation distinguishes (maximal intersections)."""
    merged_cells = [cells[0]]
    merged_columns = [matrix[:, [0]]]
    for j in range(1, len(cells)):
        same = np.array_equal(matrix[:, j], matrix[:, j - 1])
        adjacent = abs(merged_cells[-1][1] - cells[j][0]) < 1e-12
        if same and adjacent:
            merged_cells[-1] = (merged_cells[-1][0], cells[j][1])
            merged_columns[-1] = matrix[:, [j]]
        else:
            merged_cells.append(cells[j])
            merged_columns.append(matrix[:, [j]])
    return merged_cells, np.hstack(merged_columns)


def turnbull(intervals: Sequence[tuple[float, float]], *,
             tol: float = TOL, support_tol: float = SUPPORT_TOL,
             max_iter: int = MAX_ITER) -> TurnbullResult:
    cleaned = validate_intervals(intervals)
    cells = _cells(cleaned)
    matrix = _coverage(cleaned, cells)
    support, matrix = _merge_equivalent_cells(cells, matrix)
    n_obs, n_cells = matrix.shape
    weights = np.full(n_cells, 1.0 / n_cells)
    log_likelihood = -np.inf
    converged = False
    iterations = 0
    for iterations in range(1, max_iter + 1):
        denominator = matrix @ weights
        if np.any(denominator <= 0):
            raise IntervalInputError("non-positive likelihood denominator")
        posterior = matrix * weights[None, :] / denominator[:, None]
        updated = posterior.sum(axis=0) / n_obs
        updated = np.clip(updated, 0.0, None)
        updated = updated / updated.sum()
        new_log_likelihood = float(np.sum(np.log(denominator)))
        if np.max(np.abs(updated - weights)) < tol:
            weights = updated
            log_likelihood = new_log_likelihood
            converged = True
            break
        weights = updated
        log_likelihood = new_log_likelihood
    keep = weights > support_tol
    support = [support[j] for j in range(n_cells) if keep[j]]
    masses = weights[keep]
    masses = masses / masses.sum()
    return TurnbullResult(support=support, masses=masses,
                          log_likelihood=float(log_likelihood), n_iterations=iterations,
                          converged=converged, cells=cells)


def survival_bounds(support: Sequence[tuple[float, float]], masses: Sequence[float],
                    times: Sequence[float]) -> tuple[np.ndarray, np.ndarray]:
    """S_low(t) = sum(p_j for t <= a_j); S_high(t) = sum(p_j for t < b_j)."""
    lower = np.asarray([sum(mass for (a, _), mass in zip(support, masses) if t <= a)
                        for t in times])
    upper = np.asarray([sum(mass for (_, b), mass in zip(support, masses) if t < b)
                        for t in times])
    return lower, upper


def conditional_support(support: Sequence[tuple[float, float]], masses: Sequence[float],
                        elapsed: float) -> list[dict[str, float]]:
    """Conditional remaining-time support components with b_j > t."""
    components = []
    for (a, b), mass in zip(support, masses):
        if b > elapsed:
            components.append({
                "rsl_low_h": max(a, elapsed) - elapsed,
                "rsl_high_h": b - elapsed,
                "mass": float(mass),
            })
    return components


SOURCE_INTERVALS: list[tuple[float, float]] = [
    (26.193751, 32.233196),
    (31.138800, 42.888800),
    (23.068924, 24.633924),
]
"""Full-precision dry-storage endpoints from the T1 audit (hours since first sensor).

These are the values used by every v2.3 calculation. The runner asserts them
against the audited inventory to 1e-5 h before writing any artifact. Rounding is
applied only when formatting a report table.
"""


def canonical_intervals(exact: Sequence[tuple[float, float]] | None = None) -> list[tuple[float, float]]:
    """Return the calculation intervals at source precision.

    Rounding is deliberately absent: risk-set membership uses the strict
    condition ``U_i > elapsed`` and a 0.004 h rounding error would change it.
    """
    intervals = (list(SOURCE_INTERVALS) if exact is None
                 else [(float(lower), float(upper)) for lower, upper in exact])
    return validate_intervals(intervals)


def reference_intervals(exact: Sequence[tuple[float, float]] | None = None) -> list[tuple[float, float]]:
    """Backwards-compatible alias for :func:`canonical_intervals`."""
    return canonical_intervals(exact)


def presentation(value: float, decimals: int = 2) -> float:
    """Round a number for display only. Never feed this back into a calculation."""
    return round(float(value), decimals)
