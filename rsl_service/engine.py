"""RSL V2.1 inference service TOSCHA.

Modul ini adalah pintu masuk runtime web untuk model riset yang dibekukan
(RSL V2.1, Bayesian Weibull). Tahap ini hanya memuat verifikasi integritas
artifact: artifact yang tidak cocok dengan SHA-256 yang dibekukan harus
menggagalkan proses, bukan diam-diam dipakai.
"""

from __future__ import annotations

import hashlib
import os
from pathlib import Path

ARTIFACT_PATH: Path = (
    Path(__file__).resolve().parent / "artifacts" / "m0_bayesian_weibull_primary_3u.json"
)

# Nilai beku RSL V2.1. Override lewat env hanya untuk kebutuhan operasional
# (mis. memutar ulang artifact lain di lingkungan uji), bukan untuk fallback diam-diam.
EXPECTED_SHA256: str = os.environ.get(
    "RSL_EXPECTED_SHA256",
    "5865af9ca9e8a85d677d6cc7fb9a91519ca0b5b96674dcddc67be0de8654c403",
)

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
