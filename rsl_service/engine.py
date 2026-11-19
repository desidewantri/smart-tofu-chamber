"""RSL V2.1 inference service TOSCHA.

Modul ini adalah pintu masuk runtime web untuk model riset yang dibekukan
(RSL V2.1, Bayesian Weibull). Tahap ini memuat verifikasi integritas
artifact dan wrapper orchestrator dengan penegakan force=True.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
from typing import Any

from tofu_ml.rsl_orchestration.estimation_scheduler import EstimationScheduler
from tofu_ml.rsl_orchestration.presentation_adapter import to_consumer_presentation
from tofu_ml.rsl_orchestration.rsl_orchestrator import RSLOrchestrator

ARTIFACT_PATH: Path = (
    Path(__file__).resolve().parent / "artifacts" / "m0_bayesian_weibull_primary_3u.json"
)

# Nilai beku RSL V2.1. Override lewat env hanya untuk kebutuhan operasional
# (mis. memutar ulang artifact lain di lingkungan uji), bukan untuk fallback diam-diam.
EXPECTED_SHA256: str = os.environ.get(
    "RSL_EXPECTED_SHA256",
    "5865af9ca9e8a85d677d6cc7fb9a91519ca0b5b96674dcddc67be0de8654c403",
)

# Batas domain operasional 38.0 jam (strictly monotonic sebelum tail flattening >38h).
DOMAIN_MAX_HOURS: float = 38.0

_CHUNK_SIZE = 1024 * 1024  # 1 MiB


class ArtifactIntegrityError(RuntimeError):
    """Artifact model tidak sesuai dengan SHA-256 yang dibekukan."""


def sha256_file(path: Path) -> str:
    """Hitung SHA-256 isi file, dibaca bertahap 1 MiB agar hemat memori."""
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(_CHUNK_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_artifact(path: Path, expected_sha256: str) -> None:
    """Pastikan artifact cocok dengan SHA-256 yang diharapkan (fail-closed).

    Perbandingan case-insensitive terhadap hex digest. Jika tidak cocok,
    lempar :class:`ArtifactIntegrityError` — tidak ada jalur fallback.
    """
    actual = sha256_file(path)
    if actual.lower() != expected_sha256.strip().lower():
        raise ArtifactIntegrityError(
            f"Artifact SHA-256 mismatch: {actual} != {expected_sha256}"
        )


def build_orchestrator(
    *,
    artifact_path: Path = ARTIFACT_PATH,
    expected_sha256: str = EXPECTED_SHA256,
    db_path: Path | None = None,
) -> RSLOrchestrator:
    """Bangun instance RSLOrchestrator dengan artifact terverifikasi."""
    verify_artifact(artifact_path, expected_sha256)
    scheduler = EstimationScheduler(db_path=db_path) if db_path is not None else None
    return RSLOrchestrator(
        model_artifact_path=artifact_path,
        expected_model_sha256=expected_sha256,
        scheduler=scheduler,
        db_path=db_path,
        blocking_retry=False,
        max_validation_domain_h=DOMAIN_MAX_HOURS,
    )


def estimate(
    orchestrator: RSLOrchestrator,
    *,
    session_id: str,
    monitoring_start_at: str | None,
    current_timestamp: str | None = None,
    temp_c: float | None = None,
    humid_pct: float | None = None,
    esp32_connected: bool = True,
) -> dict[str, Any]:
    """Jalankan estimasi RSL V2.1 dengan force=True dan kembalikan payload gabungan."""
    session_data = {
        "session_id": session_id,
        "monitoring_start_at": monitoring_start_at,
        "current_timestamp": current_timestamp,
        "temp_c": temp_c,
        "humid_pct": humid_pct,
        "esp32_connected": esp32_connected,
    }
    raw = orchestrator.estimate_for_session(
        session_id=session_id,
        session_data=session_data,
        force=True,
    )
    presentation = to_consumer_presentation(raw)
    result = {**raw, **presentation}
    result["operational_prediction_authorized"] = False
    return result
