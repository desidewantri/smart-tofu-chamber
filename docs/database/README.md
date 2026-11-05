# Database (MongoDB, nama DB `smart_tofu_chamber`)

Satu sesi punya banyak pembacaan sensor dan banyak prediksi.

```
experiments 1 ─── * sesis 1 ─── * sensorreadings
      │                 1 ─── * predictions
      └── 1..2 rslsnapshots
      └── * notificationevents
users, systemsettings, importcursors (berdiri sendiri)
```

## `experiments`
| Field | Tipe | Keterangan |
|---|---|---|
| `label` | String | Label eksperimen (opsional, maks 120 karakter). |
| `startedAt` | Date | Acuan elapsed time/RSL; dibuat server (UTC), tidak diubah oleh pesan terlambat. |
| `endedAt` | Date | Waktu stop; sama untuk kedua sesi. |
| `status` | `aktif` / `selesai` | Hanya satu eksperimen `aktif` (unique partial index). |
| `chamberIds` | [Number] | Default `[1,2]`. |
| `storageCondition` | `DRY` / `WATER` / `UNKNOWN` | Default domain `DRY`; RSL hanya mendukung `DRY`. |
| `rslSnapshotStatus` | `PENDING` / `COMPLETE` / null | Kelengkapan persistensi snapshot, bukan status statistik. |
| `rslSnapshotExpectedCount`, `rslSnapshotCompletedCount` | Number | Target dan jumlah dokumen snapshot terverifikasi. |
| `rslSnapshotLastAttemptAt`, `rslSnapshotLastErrorCode`, `rslSnapshotRecoveredAt` | Date/String | Audit percobaan rekonsiliasi. |
| `rslSnapshotAttempts`, `rslSnapshotNextAttemptAt`, `rslSnapshotLeaseUntil`, `rslSnapshotLeaseOwner` | Number/Date/String | Backoff dan lease worker. |
| `finalizationStatus` | `PENDING` / `COMPLETE` / null | Finalisasi lifecycle: eksperimen + dua sesi + dua snapshot. |
| `finalizationExpectedSessionCount`, `finalizationClosedSessionCount` | Number | Target dan jumlah sesi yang terverifikasi tertutup. |
| `finalizationLastAttemptAt`, `finalizationLastErrorCode`, `finalizationRecoveredAt` | Date/String | Audit finalisasi. |
| `finalizationAttempts`, `finalizationNextAttemptAt` | Number/Date | Backoff finalisasi. |

Index `experiments`: `rsl_snapshot_recovery_queue` pada
`{status, rslSnapshotStatus, rslSnapshotNextAttemptAt}` dan
`experiment_finalization_queue` pada
`{status, finalizationStatus, finalizationNextAttemptAt}` untuk discovery worker.

## `sesis` (SESI)
| Field | Tipe | Keterangan |
|---|---|---|
| `seq`, `sesiCode` | Number, String | Urutan dan kode `CH-001`. |
| `experimentId` | ObjectId / null | Referensi eksperimen; null untuk sesi historis. |
| `chamberId` | Number | Nomor chamber. Hanya satu sesi `aktif` per chamber (indeks unik parsial). |
| `status` | `aktif` / `selesai` | |
| `sampleStatus` | `UNKNOWN` / `NOT_SPOILED` / `SPOILED` | Status operator per chamber; default `UNKNOWN`, tidak pernah diisi dari sensor. |
| `sampleStatusUpdatedAt`, `sampleStatusUpdatedBy` | Date, ObjectId | Audit perubahan terakhir. |
| `sampleStatusHistory` | Array `{status, at, by}` | Riwayat perubahan status. |
| `storageCondition` | `DRY` / `WATER` / `UNKNOWN` | Disalin dari experiment saat start; RSL hanya `DRY`. |
| `masuk`, `selesai` | Date | Waktu reading pertama dan waktu sesi ditutup. `masuk` null sampai reading pertama untuk sesi eksperimen baru. |
| `tvoc_awal`, `suhu_awal`, `rh_awal` | Number | Pembacaan pertama sesi. |
| `shelfLifeAwal` | Number (jam) | Prediksi **terbaru** (hanya maju bila waktu sampel lebih baru). |
| `prediksiDibuat` | Date | t0 prediksi terbaru = waktu sampel. |
| `shelfLifeMulai` | Number (jam) | Prediksi **pertama** (analisis musiman). |
| `modelUsed`, `readingCount` | | Model terakhir, jumlah pembacaan (n_t). |
| `statusAkhir`, `sisaAkhirJam` | | Status saat sesi ditutup. |
| `notified.*` | Date | Penanda notifikasi agar sekali per sesi. |

Index `sesis`: unique `seq`/`sesiCode`, unique partial `{chamberId}` untuk `status:'aktif'`,
unique partial `{experimentId, chamberId}` untuk sesi aktif ber-`experimentId`, dan
`{experimentId, chamberId, status}` untuk lookup ingestion/API. Field RSL baru
tidak menambah index; tidak ada backfill wajib (dokumen lama tetap terbaca dengan
fallback `UNKNOWN`/`DRY` di presenter).

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
(posisi baris CSV terakhir; cursor utama agar `sampled_at` yang tidak urut tetap aman),
`leaseUntil`/`leaseOwner` (lease 5 menit (diperbarui tiap 50 baris) agar dua proses importer tidak memproses
chamber yang sama bersamaan; lease kedaluwarsa otomatis setelah crash).

## `importreceipts`
Outcome durable per baris sumber, terpisah dari identitas firmware:

| Field | Keterangan |
|---|---|
| `key` | Identitas baris importer (unik), mis. `sheet:<sourceId>:<rowIndex>:ch<n>`. |
| `sourceId`, `rowIndex` | Spreadsheet/gid dan posisi baris. |
| `rowFingerprint` | SHA-256 baris; mendeteksi baris yang pindah posisi. |
| `chamberId`, `sampleId`, `eventId` | Metadata baris; `eventId` null untuk baris legacy. |
| `experimentId` | Eksperimen saat reading diterima (jika ada). |
| `status` | `IMPORTED`, `DUPLICATE`, `QUARANTINED_INVALID`, `UNASSIGNED`, `QUARANTINED_INTEGRITY`, `QUARANTINED_RETRY_EXHAUSTED`, `RETRYABLE_ERROR`. |
| `reason`, `rawRow`, `attempts`, `lastError` | Audit dan bahan recovery operator. |

Status terminal membuat cursor maju; `RETRYABLE_ERROR` tidak memajukan cursor.
`UNASSIGNED`/`QUARANTINED_INVALID` tidak pernah otomatis dimasukkan ke eksperimen
berikutnya. Index unik `key`, index `rowFingerprint`, index `status`.

## `rslsnapshots`
Snapshot RSL final per chamber, dibuat saat stop. Satu dokumen per
`experimentId + chamberId` dan per `sessionId` (dua unique index).

Field utama: `experimentId, sessionId, chamberId, experimentLabel, sesiCode,
storageCondition, snapshotAt, endedAt, elapsedHours, sampleStatus,
sampleStatusUpdatedAt, status (AVAILABLE/UNAVAILABLE), reason, message, primary,
supporting, metadata, timestampQuality, lastReadingAt, readingCount,
schemaVersion`. Nilai M1/M2/M3 disimpan presisi penuh; `primary.display` hanya
presentasi. Tidak ada overwrite saat dashboard refresh atau stop berulang.

Index: unique `{experimentId, chamberId}`, unique `{sessionId}`.

Eksperimen dengan snapshot lengkap memiliki tepat satu dokumen chamber 1 dan satu
dokumen chamber 2, keduanya memakai `snapshotAt = Experiment.endedAt`. Worker
memverifikasi dokumen aktual, bukan hanya counter.

## `notificationevents`
Event notifikasi RSL persisten. Field: `experimentId, sessionId, chamberId,
kind (rsl_watch/rsl_low), thresholdHours, lowerHours, upperHours, level, title,
message, disclaimer, deliveryStatus (in_app/sent/failed), sentAt, error`.

Index unik `{experimentId, sessionId, chamberId, kind, thresholdHours}` adalah
batas deduplikasi. Perubahan threshold menghasilkan identitas baru; polling
biasa tidak. Event lama tetap tersimpan sebagai audit.

## `users`
`name, email (unik), password (bcrypt), role`.

## `systemsettings`
Satu dokumen (`key: "default"`): nama aplikasi, interval, zona status, notifikasi,
batas parameter sensor, asumsi bisnis.

Catatan: Analisis Kondisi, Biaya & Manfaat, dan Musiman **dihitung** dari koleksi
di atas; tidak ada koleksi analisis terpisah.
