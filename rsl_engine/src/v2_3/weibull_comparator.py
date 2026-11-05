"""M3: read-only adapter around the frozen v2 Weibull A0 fit.

The frozen implementation in ``src/v2/arms.py`` (``_weibull_interval_fit``) is
imported unchanged. No frozen file is edited and no parameter search is run.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import numpy as np

EMPIRICAL_MAX_ENDPOINT_H = 42.89


@dataclass
class WeibullComparator:
    shape: float | None = None
    scale: float | None = None
    intervals: list[tuple[float, float]] | None = None

    def fit(self, intervals: Sequence[tuple[float, float]]) -> "WeibullComparator":
        # Imported lazily so that runtime use of the comparator does not pull the
        # deep-learning and estimator stack that the frozen v2 A0 fitter depends on.
        from v2.arms import _weibull_interval_fit

        lower = np.array([lower for lower, _ in intervals], dtype=float)
        upper = np.array([upper for _, upper in intervals], dtype=float)
        shape, scale = _weibull_interval_fit(lower, upper)
        self.shape = float(shape)
        self.scale = float(scale)
        self.intervals = [(float(l), float(u)) for l, u in intervals]
        return self

    def survival(self, t: float) -> float:
        return float(np.exp(-np.power(max(t, 0.0) / self.scale, self.shape)))

    def conditional_remaining_quantile(self, t: float, p: float) -> float:
        """r such that P(R <= r | T > t) = p.

        S(t + r) / S(t) = 1 - p  =>  r = scale * ((t/scale)^k - ln(1-p))^(1/k) - t
        """
        if not 0.0 < p < 1.0:
            raise ValueError("p must be in (0,1)")
        return float(self.scale * np.power(
            np.power(max(t, 0.0) / self.scale, self.shape) - np.log(1.0 - p),
            1.0 / self.shape) - t)

    def conditional_quantiles(self, t: float) -> dict:
        if t >= EMPIRICAL_MAX_ENDPOINT_H:
            return {"available": False, "status": "OUTSIDE_SUPPORT",
                    "method": "WEIBULL_A0_PARAMETRIC_COMPARATOR"}
        r10 = self.conditional_remaining_quantile(t, 0.10)
        r90 = self.conditional_remaining_quantile(t, 0.90)
        exceeds = bool(t + r90 > EMPIRICAL_MAX_ENDPOINT_H)
        return {
            "available": True,
            "method": "WEIBULL_A0_PARAMETRIC_COMPARATOR",
            "shape": self.shape,
            "scale": self.scale,
            "r10_h": r10,
            "r90_h": r90,
            "support_warning": "EXCEEDS_EMPIRICAL_SUPPORT" if exceeds else None,
            "suppress_from_dashboard": exceeds,
        }

    def check_conditional_identity(self, t: float, n: int = 5) -> float:
        """Max absolute error of P(R <= r_p | T > t) against the numerical target."""
        errors = []
        for p in np.linspace(0.05, 0.95, n):
            r = self.conditional_remaining_quantile(t, p)
            probability = 1.0 - self.survival(t + r) / self.survival(t)
            errors.append(abs(probability - p))
        return float(max(errors))
