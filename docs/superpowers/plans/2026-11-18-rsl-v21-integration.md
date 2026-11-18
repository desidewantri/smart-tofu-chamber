# Integrasi RSL V2.1 ke Web TOSCHA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web TOSCHA menampilkan estimasi sisa umur simpan dari model penelitian V2.1 (Bayesian Weibull, time-only) menggantikan angka mock, tanpa pernah memvonis keamanan pangan.

**Architecture:** Service Python baru (`rsl_service/`, FastAPI, container `rsl`) membungkus `RSLOrchestrator.estimate_for_session(force=True)` + `to_consumer_presentation()`. Backend Node memanggilnya setiap reading masuk (`RSL_MODE=live`), lalu menyimpan median/PI80/domain ke Mongo; frontend membaca API yang sudah ada dan merender tiga keadaan (in-domain / di luar domain / menyiapkan).

**Tech Stack:** Python 3.11 + FastAPI + uvicorn + numpy + scipy (vendor `tofu_ml`), Node 18 + Express + Mongoose (`node --test`), Next.js 14 + Recharts, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-11-18-rsl-v21-integration-design.md`

## Global Constraints

- Domain valid `0.25`–`42.8888` jam. `elapsed < 0.25` → `WAITING_FOR_DATA`, median `null`. `elapsed > 42.8888` → `PROCESSING_FAILED`, `failure_category=OUT_OF_DOMAIN`, median `null`. `elapsed == 42.8888` → `AT_BOUNDARY` (masih di dalam domain).
- `operational_prediction_authorized` **selalu** `false`. UI tidak boleh menampilkan vonis keamanan pangan.
- `POST /estimate` **wajib** `force=True`.
- `prediksiDibuat` di Mongo = `last_calculated_at` dari respons service, bukan `now`.
- `shelfLifeAwal = null` (bukan `0`) saat `OUT_OF_DOMAIN`.
- Artifact `m0_bayesian_weibull_primary_3u.json`, SHA-256 `5865af9ca9e8a85d677d6cc7fb9a91519ca0b5b96674dcddc67be0de8654c403`. SHA tidak cocok → container gagal start.
- TVOC/suhu/RH hanya untuk tampilan; tidak dikirim sebagai fitur model.
- Jangan ubah isi `TOFUSENSE_AUTONOMOUS_RSL_V2/` dan `TOFUSENSE_AUTONOMOUS_RSL_V2_1/`. Jangan pakai `smartchamber/`, `processed_rul/`, `TOFUSENSE_V5..V7`, `FINAL_RESEARCH_RELEASE`.
- Backend env: `RSL_MODE=off|live` (default `off`), `RSL_SERVICE_URL` (default `http://127.0.0.1:8001`), `RSL_TIMEOUT_MS=4000`.
- Notifier WhatsApp (`notifierService.js`) **tidak diubah**.
- Frontend: tanpa dependency npm baru. Bahasa UI Indonesia.
- Tidak ada teks `Layak Konsumsi` / `Segera Konsumsi` / `Tidak Layak Konsumsi` pada kartu chamber dan grafik dasbor.

## Review Focus

1. **Timestamp tidak valid / mundur** (clock skew alat, impor Sheet dengan `seenAt` lampau): orchestrator balas `ACTION_REQUIRED`. Reading tetap tersimpan, `prediksiDibuat` tidak mundur, estimasi tidak ditampilkan (fail-closed), UI tidak crash. → tes di Task 3, Task 5, Task 6.
2. **Sesi > 42,8888 jam** (mayoritas data asli): tidak boleh muncul angka `0` atau timer "Habis" yang menyamar sebagai estimasi. → tes di Task 6, Task 9.
3. **`research_display_eligible=false` walau median ada**: angka tidak boleh ditampilkan. → tes di Task 5.
4. **Service mati/timeout saat ingest**: reading tetap tersimpan, `readingCount` naik, estimasi lama tidak dihapus. → tes di Task 5, Task 6.
5. **Sesi legacy masih punya `shelfLifeAwal` numerik**: UI harus menyembunyikan angka meski `sisaDetik` tidak null. → tes di Task 9 (aturan render) dan Task 11 (Riwayat).

---

### Task 1: Vendor model + pemeriksaan SHA artifact (fail-closed)

**Files:**
- Create: `rsl_service/scripts/vendor_sync.sh`
- Create: `rsl_service/vendor/tofu_ml/__init__.py` (kosong)
- Create: `rsl_service/vendor/tofu_ml/autonomous_rsl_v2/__init__.py` (docstring kosong, **tanpa** re-export)
- Create: `rsl_service/vendor/tofu_ml/autonomous_rsl_v2/time_only_models.py` (salin verbatim)
- Create: `rsl_service/vendor/tofu_ml/autonomous_rsl_v2_1/__init__.py` (docstring kosong, **tanpa** re-export)
- Create: `rsl_service/vendor/tofu_ml/autonomous_rsl_v2_1/phase5_6_contract_and_protocol.py` (salin verbatim)
- Create: `rsl_service/vendor/tofu_ml/rsl_orchestration/` (6 file, salin verbatim)
- Create: `rsl_service/artifacts/m0_bayesian_weibull_primary_3u.json` (salin verbatim)
- Create: `rsl_service/engine.py`
- Create: `rsl_service/pytest.ini` (`[pytest]` + `pythonpath = . vendor` + `testpaths = tests`)
- Create: `rsl_service/requirements.txt`, `rsl_service/requirements-dev.txt`
- Test: `rsl_service/tests/test_artifact.py`

**Interfaces:**
- Produces: `class ArtifactIntegrityError(RuntimeError)`, `sha256_file(path: Path) -> str`, `verify_artifact(path: Path, expected_sha256: str) -> None`, konstanta `EXPECTED_SHA256: str`, `ARTIFACT_PATH: Path`.

- [ ] **Step 1: Tulis script vendor**

`rsl_service/scripts/vendor_sync.sh` — menyalin dari `$TOFU_ML_SRC` (default `/Users/vino/Downloads/capstone/ML_FIX_CapstoneE01/tofu-ml/src/tofu_ml`) ke `rsl_service/vendor/tofu_ml`, menimpa `__init__.py` dua paket autonomous dengan docstring kosong (agar tidak menarik `matplotlib`/`prospective_rsl_v1`), menyalin artifact, lalu mencetak `sha256sum` artifact.

- [ ] **Step 2: Jalankan script, pastikan artifact cocok**

Run: `bash rsl_service/scripts/vendor_sync.sh`
Expected: baris terakhir `5865af9ca9e8a85d677d6cc7fb9a91519ca0b5b96674dcddc67be0de8654c403  rsl_service/artifacts/m0_bayesian_weibull_primary_3u.json`

- [ ] **Step 3: Tulis tes yang gagal**

```python
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
```

- [ ] **Step 4: Jalankan tes, pastikan gagal**

Run: `cd rsl_service && python -m pytest tests/test_artifact.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'engine'`

- [ ] **Step 5: Implementasi `rsl_service/engine.py`**

`sha256_file` membaca file dalam chunk 1 MiB. `verify_artifact` membandingkan case-insensitive dan melempar `ArtifactIntegrityError(f"Artifact SHA-256 mismatch: {actual} != {expected}")`. `ARTIFACT_PATH = Path(__file__).resolve().parent / "artifacts" / "m0_bayesian_weibull_primary_3u.json"`. `EXPECTED_SHA256` dibaca dari `os.environ.get("RSL_EXPECTED_SHA256", "<sha di atas>")`.

- [ ] **Step 6: Jalankan tes, pastikan lulus**

Run: `cd rsl_service && python -m pytest tests/test_artifact.py -v`
Expected: PASS (3 tes)

- [ ] **Step 7: Commit**

```bash
git add rsl_service
git commit -m "feat(rsl): vendor model V2.1 + verifikasi SHA artifact fail-closed"
```

---

### Task 2: `engine.build_orchestrator` + `engine.estimate` (force=True)

**Files:**
- Modify: `rsl_service/engine.py`
- Test: `rsl_service/tests/test_estimate.py`

**Interfaces:**
- Consumes: `RSLOrchestrator`, `to_consumer_presentation`, `EstimationScheduler` dari vendor.
- Produces:
  - `build_orchestrator(*, artifact_path: Path, expected_sha256: str, db_path: Path | None) -> RSLOrchestrator`
  - `estimate(orchestrator: RSLOrchestrator, *, session_id: str, monitoring_start_at: str | None, current_timestamp: str | None = None, temp_c: float | None = None, humid_pct: float | None = None, esp32_connected: bool = True) -> dict`
  - `estimate` mengembalikan `{**raw_response, **presentation}`, dengan jaminan `operational_prediction_authorized is False`.

- [ ] **Step 1: Tulis tes domain + force + kontrak**

```python
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
    r = at(orch, 42.8888)
    assert r["domain_status"] == "AT_BOUNDARY"
    assert r["estimate"]["median_rsl_hours"] is not None

def test_beyond_domain_hides_number(orch):
    r = at(orch, 42.8889)
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
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd rsl_service && python -m pytest tests/test_estimate.py -v`
Expected: FAIL — `ImportError: cannot import name 'build_orchestrator'`

- [ ] **Step 3: Implementasi di `engine.py`**

`build_orchestrator` memanggil `verify_artifact` lalu mengembalikan `RSLOrchestrator(model_artifact_path=..., expected_model_sha256=..., scheduler=EstimationScheduler(db_path=db_path), db_path=db_path, blocking_retry=False, max_validation_domain_h=42.8888)`. `estimate` menyusun `session_data` dari argumen (hanya `session_id`, `monitoring_start_at`, `current_timestamp`, `temp_c`, `humid_pct`, `esp32_connected`), memanggil `estimate_for_session(..., force=True)`, lalu `return {**raw, **to_consumer_presentation(raw)}`.

- [ ] **Step 4: Jalankan tes, pastikan lulus**

Run: `cd rsl_service && python -m pytest tests/test_estimate.py -v`
Expected: PASS (7 tes)

- [ ] **Step 5: Commit**

```bash
git add rsl_service/engine.py rsl_service/tests/test_estimate.py
git commit -m "feat(rsl): pembungkus orchestrator dengan force=True + presentasi Indonesia"
```

---

### Task 3: Service FastAPI (`/health`, `/estimate`) + image

**Files:**
- Create: `rsl_service/app.py`
- Create: `rsl_service/Dockerfile`
- Create: `rsl_service/.dockerignore`
- Test: `rsl_service/tests/test_app.py`

**Interfaces:**
- Consumes: `build_orchestrator`, `estimate`, `ARTIFACT_PATH`, `EXPECTED_SHA256` dari Task 1–2.
- Produces:
  - `create_app(*, artifact_path: Path = ARTIFACT_PATH, expected_sha256: str = EXPECTED_SHA256, db_path: Path | None = None, orchestrator=None) -> FastAPI`
  - `GET /health` → `{"ok": true, "model_artifact_id": "<nama>:<sha12>", "sha256": "<sha penuh>", "domain_max_hours": 42.8888}`
  - `POST /estimate` → 200 respons Task 2; tipe field salah (`session_id` kosong, `temp_c` string) → 400 `{"error": {"code": "INVALID_REQUEST", "message": "..."}}`; timestamp hilang/invalid tetap 200 dengan `application_state: "ACTION_REQUIRED"`.
  - `app = create_app()` di module level (verifikasi SHA saat import → container exit bila salah).

- [ ] **Step 1: Tulis tes yang gagal**

```python
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
    assert body["domain_max_hours"] == 42.8888

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
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd rsl_service && python -m pytest tests/test_app.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'app'`

- [ ] **Step 3: Implementasi `app.py`**

Validasi body: `session_id` string non-kosong; `monitoring_start_at`/`current_timestamp` **tidak** divalidasi format di sini — teruskan apa adanya ke orchestrator agar timestamp hilang/invalid menghasilkan `ACTION_REQUIRED` (bukan HTTP error), sesuai spec §9. `temp_c`/`humid_pct` opsional `int|float` (bukan bool), `esp32_connected` opsional bool; tipe salah → `HTTPException(400, {"error": {...}})`. Semua panggilan `estimate` dijalankan di `run_in_threadpool` agar tidak memblokir event loop. `/health` membaca `sha256_file(artifact_path)`.

- [ ] **Step 4: Jalankan tes, pastikan lulus**

Run: `cd rsl_service && python -m pytest tests/test_app.py -v`
Expected: PASS (5 tes)

- [ ] **Step 5: Tulis Dockerfile**

`python:3.11-slim`, `PYTHONPATH=/app/vendor`, `pip install --no-cache-dir -r requirements.txt`, copy `vendor/`, `artifacts/`, `app.py`, `engine.py`; `ENV RSL_DB_PATH=/data/consumer_runtime.sqlite`; `CMD ["uvicorn","app:app","--host","0.0.0.0","--port","8001"]`.

- [ ] **Step 6: Build image lokal, pastikan start**

Run: `docker build -t toscha-rsl:local rsl_service && docker run --rm -d --name rsl-smoke -p 18001:8001 toscha-rsl:local && sleep 3 && curl -s localhost:18001/health && docker rm -f rsl-smoke`
Expected: JSON `{"ok":true,...,"sha256":"5865af9c..."}`

- [ ] **Step 7: Commit**

```bash
git add rsl_service/app.py rsl_service/Dockerfile rsl_service/.dockerignore rsl_service/tests/test_app.py
git commit -m "feat(rsl): service FastAPI /health + /estimate"
```

---

### Task 4: Backend env + klien `rsl`

**Files:**
- Modify: `backend/src/config/env.js`
- Create: `backend/src/services/rslClient.js`
- Test: `backend/tests/rslClient.test.js`

**Interfaces:**
- Produces:
  - `env.rsl = { mode: 'off'|'live', url: string, timeoutMs: number }`
  - `createRslClient({ url, timeoutMs, fetchImpl = fetch }) -> { estimate(input): Promise<RslEstimate> }`
  - `RslEstimate = { applicationState, domainStatus, failureCategory, researchDisplayEligible, medianRslHours, pi80LowerHours, pi80UpperHours, lastCalculatedAt: Date|null, headline, disclaimer, raw }`
  - `estimate(input)` dengan `input = { sessionId, startAt: Date, now: Date, tempC?, humidPct?, connected? }`
  - Modul juga mengekspor `estimate` yang memakai `env.rsl`.

- [ ] **Step 1: Tulis tes yang gagal**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRslClient } = require('../src/services/rslClient');

const okBody = {
  session_id: 's1', application_state: 'ESTIMATE_AVAILABLE', domain_status: 'WITHIN_DOMAIN',
  failure_category: 'NONE', research_display_eligible: true,
  estimate: { median_rsl_hours: 31.4567, pi80_lower_hours: 28.1, pi80_upper_hours: 35.0 },
  last_calculated_at: '2026-11-18T03:00:02+00:00',
  headline_id: 'Perkiraan sisa waktu pemantauan (estimasi riset): sekitar 31.5 jam.',
  research_disclaimer_id: 'Perkiraan ini dihasilkan berdasarkan model penelitian TofuSense.',
  operational_prediction_authorized: false,
};

const client = (impl) => createRslClient({ url: 'http://rsl:8001', timeoutMs: 1000, fetchImpl: impl });

test('memetakan respons rsl ke bentuk camelCase', async () => {
  const res = await client(async () => new Response(JSON.stringify(okBody), { status: 200 })).estimate({
    sessionId: 's1', startAt: new Date('2026-11-18T01:00:00Z'), now: new Date('2026-11-18T03:00:00Z'),
  });
  assert.equal(res.medianRslHours, 31.4567);
  assert.equal(res.domainStatus, 'WITHIN_DOMAIN');
  assert.equal(res.lastCalculatedAt.toISOString(), '2026-11-18T03:00:02.000Z');
});

test('mengirim monitoring_start_at tanpa fitur sensor', async () => {
  let sent;
  await client(async (_url, opts) => { sent = JSON.parse(opts.body); return new Response(JSON.stringify(okBody), { status: 200 }); })
    .estimate({ sessionId: 's1', startAt: new Date('2026-11-18T01:00:00Z'), now: new Date('2026-11-18T03:00:00Z'), tempC: 27.4 });
  assert.equal(sent.monitoring_start_at, '2026-11-18T01:00:00.000Z');
  assert.equal(sent.temp_c, 27.4);
  assert.equal(sent.tvoc, undefined);
  assert.equal(sent.suhu, undefined);
  assert.equal(sent.rh, undefined);
});

test('menolak HTTP 500', async () => {
  await assert.rejects(
    client(async () => new Response('boom', { status: 500 })).estimate({ sessionId: 's1', startAt: new Date(), now: new Date() }),
    /rsl/i
  );
});

test('menolak body tanpa estimate', async () => {
  await assert.rejects(
    client(async () => new Response(JSON.stringify({ application_state: 'X' }), { status: 200 })).estimate({ sessionId: 's1', startAt: new Date(), now: new Date() }),
    /rsl/i
  );
});

test('last_calculated_at null tetap null', async () => {
  const body = { ...okBody, last_calculated_at: null };
  const res = await client(async () => new Response(JSON.stringify(body), { status: 200 })).estimate({ sessionId: 's1', startAt: new Date(), now: new Date() });
  assert.equal(res.lastCalculatedAt, null);
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd backend && node --test tests/rslClient.test.js`
Expected: FAIL — `Cannot find module '../src/services/rslClient'`

- [ ] **Step 3: Implementasi `rslClient.js` + env**

`fetch(`${url}/estimate`, { method: 'POST', headers: {'Content-Type':'application/json'}, body, signal: AbortSignal.timeout(timeoutMs) })`. Body **hanya** berisi `session_id`, `monitoring_start_at`, `current_timestamp`, `temp_c`, `humid_pct`, `esp32_connected` — tanpa TVOC/suhu/RH sebagai fitur. `force=True` ditegakkan di sisi service (Task 3), bukan dikirim klien. Error non-2xx → `throw new Error(\`rsl service membalas HTTP ${status}\`)`; body tanpa `estimate` objek → `throw new Error('Respons rsl tidak valid')`. `env.js` menambah blok `rsl` mengikuti Global Constraints.

- [ ] **Step 4: Jalankan tes, pastikan lulus**

Run: `cd backend && node --test tests/rslClient.test.js`
Expected: PASS (5 tes)

- [ ] **Step 5: Commit**

```bash
git add backend/src/config/env.js backend/src/services/rslClient.js backend/tests/rslClient.test.js
git commit -m "feat(backend): klien rsl + konfigurasi RSL_MODE"
```

---

### Task 5: Cabang `live` di `predictionService`

**Files:**
- Modify: `backend/src/services/predictionService.js`
- Create: `backend/src/utils/rslMapping.js`
- Test: `backend/tests/predictionRsl.test.js`
- Test: `backend/tests/rslMapping.test.js`

**Interfaces:**
- Consumes: `rslClient.estimate` (Task 4).
- Produces:
  - `predictRsl(input, client = rslClient) -> Promise<{ shelfLifeJam: number|null, modelUsed: 'v21_weibull', source: 'live', rslDomain: 'IN_DOMAIN'|'OUT_OF_DOMAIN'|null, rslState: string, rslPi80Low: number|null, rslPi80High: number|null, rslCalculatedAt: Date|null }>`
  - `input = { sessionMongoId: string, monitoringStartAt: Date, currentTimestamp: Date, tempC?: number, humidPct?: number, connected?: boolean }`
  - `predict(input, mode)` memilih jalur rsl bila `env.rsl.mode === 'live'`.
  - `RSL_DOMAIN = { IN: 'IN_DOMAIN', OUT: 'OUT_OF_DOMAIN', LEGACY: 'LEGACY' }`
  - `deriveRslDomain({ domainStatus, failureCategory }) -> 'IN_DOMAIN'|'OUT_OF_DOMAIN'|null`
  - `rslCalculatedAt` = `lastCalculatedAt` dari klien (nama field Mongo, lihat Task 6).

- [ ] **Step 1: Tulis tes yang gagal**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { predictRsl } = require('../src/services/predictionService');

const input = {
  sessionMongoId: '6aecf045b815042fcde98792',
  monitoringStartAt: new Date('2026-11-18T01:00:00Z'),
  currentTimestamp: new Date('2026-11-18T03:00:00Z'),
  tempC: 27.4, humidPct: 78.9, connected: true,
};
const fake = (over) => ({ estimate: async () => ({
  applicationState: 'ESTIMATE_AVAILABLE', domainStatus: 'WITHIN_DOMAIN', failureCategory: 'NONE',
  researchDisplayEligible: true, medianRslHours: 31.4567, pi80LowerHours: 28.1, pi80UpperHours: 35,
  lastCalculatedAt: new Date('2026-11-18T03:00:02Z'), ...over,
}) });

test('in-domain memakai median', async () => {
  const r = await predictRsl(input, fake());
  assert.equal(r.shelfLifeJam, 31.46);
  assert.equal(r.rslDomain, 'IN_DOMAIN');
  assert.equal(r.modelUsed, 'v21_weibull');
  assert.equal(r.source, 'live');
});

test('di luar domain -> null, bukan 0', async () => {
  const r = await predictRsl(input, fake({ domainStatus: 'BEYOND_DOMAIN', failureCategory: 'OUT_OF_DOMAIN', researchDisplayEligible: false, medianRslHours: null, pi80LowerHours: null, pi80UpperHours: null }));
  assert.equal(r.shelfLifeJam, null);
  assert.equal(r.rslDomain, 'OUT_OF_DOMAIN');
});

test('belum cukup data -> null, domain null', async () => {
  const r = await predictRsl(input, fake({ applicationState: 'WAITING_FOR_DATA', failureCategory: 'INSUFFICIENT_EVIDENCE', researchDisplayEligible: false, medianRslHours: null }));
  assert.equal(r.shelfLifeJam, null);
  assert.equal(r.rslDomain, null);
  assert.equal(r.rslState, 'WAITING_FOR_DATA');
});

test('median ada tapi display tidak eligible -> angka disembunyikan', async () => {
  const r = await predictRsl(input, fake({ researchDisplayEligible: false }));
  assert.equal(r.shelfLifeJam, null);
});

test('error service diteruskan sebagai error', async () => {
  await assert.rejects(predictRsl(input, { estimate: async () => { throw new Error('timeout'); } }), /timeout/);
});
```

`backend/tests/rslMapping.test.js`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { RSL_DOMAIN, deriveRslDomain } = require('../src/utils/rslMapping');

test('deriveRslDomain: dalam domain termasuk AT_BOUNDARY', () => {
  assert.equal(deriveRslDomain({ domainStatus: 'WITHIN_DOMAIN', failureCategory: 'NONE' }), RSL_DOMAIN.IN);
  assert.equal(deriveRslDomain({ domainStatus: 'AT_BOUNDARY', failureCategory: 'NONE' }), RSL_DOMAIN.IN);
  assert.equal(deriveRslDomain({ domainStatus: 'BEYOND_DOMAIN', failureCategory: 'OUT_OF_DOMAIN' }), RSL_DOMAIN.OUT);
  assert.equal(deriveRslDomain({ domainStatus: 'INVALID_ELAPSED_TIME', failureCategory: 'INPUT_TIMESTAMP' }), null);
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd backend && node --test tests/predictionRsl.test.js`
Expected: FAIL — `predictRsl is not a function`

- [ ] **Step 3: Tulis `rslMapping.js` (domain) lalu sambungkan `predictRsl`**

`rslMapping.js` berisi `RSL_DOMAIN` + `deriveRslDomain` (aturan: `failureCategory === 'OUT_OF_DOMAIN'` → `OUT`; `domainStatus` `WITHIN_DOMAIN`/`AT_BOUNDARY` → `IN`; selain itu `null`). `predictRsl` memanggil `client.estimate({ sessionId: input.sessionMongoId, startAt: input.monitoringStartAt, now: input.currentTimestamp, tempC: input.tempC, humidPct: input.humidPct, connected: input.connected })`, lalu memetakan: `shelfLifeJam = res.researchDisplayEligible && Number.isFinite(res.medianRslHours) ? Math.round(res.medianRslHours*100)/100 : null`; `rslDomain = deriveRslDomain(res)`; `rslState = res.applicationState`; `rslCalculatedAt = res.lastCalculatedAt`.

- [ ] **Step 4: Jalankan tes, pastikan lulus**

Run: `cd backend && node --test tests/rslMapping.test.js tests/predictionRsl.test.js`
Expected: PASS (2 + 5 tes)

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/predictionService.js backend/src/utils/rslMapping.js backend/tests/predictionRsl.test.js backend/tests/rslMapping.test.js
git commit -m "feat(backend): prediksi RSL V2.1 (time-only) di predictionService"
```

---

### Task 6: Skema Mongo + `rslMapping` + persistensi di `ingestService`

**Files:**
- Modify: `backend/src/models/Session.js`
- Modify: `backend/src/models/Prediction.js`
- Modify: `backend/src/utils/rslMapping.js`
- Modify: `backend/src/services/ingestService.js`
- Test: `backend/tests/rslMapping.test.js`

**Interfaces:**
- Consumes: keluaran `predictRsl` (Task 5).
- Produces:
  - `sessionRslFields(result, { previous }) -> { shelfLifeAwal, prediksiDibuat, modelUsed, rslDomain, rslState, rslPi80Low, rslPi80High, rslCalculatedAt }`
  - Field baru `Session`: `rslDomain` (enum `IN_DOMAIN|OUT_OF_DOMAIN|LEGACY`, default null), `rslState` (String, default null), `rslPi80Low`, `rslPi80High` (Number, default null), `rslCalculatedAt` (Date, default null), `legacy` (Boolean, default false).
  - `Prediction.modelUsed` enum: tambah `v21_weibull`, `mock_legacy`.

- [ ] **Step 1: Tulis tes yang gagal**

Tambahkan ke `backend/tests/rslMapping.test.js`:

```js
const { sessionRslFields } = require('../src/utils/rslMapping');

const calc = new Date('2026-11-18T03:00:02Z');

test('in-domain: prediksiDibuat dari last_calculated_at', () => {
  const f = sessionRslFields({ shelfLifeJam: 31.4567, rslDomain: RSL_DOMAIN.IN, rslState: 'ESTIMATE_AVAILABLE',
    rslPi80Low: 28.1, rslPi80High: 35, rslCalculatedAt: calc }, { previous: { prediksiDibuat: new Date('2020-01-01') } });
  assert.equal(f.shelfLifeAwal, 31.46);
  assert.equal(f.prediksiDibuat.toISOString(), calc.toISOString());
  assert.equal(f.modelUsed, 'v21_weibull');
  assert.equal(f.rslDomain, RSL_DOMAIN.IN);
});

test('out-of-domain: shelfLifeAwal null, bukan 0', () => {
  const f = sessionRslFields({ shelfLifeJam: null, rslDomain: RSL_DOMAIN.OUT, rslState: 'PROCESSING_FAILED',
    rslPi80Low: null, rslPi80High: null, rslCalculatedAt: calc }, { previous: {} });
  assert.equal(f.shelfLifeAwal, null);
  assert.notEqual(f.shelfLifeAwal, 0);
  assert.equal(f.rslDomain, RSL_DOMAIN.OUT);
});

test('belum ada estimasi: prediksiDibuat lama dipertahankan', () => {
  const prev = new Date('2026-11-18T02:00:00Z');
  const f = sessionRslFields({ shelfLifeJam: null, rslDomain: null, rslState: 'WAITING_FOR_DATA',
    rslPi80Low: null, rslPi80High: null, rslCalculatedAt: null }, { previous: { prediksiDibuat: prev } });
  assert.equal(f.shelfLifeAwal, null);
  assert.equal(f.prediksiDibuat.toISOString(), prev.toISOString());
});

test('timestamp tidak valid: prediksiDibuat tidak mundur, angka disembunyikan', () => {
  const prev = new Date('2026-11-18T02:00:00Z');
  const f = sessionRslFields({ shelfLifeJam: null, rslDomain: null, rslState: 'ACTION_REQUIRED',
    rslPi80Low: null, rslPi80High: null, rslCalculatedAt: null }, { previous: { prediksiDibuat: prev } });
  assert.equal(f.shelfLifeAwal, null);
  assert.equal(f.prediksiDibuat.toISOString(), prev.toISOString());
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd backend && node --test tests/rslMapping.test.js`
Expected: FAIL — `sessionRslFields is not a function`

- [ ] **Step 3: Tambahkan `sessionRslFields` ke `rslMapping.js` + field skema**

`sessionRslFields` membulatkan `shelfLifeAwal` 2 desimal hanya bila `rslDomain === 'IN_DOMAIN'` dan `Number.isFinite(shelfLifeJam)`; `prediksiDibuat = result.rslCalculatedAt ?? previous.prediksiDibuat ?? null`. Tambahkan field skema sesuai Interfaces.

- [ ] **Step 4: Jalankan tes, pastikan lulus**

Run: `cd backend && node --test tests/rslMapping.test.js`
Expected: PASS (5 tes)

- [ ] **Step 5: Sambungkan `ingestService`**

Pada blok `try` (baris ~145): tambahkan `sessionMongoId: String(session._id)`, `monitoringStartAt: session.masuk`, `currentTimestamp: data.timestamp`, `tempC: data.suhu`, `humidPct: data.rh`, `connected: true` ke input `predictionService.predict`. Ganti blok penyimpanan (baris ~156–178) menjadi: `const fields = result.source === 'live' ? sessionRslFields(result, { previous: session }) : { shelfLifeAwal: result.shelfLifeJam, prediksiDibuat: now, modelUsed: result.modelUsed };` — buat `Prediction` **hanya bila** `fields.shelfLifeAwal !== null` (dengan `shelfLifeJam: fields.shelfLifeAwal`, `prediksiDibuat: fields.prediksiDibuat`); update `Session` dengan `{ ...fields, readingCount: nT }` dan `shelfLifeMulai` hanya bila masih null dan `fields.shelfLifeAwal !== null`.

- [ ] **Step 6: Jalankan seluruh tes backend**

Run: `cd backend && node --test`
Expected: PASS semua (tes lama tidak berubah)

- [ ] **Step 7: Commit**

```bash
git add backend/src/models backend/src/utils/rslMapping.js backend/src/services/ingestService.js backend/tests/rslMapping.test.js
git commit -m "feat(backend): simpan domain/PI80/prediksiDibuat dari respons RSL"
```

---

### Task 7: Presenter netral + notifikasi netral

**Files:**
- Modify: `backend/src/utils/presenters.js`
- Modify: `backend/src/controllers/dashboardController.js:88-120`
- Test: `backend/tests/presenters.test.js`

**Interfaces:**
- Produces: `sessionView(doc, zones, now, { neutralStatus = env.rsl.mode === 'live' } = {})` dengan field tambahan `rslDomain`, `rslState`, `rslPi80` (`{low, high}|null`), `legacy` (Boolean). Saat `neutralStatus` true → `statusLayak` selalu `null`.

- [ ] **Step 1: Tulis tes yang gagal**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { sessionView } = require('../src/utils/presenters');

const doc = { _id: 'x', sesiCode: 'CH-013', chamberId: 1, status: 'aktif', masuk: new Date('2026-11-18T01:00:00Z'),
  shelfLifeAwal: 31.46, prediksiDibuat: new Date('2026-11-18T03:00:00Z'), rslDomain: 'IN_DOMAIN',
  rslState: 'ESTIMATE_AVAILABLE', rslPi80Low: 28.1, rslPi80High: 35, legacy: false };

test('statusLayak dinetralkan saat neutralStatus', () => {
  const v = sessionView(doc, { segarHours: 24, rawanHours: 8 }, new Date('2026-11-18T03:00:00Z').getTime(), { neutralStatus: true });
  assert.equal(v.statusLayak, null);
  assert.equal(v.rslDomain, 'IN_DOMAIN');
  assert.deepEqual(v.rslPi80, { low: 28.1, high: 35 });
  assert.equal(v.legacy, false);
});

test('statusLayak tetap dihitung saat tidak netral', () => {
  const v = sessionView(doc, { segarHours: 24, rawanHours: 8 }, new Date('2026-11-18T03:00:00Z').getTime(), { neutralStatus: false });
  assert.equal(v.statusLayak, 'Layak Konsumsi');
});

test('sesi legacy ditandai', () => {
  const v = sessionView({ ...doc, legacy: true, rslDomain: 'LEGACY' }, undefined, Date.now(), { neutralStatus: true });
  assert.equal(v.legacy, true);
  assert.equal(v.rslDomain, 'LEGACY');
});
```

- [ ] **Step 2: Jalankan tes, pastikan gagal**

Run: `cd backend && node --test tests/presenters.test.js`
Expected: FAIL — `v.rslDomain` undefined

- [ ] **Step 3: Implementasi presenter**

Tambahkan opsi ke-4 dan field baru. Import `env` di `presenters.js` hanya untuk nilai default.

- [ ] **Step 4: Netralkan judul notifikasi**

Di `dashboardController.js`, hitung `const research = env.rsl.mode === 'live';` lalu ganti judul: `research ? \`${label} — estimasi riset sisa < ${settings.zones.rawanHours} jam\` : \`${label} Tidak Layak Konsumsi\``, dan pasangan `Segera` menjadi `research ? \`${label} — estimasi riset sisa < ${settings.zones.segarHours} jam\` : ...`. Pesan disesuaikan: `research ? \`Perkiraan riset untuk ${s.sesiCode}; bukan jaminan keamanan pangan.\` : pesan lama`.

- [ ] **Step 5: Jalankan seluruh tes backend**

Run: `cd backend && node --test`
Expected: PASS semua

- [ ] **Step 6: Commit**

```bash
git add backend/src/utils/presenters.js backend/src/controllers/dashboardController.js backend/tests/presenters.test.js
git commit -m "feat(backend): netralkan statusLayak + judul notifikasi pada mode riset"
```

---

### Task 8: Migrasi sesi lama → arsip model lama

**Files:**
- Create: `backend/scripts/migrate-legacy-rsl.js`
- Modify: `backend/package.json` (script `migrate:legacy`)

**Interfaces:**
- Produces: `node scripts/migrate-legacy-rsl.js --dry-run|--apply` — idempoten. `--dry-run` hanya mencetak jumlah; `--apply` menulis.

- [ ] **Step 1: Tulis script**

Seleksi sesi: `{ modelUsed: { $ne: 'v21_weibull' }, rslDomain: { $in: [null, undefined] } }`. Untuk setiap sesi: `$set: { legacy: true, rslDomain: 'LEGACY' }`; prediksi dengan `sesiId: { $in: ids }` → `$set: { modelUsed: 'mock_legacy' }`. Cetak `{ sessions, predictions, mode }`. Koneksi memakai `env.mongoUri` + `serverSelectionTimeoutMS: 5000`, lalu `mongoose.disconnect()`.

- [ ] **Step 2: Uji idempotensi di lokal (Mongo dev)**

Run: `cd backend && node scripts/migrate-legacy-rsl.js --dry-run`
Expected: `{ mode: 'dry-run', sessions: <n>, predictions: <m> }` tanpa error

- [ ] **Step 3: Uji `--apply` dua kali**

Run: `node scripts/migrate-legacy-rsl.js --apply` lalu ulangi
Expected: run pertama `sessions > 0`; run kedua `sessions: 0, predictions: 0`

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/migrate-legacy-rsl.js backend/package.json
git commit -m "feat(backend): migrasi sesi lama ke arsip model lama (mock_legacy)"
```

---

### Task 9: Frontend — flag + kartu chamber tiga keadaan

**Files:**
- Modify: `frontend/src/lib/features.js`
- Create: `frontend/src/components/dashboard/EstimateState.jsx`
- Modify: `frontend/src/components/dashboard/ChamberCard.jsx:69-73`
- Modify: `frontend/src/components/dashboard/ShelfLifeTimer.jsx`

**Interfaces:**
- Produces:
  - `features.js`: `export const RESEARCH_RSL_MODE = true;` `export const SHOW_COST_BENEFIT = true;`
  - `EstimateState({ session, seconds, textClass })` merender salah satu dari empat keadaan (lihat tabel) + baris disclaimer. Tidak pernah merender angka bila `session.legacy` atau `session.rslDomain === 'OUT_OF_DOMAIN'` atau `session.sisaDetik === null`.
  - `ShelfLifeTimer({ seconds, textClass, label })` — `label` opsional; default tetap `Perkiraan Sisa Umur Tahu`.

- [ ] **Step 1: Tulis komponen `EstimateState`**

Aturan render (urutan prioritas):
1. `session.legacy` → badge netral **Arsip model lama**, tanpa angka, subteks `Perkiraan dari model lama tidak ditampilkan.`
2. `session.rslDomain === 'OUT_OF_DOMAIN'` → judul **Di Luar Domain**, subteks `Durasi pemantauan {durasiDetik/3600 dibulatkan 1 desimal} jam melewati batas data penelitian (42,9 jam).`, tanpa angka/timer.
3. `session.sisaDetik === null` → **Menyiapkan pemantauan…**
4. selain itu → `ShelfLifeTimer` + badge netral **Estimasi Riset**.

Baris bawah selalu (bila `RESEARCH_RSL_MODE`): `Perkiraan riset, bukan jaminan masa simpan maupun keamanan pangan.`

- [ ] **Step 2: Pakai di `ChamberCard`**

Ganti blok hitung mundur + `StatusBadge` dengan `<EstimateState session={session} seconds={seconds} textClass={style.text} />`. Gaya kartu: `style` hanya dipakai bila `session.rslDomain === 'IN_DOMAIN' && !session.legacy`, selain itu `NEUTRAL_STYLE`.

- [ ] **Step 3: Verifikasi build**

Run: `cd frontend && npm run build`
Expected: build sukses tanpa error ESLint/JSX

- [ ] **Step 4: Cek manual aturan render**

Buka `npm run dev` dengan `NEXT_PUBLIC_USE_MOCK=true`; di `mock/mockApi.js` tambahkan sementara `rslDomain: 'OUT_OF_DOMAIN'` pada satu sesi aktif → kartu menampilkan "Di Luar Domain" **tanpa** angka; kembalikan setelah dicek.
Expected: tidak ada angka pada keadaan out-of-domain dan legacy.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/features.js frontend/src/components/dashboard/EstimateState.jsx frontend/src/components/dashboard/ChamberCard.jsx frontend/src/components/dashboard/ShelfLifeTimer.jsx
git commit -m "feat(ui): kartu chamber tiga keadaan (riset / luar domain / arsip)"
```

---

### Task 10: Grafik — hapus garis 24/8, tambah garis vertikal 42,8888

**Files:**
- Modify: `frontend/src/components/dashboard/ShelfLifeChart.jsx`
- Modify: `frontend/src/components/dashboard/ChamberCard.jsx:79`
- Modify: `frontend/src/components/analysis/ConditionAnalysisTab.jsx:202`
- Modify: `frontend/src/app/(main)/history/[sessionId]/page.jsx:141`

**Interfaces:**
- Produces: `ShelfLifeChart({ data, xKey, yKey, color, height, heightClass })` — prop `zones` **dihapus**. `yMax = max(10, ceil(maxVal/10)*10)`. `xMax = max(data.map(xKey))`. `ReferenceLine` vertikal `x={42.8888}` hanya dirender bila `xMax >= 42.8888`, `strokeDasharray="5 4"`, label `Batas domain penelitian (42,9 jam)`.

- [ ] **Step 1: Ubah komponen**

Hapus dua `ReferenceLine` `y=zones.segarHours` dan `y=zones.rawanHours`; hapus `ticks` yang bergantung zona (ganti `[0, yMax/2, yMax]` dibulatkan); tambahkan garis vertikal sesuai Interfaces; perbarui docstring.

- [ ] **Step 2: Perbarui 3 pemanggil**

Hapus `zones={zones}` pada `ChamberCard.jsx`, `ConditionAnalysisTab.jsx`, dan `history/[sessionId]/page.jsx`.

- [ ] **Step 3: Verifikasi build**

Run: `cd frontend && npm run build && grep -rn "Batas Segar\|Batas Rawan" src/components/dashboard src/components/analysis "src/app/(main)/history"`
Expected: build sukses; grep **tidak** menghasilkan baris (label zona di `settings/` memang tetap ada, di luar cakupan)

- [ ] **Step 4: Cek manual garis**

Di dev, buka chamber dengan data > 42,9 jam (atau ubah sementara `xMax` data) → garis putus-putus **vertikal** muncul di X ≈ 42,9 dengan label batas domain; pada sesi 2 jam garis **tidak** muncul.
Expected: garis vertikal, bukan horizontal.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/dashboard/ShelfLifeChart.jsx frontend/src/components/dashboard/ChamberCard.jsx frontend/src/components/analysis/ConditionAnalysisTab.jsx "frontend/src/app/(main)/history/[sessionId]/page.jsx"
git commit -m "feat(ui): grafik tanpa batas 24/8, penanda domain vertikal di X=42,9 jam"
```

---

### Task 11: Halaman Analisis + Riwayat (netral + arsip)

**Files:**
- Modify: `frontend/src/components/analysis/ConditionAnalysisTab.jsx` (kotak rekomendasi + catatan sensor)
- Modify: `frontend/src/components/analysis/CostBenefitTab.jsx` (banner beku)
- Modify: `frontend/src/app/(main)/analysis/page.jsx:17` (hormati `SHOW_COST_BENEFIT`)
- Modify: `frontend/src/components/history/HistoryTable.jsx:27`
- Modify: `frontend/src/app/(main)/history/[sessionId]/page.jsx:121,141`

**Interfaces:**
- Consumes: `session.legacy`, `session.rslDomain`, `features.js`.
- Produces: tidak ada API baru.

- [ ] **Step 1: Netralkan rekomendasi + catatan sensor**

Di `ConditionAnalysisTab.jsx`, ganti kalimat vonis ("masih layak", "segera dijual") dengan saran higienis: `Simpan tahu di wadah bersih dan sejuk; jaga kebersihan chamber dan peralatan.` Tambahkan catatan tetap di bawah rekomendasi: `Suhu, RH, dan TVOC adalah pemantauan lingkungan dan tidak memengaruhi estimasi RSL V2.1.`

- [ ] **Step 2: Banner Biaya-Manfaat**

Di awal `CostBenefitTab.jsx` render banner: `Dibekukan — dihitung dari label model lama, bukan estimasi V2.1.` Di `analysis/page.jsx`, filter `TABS` dengan `SHOW_COST_BENEFIT` (tetap `true`).

- [ ] **Step 3: Riwayat**

`HistoryTable.jsx`: bila `r.legacy` render `<StatusBadge status="__neutral">Arsip model lama</StatusBadge>` dan sembunyikan kolom sisa waktu untuk baris itu. `history/[sessionId]/page.jsx`: bila `session.legacy`, badge header jadi **Arsip model lama** dan grafik tren estimasi diganti panel `Grafik estimasi model lama tidak ditampilkan.` (grafik sensor mentah tetap ada).

- [ ] **Step 4: Verifikasi build + grep**

Run: `cd frontend && npm run build && grep -rn "Layak Konsumsi" src/app src/components/dashboard src/components/history`
Expected: build sukses; hasil grep hanya di `guide/content.js`, `mock/`, dan `settings/` (di luar cakupan), **tidak** di `components/history`/`dashboard`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/analysis frontend/src/app/\(main\)/analysis/page.jsx frontend/src/components/history frontend/src/app/\(main\)/history
git commit -m "feat(ui): rekomendasi netral, banner biaya-manfaat, arsip model lama di riwayat"
```

---

### Task 12: Compose + deploy + verifikasi end-to-end di VPS

**Files:**
- Modify: `docker-compose.prod.yml`
- Modify: `backend/.env.example` (bila ada) / dokumentasi `README.md` bagian Server
- Test: checklist manual (tanpa file tes baru)

**Interfaces:**
- Consumes: image `rsl_service`, env backend.
- Produces: service `rsl` (internal, `expose: 8001`, volume `rsl-data`), backend `RSL_SERVICE_URL=http://rsl:8001`, `depends_on: rsl: condition: service_healthy`.

- [ ] **Step 1: Tambah service ke compose**

```yaml
  rsl:
    build: ./rsl_service
    restart: unless-stopped
    expose:
      - "8001"
    volumes:
      - rsl-data:/data
    environment:
      RSL_DB_PATH: /data/consumer_runtime.sqlite
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8001/health')"]
      interval: 15s
      timeout: 5s
      retries: 5
```

Tambah `rsl-data` ke `volumes:`. Backend: `RSL_SERVICE_URL: http://rsl:8001` di `environment:` dan `depends_on` dengan `condition: service_healthy`. Tambahkan catatan di `README.md` bagian Server: variabel `RSL_MODE`/`RSL_SERVICE_URL`, perintah migrasi `node scripts/migrate-legacy-rsl.js --apply`, dan rollback `RSL_MODE=off`.

- [ ] **Step 2: Commit + push**

```bash
git add docker-compose.prod.yml README.md
git commit -m "chore(deploy): service rsl di docker-compose produksi"
```

- [ ] **Step 3: Deploy di VPS**

Run: `ssh -i ~/.ssh/id_ed25519_tofusense toscha@116.212.74.136 'cd ~/smart-tofu-chamber && git pull && (grep -q "^RSL_MODE=" backend/.env && sed -i "s/^RSL_MODE=.*/RSL_MODE=live/" backend/.env || echo "RSL_MODE=live" >> backend/.env) && docker compose -f docker-compose.prod.yml up -d --build'`
Expected: 6 container up; `docker ps` memuat `smart-tofu-chamber-rsl-1`

- [ ] **Step 4: Verifikasi `/health` dan mode**

Run: `ssh ... 'docker exec smart-tofu-chamber-backend-1 printenv RSL_MODE RSL_SERVICE_URL && docker compose -f ~/smart-tofu-chamber/docker-compose.prod.yml exec rsl python -c "import urllib.request,json;print(json.load(urllib.request.urlopen(\"http://127.0.0.1:8001/health\")))"'`
Expected: `live` + `http://rsl:8001`; JSON health `sha256=5865af9c...`

- [ ] **Step 5: Jalankan migrasi legacy**

Run: `docker exec smart-tofu-chamber-backend-1 node scripts/migrate-legacy-rsl.js --apply` lalu ulangi
Expected: run pertama mengubah 12 sesi & 4.843 prediksi; run kedua `sessions: 0, predictions: 0`

- [ ] **Step 6: Uji dua sesi lewat jalur ingest asli (2 jam dan 50 jam) lalu bersihkan**

Buat dua sesi aktif langsung di Mongo (bukan lewat seed prediksi), dengan `masuk` dimundurkan dan `notified` sudah terisi agar WhatsApp tidak terkirim:

```
db.sesis.insertOne({ seq: 901, sesiCode: 'CH-901', chamberId: 1, status: 'aktif',
  masuk: new Date(Date.now() - 2*3600*1000), readingCount: 0,
  notified: { mulai: new Date(), segeraJual: new Date(), tidakLayak: new Date(), offline: new Date() } })
db.sesis.insertOne({ seq: 902, sesiCode: 'CH-902', chamberId: 2, status: 'aktif',
  masuk: new Date(Date.now() - 50*3600*1000), readingCount: 0, notified: { ...sama } })
```

Lalu kirim satu reading per chamber lewat endpoint perangkat (memicu ingest → service rsl):

```
POST /api/sensor { "chamberId": 1, "tvoc": 300, "suhu": 27.0, "rh": 78.0, "timestamp": "<sekarang>" }
POST /api/sensor { "chamberId": 2, "tvoc": 300, "suhu": 27.0, "rh": 78.0, "timestamp": "<sekarang>" }
```

Cek `/api/dashboard` dengan JWT yang di-mint di container backend. (Bila `DEVICE_API_KEY` terisi di `backend/.env`, sertakan header `x-api-key`.)
Expected: CH-901 → `rslDomain: 'IN_DOMAIN'`, `shelfLifeAwal` numerik, `prediksiDibuat` = waktu `last_calculated_at` (bukan waktu POST), `chart` punya 1 titik; CH-902 → `rslDomain: 'OUT_OF_DOMAIN'`, `shelfLifeAwal: null`, `sisaDetik: null`, `chart` kosong (tidak ada Prediction dibuat). Hapus kedua sesi + reading + prediksi setelah verifikasi.

- [ ] **Step 7: Uji service mati (fail-open untuk reading, fail-closed untuk estimasi)**

Run: `docker compose -f docker-compose.prod.yml stop rsl` lalu kirim satu reading ke CH-901.
Expected: respons ingest sukses, `readingCount` bertambah, `shelfLifeAwal`/`prediksiDibuat` CH-901 **tidak berubah**, log backend memuat `[ingest] prediksi gagal`. Jalankan `docker compose ... start rsl` kembali.

- [ ] **Step 8: Verifikasi tidak ada vonis di API & UI**

Run: cek `/api/dashboard` dan `/api/notifications` → tidak ada string `Tidak Layak Konsumsi`/`Segera Konsumsi`/`Layak Konsumsi`; `statusLayak` selalu `null` untuk sesi aktif; grafik menampilkan garis vertikal di 42,9 jam bila X mencapai batas.
Expected: semua kondisi terpenuhi.

- [ ] **Step 9: Catat rollback**

Run: `ssh ... 'cd ~/smart-tofu-chamber && sed -i "s/^RSL_MODE=.*/RSL_MODE=off/" backend/.env && docker compose -f docker-compose.prod.yml up -d backend'`
Expected: dashboard kembali memakai jalur mock (angka lama), service `rsl` tetap jalan tapi tidak dipanggil. Kembalikan ke `live` setelah dicek.
