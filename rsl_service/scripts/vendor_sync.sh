#!/usr/bin/env bash
# Sinkronisasi vendor: menyalin subset minimal tofu_ml + artifact RSL V2.1 yang dibekukan.
#
# Sumber bersifat READ ONLY (satu arah: src -> vendor). Script ini idempotent:
# aman dijalankan berulang kali, selalu menimpa hasil salinan sebelumnya.
#
# Pemakaian:
#   bash rsl_service/scripts/vendor_sync.sh
#   TOFU_ML_SRC=/path/ke/tofu-ml/src/tofu_ml bash rsl_service/scripts/vendor_sync.sh
#
# Baris terakhir output adalah sha256 artifact (format `shasum -a 256`).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RSL_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$RSL_DIR")"

TOFU_ML_SRC="${TOFU_ML_SRC:-/Users/vino/Downloads/capstone/ML_FIX_CapstoneE01/tofu-ml/src/tofu_ml}"
TOFU_ML_REPO="$(dirname "$(dirname "$TOFU_ML_SRC")")"
ARTIFACT_SRC="${RSL_ARTIFACT_SRC:-$TOFU_ML_REPO/TOFUSENSE_AUTONOMOUS_RSL_V2/artifacts/m0_bayesian_weibull_primary_3u.json}"

EXPECTED_SHA256="5865af9ca9e8a85d677d6cc7fb9a91519ca0b5b96674dcddc67be0de8654c403"

VENDOR_DIR="$RSL_DIR/vendor/tofu_ml"
ARTIFACT_DEST="$RSL_DIR/artifacts/m0_bayesian_weibull_primary_3u.json"

# Path relatif terhadap root repo, supaya baris sha256 sama persis dari cwd mana pun.
ARTIFACT_REL="rsl_service/artifacts/m0_bayesian_weibull_primary_3u.json"

die() {
    echo "ERROR: $*" >&2
    exit 1
}

# macOS menyediakan `shasum -a 256`; Linux menyediakan `sha256sum`.
sha256_of() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | awk '{print $1}'
    else
        die "tidak menemukan sha256sum maupun shasum"
    fi
}

print_sha256_line() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1"
    else
        shasum -a 256 "$1"
    fi
}

[ -d "$TOFU_ML_SRC" ] || die "sumber tofu_ml tidak ditemukan: $TOFU_ML_SRC"
[ -f "$TOFU_ML_SRC/autonomous_rsl_v2/time_only_models.py" ] || die "modul hilang: autonomous_rsl_v2/time_only_models.py"
[ -f "$TOFU_ML_SRC/autonomous_rsl_v2_1/phase5_6_contract_and_protocol.py" ] || die "modul hilang: autonomous_rsl_v2_1/phase5_6_contract_and_protocol.py"
[ -d "$TOFU_ML_SRC/rsl_orchestration" ] || die "paket hilang: rsl_orchestration"
[ -f "$ARTIFACT_SRC" ] || die "artifact tidak ditemukan: $ARTIFACT_SRC"

mkdir -p \
    "$VENDOR_DIR/autonomous_rsl_v2" \
    "$VENDOR_DIR/autonomous_rsl_v2_1" \
    "$VENDOR_DIR/rsl_orchestration" \
    "$RSL_DIR/artifacts"

# --- __init__.py yang sengaja dikosongkan -------------------------------------
# Upstream autonomous_rsl_v2/__init__.py me-re-export plotting (butuh matplotlib) dan
# validation_and_audit (butuh tofu_ml.prospective_rsl_v1, tidak di-vendor). Karena
# `import tofu_ml.autonomous_rsl_v2.time_only_models` mengeksekusi __init__ paket,
# kedua __init__ diganti docstring kosong untuk runtime web.
cat > "$VENDOR_DIR/__init__.py" <<'PY'
"""Subset tofu_ml yang di-vendor untuk runtime RSL service TOSCHA."""
PY

cat > "$VENDOR_DIR/autonomous_rsl_v2/__init__.py" <<'PY'
"""Sengaja kosong untuk runtime web: lihat rsl_service/scripts/vendor_sync.sh."""

# Intentionally empty for the web runtime: upstream __init__ re-exports plotting
# (matplotlib) and validation modules that are not vendored.
PY

cat > "$VENDOR_DIR/autonomous_rsl_v2_1/__init__.py" <<'PY'
"""Sengaja kosong untuk runtime web: lihat rsl_service/scripts/vendor_sync.sh."""

# Intentionally empty for the web runtime: upstream __init__ re-exports plotting
# and audit modules that pull dependencies not vendored here.
PY

# --- salinan verbatim ---------------------------------------------------------
cp "$TOFU_ML_SRC/autonomous_rsl_v2/time_only_models.py" \
    "$VENDOR_DIR/autonomous_rsl_v2/time_only_models.py"

cp "$TOFU_ML_SRC/autonomous_rsl_v2_1/phase5_6_contract_and_protocol.py" \
    "$VENDOR_DIR/autonomous_rsl_v2_1/phase5_6_contract_and_protocol.py"

# 6 file: __init__.py, estimation_scheduler.py, estimation_state.py,
# presentation_adapter.py, recovery_manager.py, rsl_orchestrator.py
cp "$TOFU_ML_SRC/rsl_orchestration/"*.py "$VENDOR_DIR/rsl_orchestration/"

cp "$ARTIFACT_SRC" "$ARTIFACT_DEST"

# --- verifikasi fail-closed ---------------------------------------------------
cd "$REPO_ROOT"
actual_sha256="$(sha256_of "$ARTIFACT_REL")"
if [ "$actual_sha256" != "$EXPECTED_SHA256" ]; then
    die "artifact SHA-256 mismatch: $actual_sha256 != $EXPECTED_SHA256"
fi

echo "Vendor tersinkron dari: $TOFU_ML_SRC"
print_sha256_line "$ARTIFACT_REL"
