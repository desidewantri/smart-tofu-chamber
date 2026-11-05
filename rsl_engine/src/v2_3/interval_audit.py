"""T1: interval and time-origin audit for the v2.3 statistical RSL baseline.

Every elapsed value in this package is measured from the first sensor timestamp
of the session. The endpoint registry also carries `elapsed_*_hours` columns, but
those are measured from chamber entry; the difference is reported explicitly and
never substituted.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[2]
EVENT_LABELS = PROJECT_ROOT / "data" / "endpoint_integration" / "event_labels.csv"
EXPECTED = {
    "S3": (26.19, 32.23),
    "S4": (31.14, 42.89),
    "S5": (23.07, 24.63),
}
TOLERANCE_H = 0.05
INSPECTION_TYPES = {
    "BASELINE_OBSERVATION", "DETERIORATION_OBSERVATION", "DISPUTED_OBSERVATION",
    "LAST_NON_SPOILED_OBSERVATION", "FIRST_SPOILED_OBSERVATION",
    "SPOILED_CONFIRMATION", "PARTIAL_OBSERVATION", "RECHECK_OBSERVATION",
    "DISPOSAL_OBSERVATION",
}


@dataclass
class IntervalInventory:
    inventory: pd.DataFrame
    inspections: pd.DataFrame
    time_origin: dict
    failures: list[str]


def _event_rows() -> pd.DataFrame:
    frame = pd.read_csv(EVENT_LABELS)
    frame["observation_timestamp"] = pd.to_datetime(frame["observation_timestamp"], errors="coerce")
    return frame


def _event_id_at(events: pd.DataFrame, session: str, timestamp,
                 prefer: str | None = None) -> str | None:
    subset = events[events["session_id"] == session]
    if pd.notna(timestamp):
        subset = subset[subset["observation_timestamp"] == pd.Timestamp(timestamp)]
    elif prefer is not None:
        subset = subset[subset["event_type"] == prefer]
    else:
        return None
    subset = subset[subset["operational_spoilage_label"].notna()]
    if subset.empty:
        return None
    return str(subset.iloc[0]["event_id"])


def build_inventory(data) -> IntervalInventory:
    endpoints = data.endpoints.copy()
    events = _event_rows()
    rows, failures = [], []
    for _, endpoint in endpoints.iterrows():
        session = str(endpoint["session_id"])
        frame = data.sessions[session]
        first_sensor = frame["timestamp"].min()
        lower = pd.Timestamp(endpoint["endpoint_lower_bound"])
        upper = pd.Timestamp(endpoint["endpoint_upper_bound"])
        elapsed_lower = (lower - first_sensor).total_seconds() / 3600.0
        elapsed_upper = (upper - first_sensor).total_seconds() / 3600.0
        entry = pd.to_datetime(endpoint.get("chamber_entry_timestamp"), errors="coerce")
        production = pd.to_datetime(endpoint.get("production_timestamp"), errors="coerce")
        entry_offset = ((entry - first_sensor).total_seconds() / 60.0
                        if pd.notna(entry) else None)
        age = endpoint.get("tofu_age_at_entry_hours")
        role = str(endpoint["primary_or_sensitivity_interval"])
        medium = str(endpoint["storage_medium"])
        notes = []
        if role == "SENSITIVITY":
            notes.append("sensitivity interval; excluded from every primary analysis")
        if session in ("S1", "S2"):
            notes.append("water-storage session; EXCLUDED_FROM_DRY_ESTIMATOR")
        if pd.notna(entry) and entry_offset is not None and abs(entry_offset) > 0.5:
            notes.append(f"chamber entry differs from sensor start by {entry_offset:.2f} min")
        if pd.isna(entry):
            notes.append("chamber entry timestamp unknown")
        rows.append({
            "session_id": session,
            "role": role,
            "storage_condition": medium,
            "L_hours": elapsed_lower,
            "U_hours": elapsed_upper,
            "interval_width_hours": elapsed_upper - elapsed_lower,
            "first_sensor_timestamp": first_sensor,
            "chamber_entry_timestamp": entry if pd.notna(entry) else None,
            "production_timestamp": production if pd.notna(production) else None,
            "tofu_age_at_entry_hours": (float(age) if pd.notna(age) else None),
            "entry_minus_sensor_start_minutes": entry_offset,
            "registry_elapsed_lower_hours": (float(endpoint["elapsed_lower_hours"])
                                             if pd.notna(endpoint.get("elapsed_lower_hours")) else None),
            "registry_elapsed_upper_hours": (float(endpoint["elapsed_upper_hours"])
                                             if pd.notna(endpoint.get("elapsed_upper_hours")) else None),
            "last_non_spoiled_event_id": (_event_id_at(events, session, endpoint.get("last_non_spoiled_at"),
                                               prefer="LAST_NON_SPOILED_OBSERVATION")
                                     or _event_id_at(events, session, endpoint.get("last_non_spoiled_at"),
                                                     prefer="BASELINE_OBSERVATION")),
            "first_spoiled_event_id": _event_id_at(events, session, endpoint.get("first_spoiled_at"),
                                            prefer="FIRST_SPOILED_OBSERVATION"),
            "endpoint_source_provenance": str(endpoint.get("endpoint_evidence_source")),
            "endpoint_confidence_tier": str(endpoint.get("endpoint_confidence_tier")),
            "endpoint_status": ("EXCLUDED_FROM_DRY_ESTIMATOR"
                                if (role != "PRIMARY" or session in ("S1", "S2"))
                                else "INCLUDED_IN_DRY_ESTIMATOR"),
            "notes": "; ".join(notes),
        })
        if role == "PRIMARY" and session in EXPECTED:
            expected_lower, expected_upper = EXPECTED[session]
            if abs(elapsed_lower - expected_lower) > TOLERANCE_H:
                failures.append(f"{session} L {elapsed_lower:.4f} != {expected_lower}")
            if abs(elapsed_upper - expected_upper) > TOLERANCE_H:
                failures.append(f"{session} U {elapsed_upper:.4f} != {expected_upper}")
    inventory = pd.DataFrame(rows)
    inventory["included_in_dry_estimator"] = inventory["endpoint_status"].eq("INCLUDED_IN_DRY_ESTIMATOR")

    inspection_rows = []
    for session, group in events.groupby("session_id"):
        visits = group[group["event_type"].isin(INSPECTION_TYPES)
                       & group["observation_timestamp"].notna()].copy()
        visits = visits.sort_values("observation_timestamp")
        times = visits["observation_timestamp"].tolist()
        gaps = [round((times[i + 1] - times[i]).total_seconds() / 60.0, 3)
                for i in range(len(times) - 1)]
        first_sensor = data.sessions[session]["timestamp"].min()
        elapsed = [round((timestamp - first_sensor).total_seconds() / 3600.0, 3) for timestamp in times]
        if gaps:
            median_gap = float(np.median(gaps))
            endpoint_gap = gaps[-1]
            inspection_rows.append({
                "session_id": session,
                "n_inspections": len(times),
                "inspection_elapsed_hours": ";".join(str(value) for value in elapsed),
                "gap_minutes": ";".join(str(value) for value in gaps),
                "median_gap_minutes": median_gap,
                "min_gap_minutes": float(np.min(gaps)),
                "max_gap_minutes": float(np.max(gaps)),
                "gap_before_endpoint_minutes": float(endpoint_gap),
                "gap_before_endpoint_vs_median": float(endpoint_gap / median_gap),
                "denser_near_endpoint": bool(endpoint_gap < median_gap),
                "timestamp_available": True,
            })
        else:
            inspection_rows.append({
                "session_id": session, "n_inspections": len(times),
                "inspection_elapsed_hours": ";".join(str(value) for value in elapsed),
                "gap_minutes": "", "median_gap_minutes": None, "min_gap_minutes": None,
                "max_gap_minutes": None, "gap_before_endpoint_minutes": None,
                "gap_before_endpoint_vs_median": None, "denser_near_endpoint": None,
                "timestamp_available": False,
            })
    inspections = pd.DataFrame(inspection_rows)

    time_origin = {
        "elapsed_origin": "FIRST_SENSOR_TIMESTAMP",
        "definition": ("elapsed hours and RSL are measured from the first sensor "
                       "timestamp of each session; they are not tofu age and not "
                       "shelf life since production"),
        "sessions": {
            row["session_id"]: {
                "first_sensor_timestamp": str(row["first_sensor_timestamp"]),
                "chamber_entry_timestamp": (None if row["chamber_entry_timestamp"] is None
                                            else str(row["chamber_entry_timestamp"])),
                "entry_minus_sensor_start_minutes": row["entry_minus_sensor_start_minutes"],
                "tofu_age_at_entry_hours": row["tofu_age_at_entry_hours"],
                "tofu_age_before_monitoring": ("UNKNOWN" if row["tofu_age_at_entry_hours"] is None
                                                or pd.isna(row["chamber_entry_timestamp"])
                                                else "documented at entry"),
                "registry_elapsed_origin": ("chamber_entry" if row["session_id"] == "S3" else "chamber_entry"),
                "registry_minus_sensor_origin_hours": (
                    None if row["registry_elapsed_lower_hours"] is None
                    else float(row["registry_elapsed_lower_hours"] - row["L_hours"])),
            } for _, row in inventory.iterrows() if row["role"] == "PRIMARY"
        },
        "note": ("the endpoint registry's elapsed columns are measured from chamber entry; "
                 "this package recomputes elapsed from the first sensor timestamp and "
                 "reports the difference"),
        "failures": failures,
    }
    return IntervalInventory(inventory=inventory, inspections=inspections,
                             time_origin=time_origin, failures=failures)


def dry_intervals(inventory: pd.DataFrame) -> pd.DataFrame:
    """Exactly the three primary dry-storage intervals, sorted by L."""
    subset = inventory[(inventory["role"] == "PRIMARY")
                       & (inventory["storage_condition"] == "DRY")
                       & (inventory["session_id"].isin(list(EXPECTED)))]
    return subset.sort_values("L_hours").reset_index(drop=True)
