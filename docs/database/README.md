# Database (MongoDB, nama DB `smart_tofu_chamber`)

Satu sesi punya banyak pembacaan sensor dan banyak prediksi.

```
chambers 1 ─── * sesis 1 ─── * sensorreadings
                       1 ─── * predictions
users, systemsettings, importcursors (berdiri sendiri)
```

## `sesis` (SESI)
| Field | Tipe | Keterangan |
|---|---|---|
| `seq`, `sesiCode` | Number, String | Urutan dan kode `CH-001`. |
| `chamberId` | Number | Nomor chamber. Hanya satu sesi `aktif` per chamber (indeks unik parsial). |
| `status` | `aktif` / `selesai` | |
| `masuk`, `selesai` | Date | Waktu tahu masuk dan keluar. |
| `tvoc_awal`, `suhu_awal`, `rh_awal` | Number | Pembacaan pertama sesi. |
| `shelfLifeAwal` | Number (jam) | Prediksi **terbaru** (hanya maju bila waktu sampel lebih baru). |
| `prediksiDibuat` | Date | t0 prediksi terbaru = waktu sampel. |
| `shelfLifeMulai` | Number (jam) | Prediksi **pertama** (analisis musiman). |
| `modelUsed`, `readingCount` | | Model terakhir, jumlah pembacaan (n_t). |
| `statusAkhir`, `sisaAkhirJam` | | Status saat sesi ditutup. |
| `notified.*` | Date | Penanda notifikasi agar sekali per sesi. |

## `sensorreadings`
| Field | Keterangan |
|---|---|
| `eventId` | `<sample_id>-ch<n>`, identitas lintas sumber. **Unique partial index** (hanya dokumen dengan string `eventId`). |
| `sampleId`, `deviceId` | Identitas siklus dan alat. |
| `chamberId` | 1 atau 2. |
| `sesiId` | Referensi sesi. |
| `tvoc` (ppb), `suhu` (°C), `rh` (%) | Nilai sensor. |
| `battery` (%) | Opsional. |
| `timestamp` | Waktu efektif untuk pengurutan. |
| `sampledAt` | Waktu alat mengukur; `null` bila tidak ada/tidak sah. |
| `receivedAt` | Waktu backend menerima. |
| `timestampSource` | `sampled` atau `received_at`. |
| `timestampQuality` | `OK`, `MISSING`, `INVALID`. |
| `source` | `mqtt`, `sheet`, atau `http`. |
| `sources` | Semua jalur yang membawa event ini, mis. `["mqtt","sheet"]`. |
| `createdAt` | Waktu insert. |

Index: `{chamberId, timestamp}`, `{sesiId, timestamp}`, dan unique parsial `{eventId}`.
Baris lama tanpa `eventId` tidak terkena index dan tetap terbaca.

**Duplikat:** unique index menolak insert kedua. `sources` ditambah, dokumen asli
tidak diubah, dan tidak ada prediksi/sesi/notifikasi baru.

## `predictions`
`sesiId, chamberId, tvoc_snapshot, suhu_snapshot, rh_snapshot, shelfLifeJam, modelUsed (random_forest|lstm|hybrid|mock), prediksiDibuat, createdAt`.
`prediksiDibuat` memakai waktu sampel agar grafik kronologis.

## `chambers`
`chamberId (unik), code (CHAMBER-1), name, enabled, lastSeenAt, battery, batteryAt`.
`lastSeenAt` = kapan backend terakhir mendengar alat (waktu terima), bukan waktu
sampel. Chamber dianggap *terhubung* bila `lastSeenAt` lebih baru dari 3× interval.

## `importcursors`
`key` (`sheet:1`/`sheet:2`), `lastTimestamp` (kompatibilitas), `lastRowIndex`
(posisi baris CSV terakhir; cursor utama agar `sampled_at` yang tidak urut tetap aman).

## `users`
`name, email (unik), password (bcrypt), role`.

## `systemsettings`
Satu dokumen (`key: "default"`): nama aplikasi, interval, zona status, notifikasi,
batas parameter sensor, asumsi bisnis.

Catatan: Analisis Kondisi, Biaya & Manfaat, dan Musiman **dihitung** dari koleksi
di atas; tidak ada koleksi analisis terpisah.
