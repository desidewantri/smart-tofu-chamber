from pathlib import Path

import pytest

from engine import ARTIFACT_PATH, EXPECTED_SHA256, ArtifactIntegrityError, sha256_file, verify_artifact


def test_artifact_sha_matches_frozen_value():
    assert sha256_file(ARTIFACT_PATH) == EXPECTED_SHA256
    assert EXPECTED_SHA256 == "5865af9ca9e8a85d677d6cc7fb9a91519ca0b5b96674dcddc67be0de8654c403"


def test_verify_artifact_rejects_mismatch():
    with pytest.raises(ArtifactIntegrityError):
        verify_artifact(ARTIFACT_PATH, "0" * 64)


def test_verify_artifact_accepts_match():
    verify_artifact(ARTIFACT_PATH, EXPECTED_SHA256)
