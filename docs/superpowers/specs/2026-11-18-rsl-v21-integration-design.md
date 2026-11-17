# Integrasi Model RSL V2.1 (Bayesian Weibull) ke Web TOSCHA

Tanggal: 2026-11-18
Status: disetujui untuk diimplementasikan
Basis kode: `smart-tofu-chamber` @ `9a8c9c1` (branch `desi-last`)
Model: `TOFUSENSE_AUTONOMOUS_RSL_V2/artifacts/m0_bayesian_weibull_primary_3u.json`
SHA-256 artifact: `5865af9ca9e8a85d677d6cc7fb9a91519ca0b5b96674dcddc67be0de8654c403`

## 1. Tujuan

Menampilkan estimasi RSL (remaining shelf life) dari model V2.1 di web TOSCHA,
menggantikan angka dari model mock, tanpa mengubah kontrak riset model.

## 2. Bukan tujuan

- Tidak mengubah isi `TOFUSENSE_AUTONOMOUS_RSL_V2/` dan `TOFUSENSE_AUTONOMOUS_RSL_V2_1/`.
- Tidak memakai `smartchamber/`, `processed_rul/`, `TOFUSENSE_V5..V7`, `FINAL_RESEARCH_RELEASE`.
- Tidak menjadikan TVOC/suhu/RH sebagai fitur model (model V2.1 time-only).
- Tidak mengubah notifikasi WhatsApp (ditunda atas keputusan pengguna).
- Tidak menyambungkan tab Biaya-Manfaat ke V2.1 (dibekukan).

## 3. Fakta model yang mengikat desain

| Fakta | Konsekuensi desain |
|---|---|
| Time-only: input hanya `session_id`, `monitoring_start_at`, `current_timestamp` | Backend tidak mengirim TVOC/suhu/RH ke model |
| Domain valid 0,25–42,8888 jam | Di luar itu `OUT_OF_DOMAIN`, `median_rsl_hours = null` |
| `operational_prediction_authorized` selalu `false` | UI tidak boleh menampilkan vonis keamanan pangan |
| `EstimationScheduler` meng-cache hasil sebelum jadwal recalculation | `POST /estimate` wajib `force=True` |
| Respons cache membawa `last_calculated_at` lama | `prediksiDibuat` di Mongo diisi dari `last_calculated_at`, bukan `now` |
| Artifact diverifikasi SHA-256 saat load | SHA salah → service gagal start (fail-closed) |

## 4. Arsitektur

```
ESP32 ──MQTT──> backend (Node)
                   │  ingestService: simpan reading
                   │  predictionService (RSL_MODE=live)
                   ▼
             rsl service (Python 3.11 + FastAPI, container `rsl`, expose 8001)
                   │  RSLOrchestrator.estimate_for_session(force=True)
                   │  to_consumer_presentation()
                   ▼
             backend simpan ke Mongo (Session + Prediction)
                   ▼
             frontend (Next.js) baca /api/dashboard, /api/sesi, /api/analysis/*
```

Service `rsl` bersifat internal (tanpa port host), memakai volume `rsl-data` untuk
SQLite scheduler (`consumer_runtime.sqlite`).

## 5. Kontrak service `rsl`

### `POST /estimate`

```json
{
  "session_id": "6aecf045b815042fcde98792",
  "monitoring_start_at": "2026-11-18T01:00:00Z",
  "current_timestamp": "2026-11-18T03:00:00Z",
  "temp_c": 27.4,
  "humid_pct": 78.9,
  "esp32_connected": true
}
```

`current_timestamp` opsional (default: waktu service). `temp_c`, `humid_pct`,
`esp32_connected` hanya untuk tampilan; tidak mengubah perhitungan.

Respons: keluaran orchestrator V2.1 digabung dengan `to_consumer_presentation()`:

```json
{
  "session_id": "...",
  "application_state": "ESTIMATE_AVAILABLE",
  "domain_status": "IN_DOMAIN",
  "research_display_eligible": true,
  "operational_prediction_authorized": false,
  "estimate": { "median_rsl_hours": 31.4, "pi80_lower_hours": 28.1, "pi80_upper_hours": 35.0 },
  "monitoring": { "elapsed_hours": 2.0, "timestamp_valid": true, "sensor_connection": "CONNECTED",
                  "temp_c": 27.4, "humid_pct": 78.9 },
  "last_calculated_at": "2026-11-18T03:00:02Z",
  "model_artifact_id": "m0_bayesian_weibull_primary_3u.json:5865af9ca9e8",
  "headline_id": "Perkiraan sisa waktu pemantauan (estimasi riset): sekitar 31.4 jam.",
  "research_disclaimer_id": "Perkiraan ini dihasilkan berdasarkan model penelitian TofuSense. ...",
  "availability_category": "AVAILABLE"
}
```

### `GET /health`

```json
{ "ok": true, "model_artifact_id": "...:5865af9ca9e8", "sha256": "5865af9c..." }
```

Startup gagal (container exit) bila SHA artifact tidak cocok.

## 6. Perubahan backend (Node)

| File | Perubahan |
|---|---|
| `src/config/env.js` | `RSL_MODE` (`off`/`live`), `RSL_SERVICE_URL`, `RSL_TIMEOUT_MS` (default 4000) |
| `src/services/rslClient.js` (baru) | Klien HTTP tipis: `estimate({sessionId, startAt, now, tempC, humidPct, connected})`, timeout + validasi bentuk respons |
| `src/services/predictionService.js` | Cabang `live`: panggil `rslClient`, kembalikan `{ median, pi80Low, pi80High, domainStatus, state, calculatedAt }` |
| `src/services/ingestService.js` | Simpan hasil: `shelfLifeAwal = median ?? null`, `prediksiDibuat = last_calculated_at`, `rslDomain`, `rslState`, `rslPi80Low/High`, `rslCalculatedAt`; buat dokumen `Prediction` (`modelUsed = 'v21_weibull'`, `shelfLifeJam = median`) agar grafik tren tetap punya histori titik |
| `src/models/Session.js` | Field: `rslDomain` (`IN_DOMAIN`/`OUT_OF_DOMAIN`/`LEGACY`/null), `rslState`, `rslPi80Low`, `rslPi80High`, `rslCalculatedAt`, `legacy` (bool) |
| `src/models/Prediction.js` | `modelUsed` enum + `v21_weibull`; field opsional `rslDomain`, `pi80Low`, `pi80High` |
| `src/utils/presenters.js` | `sessionView` menambah `rslDomain`, `rslState`, `pi80`, `legacy`; **tidak** lagi mengirim `statusLayak` ke UI saat `RSL_MODE=live` |

### Aturan pemetaan (wajib)

| Kondisi respons | `shelfLifeAwal` | `rslDomain` | UI |
|---|---|---|---|
| `ESTIMATE_AVAILABLE` + `IN_DOMAIN` | `median_rsl_hours` | `IN_DOMAIN` | timer + angka |
| `OUT_OF_DOMAIN` | `null` (bukan 0) | `OUT_OF_DOMAIN` | pesan batas domain |
| `INITIALIZING` / `WAITING_FOR_DATA` | `null` | `null` | "Menyiapkan pemantauan…" |
| service error / timeout | tidak diubah (nilai lama) | tetap | "Estimasi belum tersedia" |

`prediksiDibuat` **selalu** `last_calculated_at` dari service. Bila field itu null
pada respons error, `prediksiDibuat` tidak diubah.

`monitoring_start_at` = `session.masuk` (waktu tahu masuk chamber). Timer di UI tetap
memakai rumus lama: `sisa = shelfLifeAwal*3600 - (sekarang - prediksiDibuat)`, sehingga
konsisten baik respons segar maupun cache.

## 7. Migrasi data lama

Script sekali jalan (idempoten):

- 12 sesi lama: `legacy = true`, `modelUsed = 'mock_legacy'`, `rslDomain = 'LEGACY'`.
- 4.843 prediksi lama: `modelUsed = 'mock_legacy'`.
- `statusAkhir` lama **tidak dihapus** (dipakai tab Biaya-Manfaat yang dibekukan).

## 8. Perubahan frontend

### 8.1 Kartu chamber — tiga keadaan

| Keadaan | Tampilan |
|---|---|
| `IN_DOMAIN` | `±31,4 jam`, label "Estimasi Riset Sisa Waktu", badge netral **Estimasi Riset** |
| `OUT_OF_DOMAIN` | **Di Luar Domain**, subteks "Durasi pemantauan 50,2 jam melewati batas data penelitian (42,9 jam)", angka & timer disembunyikan |
| belum ada | "Menyiapkan pemantauan…" |
| `legacy` | badge **Arsip model lama**, angka disembunyikan |

Di bawah kartu: "Perkiraan riset, bukan jaminan masa simpan maupun keamanan pangan."

### 8.2 Grafik "Tren Umur Simpan" (`ShelfLifeChart.jsx`)

- Sumbu X = waktu sejak tahu masuk (jam); sumbu Y = sisa umur (jam).
- **Hapus** `ReferenceLine` horizontal `y=24` (Batas Segar) dan `y=8` (Batas Rawan).
- **Tambah** `ReferenceLine` **vertikal** `x=42.8888`, putus-putus, label
  "batas domain penelitian (42,9 jam)". Hanya tampil bila `xMax` grafik mencapai
  42,9 jam; bila tidak, garis tidak dirender.
- Skala Y tidak lagi dipaksa `zones.segarHours * 1.25`; pakai `max(data)` dengan
  pembulatan.

### 8.3 Halaman Analisis

- Kotak rekomendasi: ganti kalimat vonis ("tahu masih layak") menjadi saran
  penyimpanan higienis umum.
- Catatan tetap: "Suhu, RH, dan TVOC adalah pemantauan lingkungan dan tidak
  memengaruhi estimasi RSL V2.1."
- Tab Biaya-Manfaat: tetap tampil, ditambah banner "Dibekukan — dihitung dari label
  model lama, bukan V2.1".

### 8.4 Riwayat

- Sesi `legacy` → badge **Arsip model lama**; angka estimasi & status disembunyikan;
  grafik sensor mentah tetap bisa dibuka.

### 8.5 Flag

`frontend/src/lib/features.js`: tambah `RESEARCH_RSL_MODE = true`,
`SHOW_COST_BENEFIT = true` (tetap tampil, hanya diberi banner).

## 9. Penanganan error (fail-closed)

| Kejadian | Perilaku |
|---|---|
| Artifact SHA salah | Container `rsl` exit; `/health` tidak tersedia |
| Service timeout / 5xx | Reading tetap tersimpan; `predictionError` dicatat; estimasi lama dipertahankan |
| `monitoring_start_at` hilang/invalid | Service balas `ACTION_REQUIRED`; UI "Pengaturan waktu pemantauan perlu diperiksa" |
| Timestamp mundur | Service balas `ACTION_REQUIRED` (guard non-monotonic) |

## 10. Testing

**Python (service)**
1. Batas domain: 0,2499 / 0,25 / 42,8888 / 42,8889 jam.
2. SHA artifact salah → konstruksi service gagal.
3. `force=True` menembus cache: dua panggilan berurutan menghasilkan
   `last_calculated_at` berbeda.
4. Respons `OUT_OF_DOMAIN` → `median_rsl_hours` null, `research_display_eligible` false.
5. `operational_prediction_authorized` selalu `false`.
6. Timestamp mundur → `ACTION_REQUIRED`.

**Node (backend)**
1. `OUT_OF_DOMAIN` → `shelfLifeAwal = null` (bukan 0).
2. `prediksiDibuat` = `last_calculated_at`.
3. Timeout service → reading tetap tersimpan, `predictionError` terisi.
4. `RSL_MODE=off` → perilaku lama tidak berubah.

**Frontend**
1. Kartu `IN_DOMAIN` menampilkan angka; `OUT_OF_DOMAIN` menyembunyikan angka.
2. Garis 42,9 jam vertikal hanya muncul bila `xMax >= 42.8888`.
3. Tidak ada teks "Layak Konsumsi"/"Tidak Layak Konsumsi" pada kartu & grafik dasbor.

**Manual di VPS**
1. `/health` mengembalikan SHA yang benar.
2. Sesi uji 2 jam → angka muncul.
3. Sesi uji 50 jam → pesan di luar domain.

## 11. Deployment

1. Build image `rsl` di VPS; tambah service ke `docker-compose.prod.yml`
   (`expose: 8001`, `volumes: rsl-data:/data`, healthcheck `GET /health`).
2. `backend/.env`: `RSL_MODE=live`, `RSL_SERVICE_URL=http://rsl:8001`, `RSL_TIMEOUT_MS=4000`.
3. `docker compose -f docker-compose.prod.yml up -d --build`.
4. Verifikasi `/health`, lalu satu sesi uji (dibuat dan dihapus kembali).
5. Rollback: `RSL_MODE=off` + restart backend (tanpa perlu turunkan versi kode).

## 12. Risiko yang diterima

- **Notifikasi WhatsApp masih mengirim vonis** "Segera/Tidak Layak Konsumsi" untuk
  sesi baru, bertentangan dengan disclaimer UI. Ditunda atas keputusan pengguna;
  perlu ditinjau sebelum demo/sidang.
- Tab Biaya-Manfaat tetap menghitung rupiah dari label model lama (dibekukan,
  diberi banner).

## 13. Di luar cakupan

- Kalibrasi ulang model, perubahan domain, atau pelatihan ulang.
- Integrasi `sampleStatus`/`storageCondition` (milik `rsl_service` branch Melvino).
- Migrasi data historis ke model V2.1.
