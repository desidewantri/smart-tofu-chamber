# Database (MongoDB, nama DB `smart_tofu_chamber`)

Satu sesi punya banyak pembacaan sensor dan banyak prediksi.

```
chambers 1 ─── * sesis 1 ─── * sensorreadings
                       1 ─── * predictions
users, systemsettings (berdiri sendiri)
```

## `sesis` (SESI)
| Field | Tipe | Keterangan |
|---|---|---|
| `seq`, `sesiCode` | Number, String | Urutan dan kode `SES-001`. |
| `chamberId` | Number | Nomor chamber. Hanya satu sesi `aktif` per chamber (indeks unik parsial). |
| `status` | `aktif` / `selesai` | |
| `masuk`, `selesai` | Date | Waktu tahu masuk dan keluar. |
| `tvoc_awal`, `suhu_awal`, `rh_awal` | Number | Pembacaan pertama sesi. |
| `shelfLifeAwal` | Number (jam) | Prediksi **terbaru**. |
| `prediksiDibuat` | Date | t0 prediksi terbaru. |
| `shelfLifeMulai` | Number (jam) | Prediksi **pertama** (dipakai analisis musiman). Tambahan di luar proposal. |
| `modelUsed`, `readingCount` | | Model terakhir, jumlah pembacaan (n_t). |
| `statusAkhir`, `sisaAkhirJam` | | Status saat sesi ditutup. Tambahan untuk halaman Riwayat. |

## `sensorreadings`
`chamberId, sesiId, tvoc (ppb), suhu (°C), rh (%), timestamp, createdAt`. Indeks `{chamberId, timestamp}` dan `{sesiId, timestamp}`.

## `predictions`
`sesiId, chamberId, tvoc_snapshot, suhu_snapshot, rh_snapshot, shelfLifeJam, modelUsed (random_forest|lstm|hybrid|mock), prediksiDibuat, createdAt`.

## `chambers`
`chamberId (unik), code (CH-001), name, enabled, lastSeenAt`. Chamber dianggap *terhubung* bila `lastSeenAt` lebih baru dari 3× interval pembaruan.

## `users`
`name, email (unik), password (bcrypt), role`.

## `systemsettings`
Satu dokumen (`key: "default"`): nama aplikasi, interval, zona status, notifikasi, batas parameter sensor, asumsi bisnis. Dibuat otomatis dengan nilai bawaan.

Catatan: Analisis Kondisi, Biaya & Manfaat, dan Musiman **dihitung** dari koleksi di atas; tidak ada koleksi analisis terpisah.
