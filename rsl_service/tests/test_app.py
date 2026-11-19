from datetime import datetime, timedelta, timezone
import pytest
from fastapi.testclient import TestClient
from engine import ARTIFACT_PATH, EXPECTED_SHA256, ArtifactIntegrityError
from app import create_app

START = datetime(2026, 11, 18, 1, 0, tzinfo=timezone.utc)

@pytest.fixture()
def client(tmp_path):
    return TestClient(create_app(db_path=tmp_path / "rt.sqlite"))

def test_health_reports_frozen_sha(client):
    body = client.get("/health").json()
    assert body["ok"] is True
    assert body["sha256"] == EXPECTED_SHA256
    assert body["domain_max_hours"] == 38.0

def test_estimate_inside_domain(client):
    r = client.post("/estimate", json={
        "session_id": "s1",
        "monitoring_start_at": START.isoformat(),
        "current_timestamp": (START + timedelta(hours=2)).isoformat(),
        "temp_c": 27.4, "humid_pct": 78.9, "esp32_connected": True,
    })
    assert r.status_code == 200
    body = r.json()
    assert body["estimate"]["median_rsl_hours"] is not None
    assert body["operational_prediction_authorized"] is False

def test_estimate_missing_start_returns_action_required(client):
    r = client.post("/estimate", json={"session_id": "s1"})
    assert r.status_code == 200
    assert r.json()["application_state"] == "ACTION_REQUIRED"
    assert r.json()["estimate"]["median_rsl_hours"] is None

def test_estimate_rejects_non_numeric_temp(client):
    r = client.post("/estimate", json={
        "session_id": "s1", "monitoring_start_at": START.isoformat(), "temp_c": "hangat",
    })
    assert r.status_code == 400

def test_app_refuses_wrong_sha(tmp_path):
    with pytest.raises(ArtifactIntegrityError):
        create_app(expected_sha256="0" * 64, db_path=tmp_path / "rt.sqlite")
