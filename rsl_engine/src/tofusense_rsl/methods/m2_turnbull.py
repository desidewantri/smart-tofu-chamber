"""M2 - Turnbull NPMLE conditional support.

Delegates the conditional-support arithmetic to the canonical
``v2_3.turnbull.conditional_support``. Support is loaded from the reference JSON;
runtime inference never refits the NPMLE.
"""

from __future__ import annotations

from dataclasses import dataclass

from .._canonical import conditional_support
from ..reference_data import ReferenceData
from ..schemas import M2_ADVISORY, M2_LABEL, STATUS_OK, STATUS_OUTSIDE_SUPPORT

METHOD_ID = "M2_TURNBULL_NPMLE"
NOTE = ("estimator-dependent support; components are not confidence intervals and "
        "the mass inside a support interval is not identified")


@dataclass(frozen=True)
class SupportComponent:
    lower_h: float
    upper_h: float
    mass: float

    def to_dict(self) -> dict:
        return {"lower_h": self.lower_h, "upper_h": self.upper_h, "mass": self.mass}


@dataclass(frozen=True)
class M2Result:
    status: str
    components: tuple[SupportComponent, ...]
    method: str = METHOD_ID
    label: str = M2_LABEL
    advisory: str = M2_ADVISORY
    note: str = NOTE

    def to_dict(self) -> dict:
        return {"method": self.method, "label": self.label, "status": self.status,
                "advisory": self.advisory, "note": self.note,
                "n_components": len(self.components),
                "components": [component.to_dict() for component in self.components]}


def conditional_support_at(elapsed_h: float, reference: ReferenceData) -> M2Result:
    raw = conditional_support(reference.turnbull_support, reference.turnbull_masses,
                              float(elapsed_h))
    components = tuple(SupportComponent(lower_h=float(item["rsl_low_h"]),
                                        upper_h=float(item["rsl_high_h"]),
                                        mass=float(item["mass"])) for item in raw)
    status = STATUS_OK if components else STATUS_OUTSIDE_SUPPORT
    return M2Result(status=status, components=components)
