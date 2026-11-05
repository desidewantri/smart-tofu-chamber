"""Dashboard mock data for the TofuSense Expo demonstration.

This is a static illustration built from historical reference intervals. It is
not connected to the live API and must never be presented as live inference.
"""

from __future__ import annotations

from typing import Any

from .conditional_rsl import estimate_rsl
from .schemas import M1_LABEL

BANNER = "SIMULASI TAMPILAN, BUKAN PREDIKSI LIVE"
LABELS = {
    "primary": "Estimasi historis indikatif",
    "reference": "Berdasarkan 3 sesi tahu kering",
    "tvoc": "TVOC contribution: NOT ESTABLISHED",
    "origin": "Time origin: since first sensor timestamp",
}
GRID_HOURS = [0, 6, 12, 18, 23, 24, 24.63, 26, 28, 30, 32, 35, 40, 43]


def build_dashboard_data(reference=None) -> dict[str, Any]:
    points = []
    for elapsed in GRID_HOURS:
        estimate = estimate_rsl(elapsed, reference=reference)
        m3 = estimate.get("m3_comparator") or {}
        points.append({
            "elapsed_h": elapsed,
            "status": estimate["status"],
            "m1_empirical_envelope": {
                "low_h": estimate["rsl_low_h"],
                "high_h": estimate["rsl_high_h"],
                "label": M1_LABEL,
            },
            "m1b_risk_set_variant": {
                "low_h": estimate.get("m1b_risk_set_low_h"),
                "high_h": estimate.get("m1b_risk_set_high_h"),
                "label": "risk-set variant, non-monotone lower bound",
            },
            "m2_turnbull_components": estimate["m2_support_components"],
            "m3_weibull_comparator": (None if not m3.get("available")
                                      else {"low_h": m3["r10_h"], "high_h": m3["r90_h"],
                                            "support_warning": m3["support_warning"],
                                            "suppressed": m3["suppress_from_dashboard"]}),
            "n_reference_sessions": estimate["n_reference_sessions"],
            "n_at_risk_sessions": estimate["n_at_risk_sessions"],
            "caveats": estimate["caveats"],
        })
    return {
        "banner": BANNER,
        "labels": LABELS,
        "method_primary": "M1_EMPIRICAL_ENVELOPE",
        "elapsed_origin": "FIRST_SENSOR_TIMESTAMP",
        "tvoc_contribution": "NOT_ESTABLISHED",
        "reference_sessions": 3,
        "points": points,
    }
