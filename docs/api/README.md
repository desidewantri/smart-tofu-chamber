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
| GET | `/chambers?q=` | Daftar chamber + sesi saat ini. |
| GET | `/chambers/:id` | Detail. `:id` = `1` atau `2`. |
| PUT | `/chambers/:id` | Ubah `name` / `enabled`. |
| POST | `/chambers/:id/selesai` | "Tahu Sudah Keluar": tutup sesi aktif. |
| GET | `/sesi` | Query: `chamberId, status(aktif/selesai), statusAkhir, q, from, to, sort(sisa/masuk), page, limit`. |
| GET | `/sesi/:id` | Detail + statistik + deret waktu. `:id` = ObjectId atau `CH-001`. |
| GET | `/sesi/:id/prediksi` | Semua prediksi sesi. |
| GET | `/sesi/:id/sensor` | Semua pembacaan sensor sesi. |
| GET | `/sensor/:chamberId?limit=&from=&to=` | Pembacaan sensor terbaru chamber (limit maks 1000). |
| POST | `/sensor` | *Publik dengan API key.* Header `x-api-key` (jika `DEVICE_API_KEY` diisi). Fallback HTTP selain MQTT. |
| GET | `/analysis/condition?chamberId=&period=` | Analisis kondisi + interpretasi + tren. |
| GET | `/analysis/cost-benefit?chamberId=&period=` | Biaya & manfaat (asumsi di Settings). |
| GET | `/analysis/seasonal?chamberId=&period=` | Rata-rata per bulan dan per musim. |
| GET / PUT | `/settings` | Pengaturan sistem. |

`period`: `24h, 7d, 30d, 90d, 180d, 365d`.
Hanya ada **2 chamber**. `POST /chambers` tidak tersedia; chamber dibuat otomatis
saat data pertama masuk.

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
