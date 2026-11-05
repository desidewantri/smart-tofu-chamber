"""M1 - empirical interval envelope (primary displayed method).

Delegates the arithmetic to ``v2_3.conditional_rsl.empirical_envelope`` so there
is exactly one implementation. The envelope is the outer range of remaining times
compatible with the historical intervals; it is not a prediction interval.
"""

from __future__ import annotations

from dataclasses import dataclass

from .._canonical import empirical_envelope
from ..reference_data import ReferenceData
from ..schemas import M1_INTERPRETATION, M1_LABEL, STATUS_OK, STATUS_OUTSIDE_SUPPORT

METHOD_ID = "M1_EMPIRICAL_ENVELOPE"


@dataclass(frozen=True)
class M1Result:
    status: str
    lower_h: float | None
    upper_h: float | None
    n_reference_sessions: int
    n_at_risk_sessions: int
    interpretation: str = M1_INTERPRETATION
    label: str = M1_LABEL
    method: str = METHOD_ID

    def to_dict(self) -> dict:
        return {"method": self.method, "status": self.status,
                "lower_h": self.lower_h, "upper_h": self.upper_h,
                "interpretation": self.interpretation, "label": self.label,
                "n_reference_sessions": self.n_reference_sessions,
                "n_at_risk_sessions": self.n_at_risk_sessions}


def estimate(elapsed_h: float, reference: ReferenceData) -> M1Result:
    envelope = empirical_envelope(reference.intervals, float(elapsed_h))
    status = STATUS_OUTSIDE_SUPPORT if envelope["status"] == STATUS_OUTSIDE_SUPPORT else STATUS_OK
    return M1Result(status=status, lower_h=envelope["lower_h"], upper_h=envelope["upper_h"],
                    n_reference_sessions=envelope["n_reference_sessions"],
                    n_at_risk_sessions=envelope["n_at_risk_sessions"])
