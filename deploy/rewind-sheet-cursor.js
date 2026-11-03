// Mundurkan penanda impor Google Sheet ke data terakhir yang benar-benar tersimpan per chamber,
// supaya baris yang dulu ditolak (mis. TVOC > 60000) diimpor ulang oleh backend.
// Jalankan di server:
//   docker compose -f docker-compose.prod.yml exec -T mongo mongosh smart_tofu_chamber --quiet < deploy/rewind-sheet-cursor.js
for (const n of [1, 2]) {
  const r = db.sensorreadings.find({ chamberId: n }).sort({ timestamp: -1 }).limit(1).toArray()[0];
  const ts = r ? r.timestamp : null;
  db.importcursors.updateOne({ key: 'sheet:' + n }, { $set: { lastTimestamp: ts } }, { upsert: true });
  print('chamber ' + n + ': impor ulang mulai setelah ' + ts);
}
