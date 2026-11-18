# Arsitektur

```
ESP32 (AGS10 + SHT31)
   │  MQTT  smartchamber/sensor/<id>   tiap 5 menit
   ▼
Mosquitto :1883
   │
   ▼
Backend Express :5000 ── mqttService ──► ingestService
   │                                        │ 1. validasi + simpan SensorReading
   │                                        │ 2. buat Sesi bila chamber belum punya sesi aktif
   │                                        │ 3. predictionService → ml-service (FastAPI :8000) atau mock
   │                                        │ 4. simpan Prediction, update shelfLifeAwal & t0 sesi
   ▼                                        ▼
REST API  ◄────────────────────────────  MongoDB :27017
   ▲
   │ polling 10 detik (hitung mundur berjalan lokal tiap detik)
Frontend Next.js :3000
```

## Alur satu pembacaan sensor
1. ESP32 publish `{"chamber_id":1,"tvoc":312.5,"suhu":24.3,"rh":68.2,"timestamp":"..."}`.
2. `mqttService` menerima pesan dan memanggil `ingestService.ingestReading`.
3. Pembacaan divalidasi (tvoc 0-60000 ppb, suhu -20..80 °C, rh 0-100 %).
4. Tidak ada sesi aktif di chamber itu → sesi baru `SES-00N` dibuat otomatis ("satu sesi = satu batch tahu").
5. Backend memanggil ML (`predictionService`) dengan nilai terbaru, jumlah pembacaan `n_t`, dan riwayat 12 pembacaan terakhir.
6. Prediksi disimpan; sesi diperbarui: `shelfLifeAwal` = prediksi terbaru (jam), `prediksiDibuat` = t0.

## Hitung mundur
`sisa (detik) = shelfLifeAwal × 3600 − (sekarang − prediksiDibuat)`

Backend mengirim `sisaDetik` bersama waktu pengambilan; frontend menurunkannya tiap detik dari saat data diterima (aman dari selisih jam antar perangkat). Hitung mundur tetap berjalan setelah sesi ditutup, dan riwayat bisa diurutkan menurut sisa terkecil.

## Zona status (dapat diubah di Settings)
| Sisa shelf-life | Status |
|---|---|
| > 24 jam | Layak Jual |
| 8 – 24 jam | Segera Jual |
| < 8 jam | Tidak Layak Jual |

## Mode ML (`ML_MODE` di `backend/.env`)
| Mode | Perilaku |
|---|---|
| `mock` (default) | Selalu memakai model tiruan di backend. Tidak butuh ml-service. |
| `auto` | Coba ml-service; bila gagal jatuh ke mock (dicatat di log). |
| `live` | Wajib ml-service; bila gagal, pembacaan tetap tersimpan tetapi prediksi tidak dibuat. |

Model tiruan (`backend/src/utils/mlMock.js`) memakai tabel Tsl per suhu dari literatur yang dikutip proposal (4°C 141 j, 10°C 72 j, 20°C 24 j, 25°C 14 j, 30°C 8 j), lalu dikurangi oleh TVOC dan RH tinggi. Ini **bukan** hasil model ML dan koefisien koreksinya adalah asumsi.

## Pemisahan tanggung jawab
- `frontend/` dan `backend/`: bagian software.
- `firmware/`: bagian hardware.
- `ml-service/`: bagian ML (tidak ada di repo ini; kontraknya di `docs/api/README.md`).
