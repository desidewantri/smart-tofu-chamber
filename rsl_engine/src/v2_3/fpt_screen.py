"""T4: First-Passage-Time global-threshold screen (post-hoc reproducibility only).

Frozen specification, no tuning:
- x = log1p(TVOC1), sentinel 99999 -> NaN.
- x_at_L / x_at_U: nearest valid reading, ties resolved to the earlier timestamp.
- theta: mean over the two training dry sessions of 0.5 * (x_at_L + x_at_U).
- baseline: median of the first 12 valid TVOC1 readings; log_ratio = x_at_U - log1p(baseline).
- landmarks every 30 min from 3 h through L.
- Theil-Sen slope on the last 3 h of valid readings (>= 12 points), x_t = median of the
  last three valid readings, slope <= 0.01/h -> NaN.
- predicted_crossing = t + (theta - x_t) / slope.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import numpy as np
import pandas as pd
from scipy.stats import theilslopes

SENTINEL = 99999
MIN_WINDOW_POINTS = 12
SLOPE_FLOOR = 0.01
WINDOW_HOURS = 3.0
LANDMARK_START_H = 3.0
LANDMARK_STEP_H = 0.5


@dataclass
class SessionSeries:
    session_id: str
    elapsed: np.ndarray
    x: np.ndarray
    lower: float
    upper: float
    baseline: float


def clean_series(frame: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
    values = pd.to_numeric(frame["tvoc1"], errors="coerce").to_numpy(dtype=float)
    values = np.where(values == SENTINEL, np.nan, values)
    elapsed = frame["elapsed_hours"].to_numpy(dtype=float)
    order = np.argsort(elapsed)
    return elapsed[order], np.log1p(values[order])


def nearest_valid(elapsed: np.ndarray, x: np.ndarray, target: float) -> tuple[float, float]:
    valid = np.isfinite(x)
    if not valid.any():
        raise ValueError("no valid readings")
    distance = np.abs(elapsed[valid] - target)
    candidates = np.where(valid)[0]
    best = candidates[int(np.argmin(distance))]
    tied = candidates[np.isclose(distance, distance.min(), atol=0.0)]
    best = int(tied.min()) if len(tied) else int(best)
    return float(elapsed[best]), float(x[best])


def build_series(data, inventory: pd.DataFrame) -> dict[str, SessionSeries]:
    series = {}
    for _, row in inventory[(inventory["role"] == "PRIMARY")
                            & (inventory["storage_condition"] == "DRY")].iterrows():
        session = row["session_id"]
        elapsed, x = clean_series(data.sessions[session])
        first_twelve = x[np.isfinite(x)][:12]
        baseline = float(np.median(np.expm1(first_twelve))) if first_twelve.size else np.nan
        series[session] = SessionSeries(session_id=session, elapsed=elapsed, x=x,
                                        lower=float(row["L_hours"]),
                                        upper=float(row["U_hours"]),
                                        baseline=baseline)
    return series


def anchor_values(series: SessionSeries) -> dict[str, float]:
    _, x_lower = nearest_valid(series.elapsed, series.x, series.lower)
    _, x_upper = nearest_valid(series.elapsed, series.x, series.upper)
    return {
        "session_id": series.session_id,
        "x_at_L": x_lower,
        "x_at_U": x_upper,
        "TVOC1_at_L": float(np.expm1(x_lower)),
        "TVOC1_at_U": float(np.expm1(x_upper)),
        "baseline_TVOC1": series.baseline,
        "log1p_baseline": float(np.log1p(series.baseline)),
        "log_ratio": float(x_upper - np.log1p(series.baseline)),
        "endpoint_half_mean": float(0.5 * (x_lower + x_upper)),
    }


def landmarks(series: SessionSeries) -> list[dict]:
    rows = []
    times = np.arange(LANDMARK_START_H, series.lower + 1e-9, LANDMARK_STEP_H)
    for t in times:
        in_window = (series.elapsed <= t) & (series.elapsed >= t - WINDOW_HOURS) & np.isfinite(series.x)
        n_window = int(in_window.sum())
        record = {"elapsed_h": float(t), "n_window": n_window, "reason": None,
                  "x_t": None, "slope": None, "predicted_crossing": None}
        if n_window < MIN_WINDOW_POINTS:
            record["reason"] = f"fewer_than_{MIN_WINDOW_POINTS}_valid_points_in_3h_window"
            rows.append(record)
            continue
        window_elapsed = series.elapsed[in_window]
        window_x = series.x[in_window]
        slope = float(theilslopes(window_x, window_elapsed).slope)
        last_three = series.x[(series.elapsed <= t) & np.isfinite(series.x)][-3:]
        x_t = float(np.median(last_three))
        record["x_t"] = x_t
        record["slope"] = slope
        if slope <= SLOPE_FLOOR:
            record["reason"] = f"slope_le_{SLOPE_FLOOR}"
            rows.append(record)
            continue
        rows.append(record)
    return rows


def run_screen(data, inventory: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    series = build_series(data, inventory)
    anchors = pd.DataFrame([anchor_values(item) for item in series.values()])
    anchor_map = anchors.set_index("session_id")
    landmark_rows, summary_rows = [], []
    for held, item in series.items():
        training = [session for session in series if session != held]
        theta = float(np.mean([anchor_map.loc[session, "endpoint_half_mean"] for session in training]))
        log_ratio = float(anchor_map.loc[held, "log_ratio"])
        predicted_ratio_threshold = float(np.exp(theta))
        rows = landmarks(item)
        for row in rows:
            crossing = None
            if row["slope"] is not None and row["slope"] > SLOPE_FLOOR:
                crossing = row["elapsed_h"] + (theta - row["x_t"]) / row["slope"]
            row.update({"held_out": held, "theta": theta,
                        "x_at_U": float(anchor_map.loc[held, "x_at_U"]),
                        "log_ratio": log_ratio, "predicted_crossing": crossing})
            row["inside_endpoint"] = bool(crossing is not None
                                          and item.lower < crossing <= item.upper)
            landmark_rows.append(row)
        valid = [row["predicted_crossing"] for row in rows if row["predicted_crossing"] is not None]
        nan_rows = [row for row in rows if row["predicted_crossing"] is None]
        valid_array = np.array(valid, dtype=float)
        summary_rows.append({
            "held_out": held,
            "n_landmarks": len(rows),
            "n_valid": len(valid),
            "n_nan": len(nan_rows),
            "n_excluded": len(nan_rows),
            "exclusion_reasons": ";".join(sorted({row["reason"] for row in nan_rows if row["reason"]})),
            "theta": theta,
            "threshold_TVOC1_raw": predicted_ratio_threshold,
            "x_at_L": float(anchor_map.loc[held, "x_at_L"]),
            "x_at_U": float(anchor_map.loc[held, "x_at_U"]),
            "baseline_TVOC1": float(anchor_map.loc[held, "baseline_TVOC1"]),
            "log_ratio": log_ratio,
            "crossing_median_h": float(np.median(valid_array)) if len(valid_array) else None,
            "crossing_q25_h": float(np.quantile(valid_array, 0.25)) if len(valid_array) else None,
            "crossing_q75_h": float(np.quantile(valid_array, 0.75)) if len(valid_array) else None,
            "fraction_inside_endpoint": (float(np.mean([row["inside_endpoint"] for row in rows
                                                        if row["predicted_crossing"] is not None]))
                                         if valid else None),
            "endpoint_L": item.lower,
            "endpoint_U": item.upper,
        })
    return pd.DataFrame(landmark_rows), pd.DataFrame(summary_rows), anchors


def raw_scale_ratios(anchors: pd.DataFrame) -> dict[str, float]:
    values = anchors.set_index("session_id")["TVOC1_at_U"]
    return {
        "S3_over_S5": float(values["S3"] / values["S5"]),
        "S4_over_S5": float(values["S4"] / values["S5"]),
        "S4_over_S3": float(values["S4"] / values["S3"]),
    }
