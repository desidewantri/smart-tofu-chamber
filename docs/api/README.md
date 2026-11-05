# REST API

Basis URL: `http://localhost:5000/api`. Semua respons berbentuk `{ "success": true, "data": ... }`; galat: `{ "success": false, "message": "..." }`.
Endpoint selain yang ditandai *publik* memerlukan header `Authorization: Bearer <token>` dari `POST /auth/login`.

| Metode | Path | Keterangan |
|---|---|---|
| GET | `/health` | *Publik.* Status API, DB, MQTT, mode ML. |
| GET | `/auth/config` | *Publik.* Status pendaftaran + client ID Google. |
| POST | `/auth/login` | *Publik.* Body `{email, password, remember}` → `{token, user}`. |
| POST | `/auth/register` | *Publik.* Body `{name, email, password}`. |
| POST | `/auth/google` | *Publik.* Body `{credential}` (Google ID token). |
| GET | `/auth/me` | Profil pengguna. |
| PUT | `/auth/profile` | Ubah `name` / `email`. |
| PUT | `/auth/password` | Body `{currentPassword, newPassword}`. |
| GET | `/dashboard` | Semua kartu chamber aktif (sesi, sisa waktu, sensor, grafik) + chamber idle. |
| GET | `/notifications` | Notifikasi turunan (Segera Konsumsi, Tidak Layak, offline). |
| GET | `/battery` | Status baterai alat terakhir. |
| POST | `/notifications/whatsapp/test` | Uji kirim WhatsApp. |
| POST | `/experiments` | Mulai eksperimen: 1 experiment + 2 sesi chamber. Body `{label, storageCondition?}`; `storageCondition` default `DRY`. 409 jika ada eksperimen/sesi aktif. |
| GET | `/experiments?status=&limit=` | Daftar eksperimen terbaru. |
| GET | `/experiments/active` | Eksperimen aktif + dua sesi, atau `null`. |
| GET | `/experiments/:id` | Detail eksperimen + dua sesi. |
| POST | `/experiments/:id/stop` | Tutup eksperimen + dua sesi dengan `endedAt` yang sama; idempotent. |
| GET | `/experiments/:id/rsl/:chamberId` | Hasil RSL M1 + M2/M3 untuk chamber pada eksperimen. |
| GET | `/experiments/:id/rsl/:chamberId/analysis` | Detail M2/M3 + metadata referensi. |
| GET | `/rsl/snapshots?chamberId=&limit=` | Snapshot RSL historis immutable per chamber (default 20, maks 100). |
| PATCH | `/experiments/:id/sessions/:sessionId/sample-status` | Body `{sampleStatus, storageCondition?}`; status operator per chamber. |
| GET | `/chambers?q=` | Daftar chamber + sesi saat ini. |
| GET | `/chambers/:id` | Detail. `:id` = `1` atau `2`. |
| PUT | `/chambers/:id` | Ubah `name` / `enabled`. |
| POST | `/chambers/:id/selesai` | "Tahu Sudah Keluar": tutup sesi aktif. |
| GET | `/sesi` | Query: `chamberId, status(aktif/selesai), statusAkhir, q, from, to, sort(sisa/masuk), page, limit`. |
| GET | `/sesi/:id` | Detail + statistik + deret waktu. `:id` = ObjectId atau `CH-001`. |
| GET | `/sesi/:id/prediksi` | Semua prediksi sesi. |
| GET | `/sesi/:id/sensor` | Semua pembacaan sensor sesi. |
| GET | `/sensor/:chamberId?limit=&from=&to=` | Pembacaan sensor terbaru chamber (limit maks 1000). |
| POST | `/sensor` | *Publik dengan API key.* Header `x-api-key` (jika `DEVICE_API_KEY` diisi). Fallback HTTP selain MQTT. Wajib ada eksperimen aktif; tanpa itu `409 NO_ACTIVE_EXPERIMENT`. |
| GET | `/analysis/condition?chamberId=&period=` | Analisis kondisi + interpretasi + tren. |
| GET | `/analysis/cost-benefit?chamberId=&period=` | Biaya & manfaat (asumsi di Settings). |
| GET | `/analysis/seasonal?chamberId=&period=` | Rata-rata per bulan dan per musim. |
| GET / PUT | `/settings` | Pengaturan sistem. |

`period`: `24h, 7d, 30d, 90d, 180d, 365d`.
Hanya ada **2 chamber**. `POST /chambers` tidak tersedia; chamber dibuat otomatis
saat data pertama masuk.

## Eksperimen

Satu eksperimen mewakili satu batch tahu yang dimuat ke dua chamber. Start membuat
satu dokumen `experiments` dan dua sesi (`chamberId` 1 dan 2) dengan
`experimentId` yang sama. `Experiment.startedAt` adalah acuan elapsed time/RSL;
`Session.masuk` tetap waktu reading pertama untuk audit.

```bash
# login dulu, lalu gunakan token
TOKEN="<token-dari-POST-/auth/login>"

curl -X POST http://localhost:5000/api/experiments \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label":"Sesi 5 - IoT"}'

curl http://localhost:5000/api/experiments/active \
  -H "Authorization: Bearer $TOKEN"

curl -X POST http://localhost:5000/api/experiments/<experimentId>/stop \
  -H "Authorization: Bearer $TOKEN"
```

Contoh respons start:

```json
{
  "success": true,
  "data": {
    "experiment": {
      "id": "...",
      "label": "Sesi 5 - IoT",
      "startedAt": "2026-11-05T00:00:00.000Z",
      "endedAt": null,
      "status": "aktif",
      "chamberIds": [1, 2]
    },
    "sessions": [
      { "id": "...", "sesiCode": "CH-011", "experimentId": "...", "chamberId": 1, "status": "aktif", "masuk": null },
      { "id": "...", "sesiCode": "CH-012", "experimentId": "...", "chamberId": 2, "status": "aktif", "masuk": null }
    ]
  }
}
```

Jika ada sesi aktif lama tanpa `experimentId`, start ditolak `409` dengan
`details.code = "LEGACY_ACTIVE_SESSION"` dan daftar sesi yang harus ditutup.
Sensor message tanpa eksperimen aktif ditolak `409` dengan
`details.code = "NO_ACTIVE_EXPERIMENT"`; backend tidak membuat sesi baru dari
pesan sensor.

## RSL (statistical remaining shelf life)

RSL adalah kapabilitas terpisah dari `ML_MODE` dan **tidak** memakai TVOC, suhu,
atau RH. Elapsed time selalu `(serverNow - Experiment.startedAt) / 3600000`.
Status sampel per chamber harus eksplisit:

- `UNKNOWN` → `REFERENCE_ONLY`, reason `SAMPLE_STATUS_UNKNOWN`; rentang referensi historis yang sama dengan `NOT_SPOILED` pada elapsed/DRY yang sama, ditandai `referenceOnly: true` dan `sampleStatus: UNKNOWN`. Bukan prediksi individual; status DB tetap `UNKNOWN`.
- `NOT_SPOILED` → M1/M2/M3 bila kondisi `DRY` dan masih dalam support.
- `SPOILED` → `UNAVAILABLE`, reason `SAMPLE_REPORTED_SPOILED`; tidak ada rentang.
- `storageCondition` selain `DRY` → `UNAVAILABLE`, reason
  `UNSUPPORTED_STORAGE_CONDITION`; referensi DRY tidak dipinjamkan.
- Elapsed di luar support → `OUTSIDE_REFERENCE_SUPPORT`.
- Service mati/timeout → `RSL_UNAVAILABLE`/`RSL_TIMEOUT`; tidak ada angka pengganti.

Contoh:

```bash
curl -X PATCH http://localhost:5000/api/experiments/<experimentId>/sessions/<sessionId>/sample-status \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"sampleStatus":"NOT_SPOILED","storageCondition":"DRY"}'

curl http://localhost:5000/api/experiments/<experimentId>/rsl/1 \
  -H "Authorization: Bearer $TOKEN"
```

Respons (disingkat; nilai penuh tidak dibulatkan):

```json
{
  "success": true,
  "data": {
    "experimentId": "...",
    "sessionId": "...",
    "chamberId": 1,
    "sampleStatus": "NOT_SPOILED",
    "storageCondition": "DRY",
    "elapsedHours": 20.0,
    "generatedAt": "2026-11-05T12:00:00.000Z",
    "status": "AVAILABLE",
    "reason": null,
    "primary": {
      "method": "M1",
      "lowerHours": 3.068924444444445,
      "upperHours": 22.888799999999996,
      "display": { "lowerHours": 3, "upperHours": 23 },
      "interpretation": "EMPIRICAL_INTERVAL_ENVELOPE"
    },
    "supporting": {
      "M2": {
        "method": "M2_TURNBULL_NPMLE",
        "status": "OK",
        "advisory": "ESTIMATOR_DEPENDENT - POTENTIALLY ANTI-CONSERVATIVE",
        "components": [
          { "lowerHours": 3.068924444444445, "upperHours": 4.6339244444444425, "mass": 0.33333333333353543 },
          { "lowerHours": 11.1388, "upperHours": 12.233195555555554, "mass": 0.6666666666664646 }
        ]
      },
      "M3": {
        "method": "M3_WEIBULL_A0",
        "status": "OK",
        "available": true,
        "shape": 7.6967264161196045,
        "scale": 30.757113200124557,
        "r10Hours": 3.862710655155791,
        "r90Hours": 14.347262185823915,
        "supportWarning": null,
        "suppressFromDashboard": false
      }
    },
    "metadata": {
      "engineVersion": "1.0.0",
      "referenceVersion": "v2.3-frozen-2026-11-04",
      "referencePopulation": 3,
      "referenceStorageCondition": "DRY",
      "elapsedOrigin": "EXPERIMENT_STARTED_AT",
      "tvocContribution": "NOT_ESTABLISHED",
      "researchStatus": "POST_HOC_EXPLORATORY_DESCRIPTIVE",
      "caveats": ["POST_HOC_EXPLORATORY", "DESCRIPTIVE", "THREE_INFORMATIVE_DRY_ENDPOINTS"]
    }
  }
}
```

M1 adalah **empirical interval envelope**, bukan confidence interval dan bukan
jaminan individu. `display` hanya untuk presentasi; nilai `lowerHours`/
`upperHours` adalah nilai kanonik penuh. M2 adalah Turnbull NPMLE conditional
support (massa di dalam support tidak teridentifikasi). M3 adalah komparator
Weibull A0 eksploratif dari tiga endpoint kering.

### Snapshot historis (Phase 11C)

Snapshot adalah hasil final yang disimpan saat eksperimen dihentikan. Endpoint
ini hanya membaca dokumen `rslsnapshots`; tidak pernah menghitung ulang snapshot
dengan pengaturan model saat ini.

```bash
curl "http://localhost:5000/api/rsl/snapshots?chamberId=1&limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

```json
{
  "success": true,
  "data": {
    "chamberId": 1,
    "limit": 20,
    "items": [
      {
        "id": "...",
        "isSnapshot": true,
        "experimentId": "...",
        "sessionId": "...",
        "chamberId": 1,
        "experimentLabel": "Validasi snapshot 1",
        "sesiCode": "CH-001",
        "snapshotAt": "2026-11-03T19:35:08.423Z",
        "endedAt": "2026-11-03T19:35:08.423Z",
        "elapsedHours": 24,
        "sampleStatus": "NOT_SPOILED",
        "storageCondition": "DRY",
        "status": "AVAILABLE",
        "reason": null,
        "message": null,
        "primary": { "lowerHours": 0, "upperHours": 18.8888, "display": { "lowerHours": 0, "upperHours": 19 } },
        "supporting": { "M2": { "status": "OK", "components": [] }, "M3": { "available": true, "r10Hours": 1.73, "r90Hours": 10.56 } },
        "metadata": { "referenceVersion": "v2.3-frozen-2026-11-04", "referencePopulation": 3, "referenceStorageCondition": "DRY" },
        "timestampQuality": "OK",
        "lastReadingAt": "2026-11-03T19:30:00.000Z",
        "readingCount": 120
      }
    ]
  }
}
```

`snapshotAt`/`endedAt` adalah waktu henti eksperimen asli, bukan waktu request.
`generatedAt` hanya ada pada estimasi live. `isSnapshot: true` menandai bahwa
nilai berasal dari dokumen tersimpan dan tidak boleh diganti dengan estimasi
live. M2/M3 tetap bersifat pendukung dan tidak digabung dengan M1.

## Payload sensor (MQTT dan `POST /sensor`)

```json
{
  "event_id": "tofusense-FCF5C46F0E2C-1793817129-1-ch1",
  "sample_id": "tofusense-FCF5C46F0E2C-1793817129-1",
  "device_id": "tofusense-FCF5C46F0E2C",
  "chamber_id": 1,
  "tvoc": 98,
  "suhu": 27.54,
  "rh": 79.59,
  "sampled_at": "2026-11-05T00:00:00Z",
  "timestamp": "2026-11-05T00:00:00Z",
  "vbat": 3.94
}
```

- Topik MQTT: `smartchamber/sensor/1`, `smartchamber/sensor/2` (backend subscribe `smartchamber/sensor/+`).
- `chamber_id` boleh dihilangkan; diambil dari akhir topik.
- `sampled_at` opsional; tanpa itu backend memakai waktu terima dan menandai
  `timestampQuality = MISSING`. Untuk MQTT, `timestamp` diterima sebagai alias
  lama `sampled_at`; untuk Sheet lama, kolom `timestamp` adalah waktu terima.
- `vbat` opsional: nilai ≤ 5 dianggap volt, selain itu persen.
- Rentang validasi: TVOC 0–99.999 ppb, suhu −20…80 °C, RH 0–100 %.
- Pesan sensor hanya diterima jika ada eksperimen aktif dan sesi chamber yang
  sesuai. Tanpa itu backend membalas `409 NO_ACTIVE_EXPERIMENT` (atau
  `MISSING_EXPERIMENT_SESSION`) dan tidak menulis reading. `experiment_id` di
  payload tidak dipakai untuk memilih eksperimen; server selalu memakai
  eksperimen aktif.

### Identitas dan deduplikasi

`event_id = <sample_id>-ch<chamber_id>`. Pesan MQTT dan baris Google Sheets untuk
kejadian yang sama menghasilkan `event_id` yang sama. Backend menyimpan satu
dokumen; kiriman kedua hanya menambah `sources` dan tidak memicu prediksi/sesi baru.
Payload lama tanpa `sample_id`/`event_id` tetap diterima (tanpa jaminan dedup).

## Kontrak dengan ml-service

Backend memanggil `POST {ML_SERVICE_URL}/predict`.

**Request**
```json
{
  "chamber_id": 1,
  "session_id": "CH-006",
  "tvoc": 312.5, "suhu": 24.3, "rh": 68.2,
  "n_t": 7,
  "history": [ { "tvoc": 300.1, "suhu": 24.2, "rh": 68.0, "timestamp": "..." } ]
}
```
- Field wajib minimal: `tvoc`, `suhu`, `rh`.
- `n_t` = jumlah pembacaan sesi ini (state machine RF → LSTM pada `n_t ≥ 18`).
- `history` = hingga 12 pembacaan terakhir, urut dari yang terlama.

**Response**
```json
{ "shelf_life_hours": 57.2, "model_used": "random_forest" }
```
`model_used`: `random_forest`, `lstm`, atau `hybrid`. Alias: `shelfLifeJam`/`shelf_life`, `model`.

## Menguji tanpa hardware
```bash
cd backend
npm run simulate -- --chamber 1            # HTTP
npm run simulate -- --chamber 1 --mqtt     # lewat MQTT
```
atau:
```bash
mosquitto_pub -h localhost -t smartchamber/sensor/1 \
  -m '{"sample_id":"manual-1","chamber_id":1,"tvoc":312,"suhu":27.5,"rh":79}'
```
