# REST API

Basis URL: `http://localhost:5000/api`. Semua respons berbentuk `{ "success": true, "data": ... }`; galat: `{ "success": false, "message": "..." }`.
Endpoint selain yang ditandai *publik* memerlukan header `Authorization: Bearer <token>` dari `POST /auth/login`.

| Metode | Path | Keterangan |
|---|---|---|
| GET | `/health` | *Publik.* Status API, DB, MQTT, mode ML. |
| POST | `/auth/login` | *Publik.* Body `{email, password, remember}` → `{token, user}`. |
| GET | `/auth/me` | Profil pengguna. |
| PUT | `/auth/profile` | Ubah `name` / `email`. |
| PUT | `/auth/password` | Body `{currentPassword, newPassword}`. |
| GET | `/dashboard` | Semua kartu chamber aktif (sesi, sisa waktu, sensor, grafik) + chamber idle. |
| GET | `/notifications` | Notifikasi turunan (Segera Jual, Tidak Layak, offline). |
| GET | `/chambers?q=` | Daftar chamber + sesi saat ini. |
| POST | `/chambers` | Tambah chamber `{name}`. |
| GET | `/chambers/:id` | Detail; `:id` boleh `1` atau `CH-001`. |
| PUT | `/chambers/:id` | Ubah `name` / `enabled`. |
| POST | `/chambers/:id/selesai` | "Tahu Sudah Keluar": tutup sesi aktif. Respons `{"success":true,"message":"Sesi SES-006 di chamber 1 ditutup"}`. |
| GET | `/sesi` | Daftar sesi. Query: `chamberId, status(aktif/selesai), statusAkhir, q, from, to, sort(sisa/masuk), page, limit`. Default urut sisa terkecil. |
| GET | `/sesi/:id` | Detail sesi + statistik + deret waktu. `:id` = ObjectId atau `SES-001`. |
| GET | `/sesi/:id/prediksi` | Semua prediksi sesi. |
| GET | `/sesi/:id/sensor` | Semua pembacaan sensor sesi. |
| GET | `/sensor/:chamberId?limit=&from=&to=` | Pembacaan sensor terbaru chamber. |
| POST | `/sensor` | *Publik dengan API key.* Header `x-api-key`. Fallback HTTP selain MQTT. Body sama dengan payload MQTT. |
| GET | `/analysis/condition?chamberId=&period=` | Analisis kondisi + interpretasi + tren. |
| GET | `/analysis/cost-benefit?chamberId=&period=` | Biaya & manfaat (berbasis asumsi di Settings). |
| GET | `/analysis/seasonal?chamberId=&period=` | Rata-rata per bulan dan per musim. |
| GET / PUT | `/settings` | Pengaturan sistem (zona, interval, batas parameter, notifikasi, asumsi bisnis). |

`period`: `24h, 7d, 30d, 90d, 180d, 365d`.

## Payload sensor (MQTT dan `POST /sensor`)
```json
{ "chamber_id": 1, "tvoc": 312.5, "suhu": 24.3, "rh": 68.2, "timestamp": "2026-05-24T08:05:00Z" }
```
Topik MQTT: `smartchamber/sensor/1`, `smartchamber/sensor/2`, ... (backend subscribe `smartchamber/sensor/+`). `chamber_id` boleh dihilangkan; diambil dari akhir topik. `timestamp` opsional.

## Kontrak dengan ml-service (untuk teman bagian ML)
Backend memanggil `POST {ML_SERVICE_URL}/predict`.

**Request**
```json
{
  "chamber_id": 1,
  "session_id": "SES-006",
  "tvoc": 312.5, "suhu": 24.3, "rh": 68.2,
  "n_t": 7,
  "history": [ { "tvoc": 300.1, "suhu": 24.2, "rh": 68.0, "timestamp": "..." } ]
}
```
- Field wajib minimal: `tvoc`, `suhu`, `rh`. Field lain boleh diabaikan (pydantic mengabaikan field tambahan secara default).
- `n_t` = jumlah pembacaan sesi ini (untuk state machine RF → LSTM pada n_t ≥ 18).
- `history` = hingga 12 pembacaan terakhir, urut dari yang terlama (untuk jendela LSTM W = 12).

**Response**
```json
{ "shelf_life_hours": 57.2, "model_used": "random_forest" }
```
`model_used`: `random_forest`, `lstm`, atau `hybrid`. Alias yang diterima: `shelfLifeJam`/`shelf_life`, `model`.

Untuk mencoba: jalankan ml-service di port 8000 lalu set `ML_MODE=auto` di `backend/.env` dan restart backend.

## Menguji tanpa hardware
```bash
cd backend
npm run simulate -- --chamber 3            # HTTP
npm run simulate -- --chamber 3 --mqtt     # lewat MQTT
```
atau dengan `mosquitto_pub`:
```bash
mosquitto_pub -h localhost -t smartchamber/sensor/3 -m '{"chamber_id":3,"tvoc":312.5,"suhu":24.3,"rh":68.2}'
```
