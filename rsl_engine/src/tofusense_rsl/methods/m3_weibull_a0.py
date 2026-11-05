"""M3 - Weibull A0 parametric comparator.

Parameters are loaded from the reference JSON. The conditional quantile identity
``S(t + r) / S(t) = 1 - p`` is evaluated by the canonical comparator; the engine
never fits or tunes Weibull parameters.
"""

from __future__ import annotations

from dataclasses import dataclass

from .._canonical import WeibullComparator
from ..reference_data import ReferenceData
from ..schemas import M3_LABEL, STATUS_OK, STATUS_OUTSIDE_SUPPORT

METHOD_ID = "M3_WEIBULL_A0"
NOTE = "parametric comparator only; not the primary estimate"


@dataclass(frozen=True)
class M3Result:
    status: str
    available: bool
    shape: float
    scale: float
    r10_h: float | None
    r90_h: float | None
    support_warning: str | None
    suppressed: bool
    method: str = METHOD_ID
    label: str = M3_LABEL
    note: str = NOTE

    def to_dict(self) -> dict:
        return {"method": self.method, "label": self.label, "status": self.status,
                "available": self.available, "shape": self.shape, "scale": self.scale,
                "r10_h": self.r10_h, "r90_h": self.r90_h,
                "support_warning": self.support_warning,
                "suppress_from_dashboard": self.suppressed, "note": self.note}


def conditional_quantiles(elapsed_h: float, reference: ReferenceData) -> M3Result:
    comparator = WeibullComparator(shape=reference.weibull_shape,
                                   scale=reference.weibull_scale)
    payload = comparator.conditional_quantiles(float(elapsed_h))
    if not payload.get("available", False):
        return M3Result(status=STATUS_OUTSIDE_SUPPORT, available=False,
                        shape=reference.weibull_shape, scale=reference.weibull_scale,
                        r10_h=None, r90_h=None, support_warning="OUTSIDE_SUPPORT",
                        suppressed=True)
    return M3Result(status=STATUS_OK, available=True,
                    shape=reference.weibull_shape, scale=reference.weibull_scale,
                    r10_h=float(payload["r10_h"]), r90_h=float(payload["r90_h"]),
                    support_warning=payload.get("support_warning"),
                    suppressed=bool(payload.get("suppress_from_dashboard", False)))
