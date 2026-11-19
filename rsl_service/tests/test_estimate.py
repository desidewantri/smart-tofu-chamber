from datetime import datetime, timedelta, timezone
from pathlib import Path
import pytest
from engine import ARTIFACT_PATH, EXPECTED_SHA256, build_orchestrator, estimate

START = datetime(2026, 11, 18, 1, 0, tzinfo=timezone.utc)

@pytest.fixture()
def orch(tmp_path):
    return build_orchestrator(artifact_path=ARTIFACT_PATH, expected_sha256=EXPECTED_SHA256, db_path=tmp_path / "rt.sqlite")

def at(orch, hours, sid="s1"):
    return estimate(orch, session_id=sid, monitoring_start_at=START.isoformat(),
                    current_timestamp=(START + timedelta(hours=hours)).isoformat())

def test_inside_domain_returns_median(orch):
    r = at(orch, 2.0)
    assert r["application_state"] == "ESTIMATE_AVAILABLE"
    assert r["domain_status"] == "WITHIN_DOMAIN"
    assert r["estimate"]["median_rsl_hours"] is not None
    assert r["operational_prediction_authorized"] is False

def test_below_min_window_returns_waiting_for_data(orch):
    r = at(orch, 0.2499)
    assert r["application_state"] == "WAITING_FOR_DATA"
    assert r["estimate"]["median_rsl_hours"] is None
    assert r["research_display_eligible"] is False

def test_at_boundary_is_inside_domain(orch):
    r = at(orch, 38.0)
    assert r["domain_status"] == "AT_BOUNDARY"
    assert r["estimate"]["median_rsl_hours"] is not None

def test_beyond_domain_hides_number(orch):
    r = at(orch, 38.0001)
    assert r["failure_category"] == "OUT_OF_DOMAIN"
    assert r["estimate"]["median_rsl_hours"] is None
    assert r["research_display_eligible"] is False

def test_force_bypasses_cache(orch):
    first = at(orch, 2.0, sid="cache")
    second = at(orch, 2.0, sid="cache")
    assert first["last_calculated_at"] != second["last_calculated_at"]

def test_timestamp_regression_is_action_required(orch):
    at(orch, 5.0, sid="reg")
    r = at(orch, 4.0, sid="reg")
    assert r["application_state"] == "ACTION_REQUIRED"
    assert r["monitoring"]["timestamp_valid"] is False

def test_presentation_fields_present(orch):
    r = at(orch, 3.0)
    assert r["research_disclaimer_id"].startswith("Perkiraan ini dihasilkan")
    assert r["headline_id"]
    assert r["availability_category"] == "AVAILABLE"
