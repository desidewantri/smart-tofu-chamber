# Phase 11B — Sheet importer hardening and migration runbook

**Status: prepared, not executed.**

This document is the operator runbook for a future, explicitly approved
migration from the legacy Sheet source (GID `359910033`) to the selected `test`
tab (GID `572072723`). No production Sheet URL, cursor, receipt, database row,
Apps Script deployment, MQTT publication, experiment, chamber, or container was
changed during Phase 11B. Phase 12 was not started.

The companion implementation report is `docs/PHASE11B_REPORT.md`.

---

## 1. Why the old design was unsafe

The legacy importer used cursor keys `sheet:1` and `sheet:2`. Those keys did not
identify the spreadsheet or tab. If the source URL changed to the target tab,
the importer could either:

- reuse the legacy position (`lastRowIndex: 2586`) against a 14-row tab, silently
  skipping all target rows; or
- start at row 0 and reprocess history, creating new receipts and potentially
  new readings.

The target tab also has a different timestamp shape: `sampled_at` is empty,
`received_at` is date-only, and the only reliable measurement time is embedded
in `sample_id`. The old importer would have used `received_at` as the effective
time. That is now forbidden.

---

## 2. Production baseline (read-only audit)

Recorded before any Phase 11B change:

| Item | Value |
|---|---|
| Public health | `ok`, DB connected, MQTT connected (checked 2026-11-05T15:23Z) |
| Legacy source | published CSV URL, GID `359910033`, legacy tab |
| Legacy cursors | `sheet:1` / `sheet:2`, `lastRowIndex: 2586`, `lastTimestamp: 2026-11-04T18:04:50Z` |
| Import receipts | 0 |
| Readings | 4,843 |
| Predictions | 4,843 |
| Sessions | 10 |
| Experiments | 0 |
| Snapshots | 0 |
| Notification events | 0 |
| Active sessions | 2 (CH-009, CH-010) |
| Target tab | spreadsheet `1X-Bh7UX4f1-jNK76X96lixMFh-WrRmQS8dUs5SWMvNA`, GID `572072723` |
| Target rows | 14 at the detailed audit; 18 at the final read-only check (still growing) |
| Target header | `received_at,sample_id,sampled_at,temp1,humid1,tvoc1,temp2,humid2,tvoc2,vbat` |
| Target `sampled_at` | empty in every row |
| Target `received_at` | date-only `11/5/2026` in every row |
| Target `sample_id` | every row matches `tofusense-YYYYMMDDTHHMMSSmmmZ-<uuid>` |
| Target `vbat` | 0–25.69 (percent semantics) |
| Target rows in Mongo | no matching `sampleId`/`eventId` in the 12-row audit; recheck every row appended after that audit at migration time |
| Target writer | live (row count increased during Phase 11B) |

The target tab grew from 12 to 14 rows during the detailed audit and to 18 rows by the final read-only check. **The cutoff
must be computed immediately before the switch; a hardcoded row count is
invalid.** The writer must be frozen before the switch (see §5.3).

### Source identity

The corrected `sourceIdFromUrl` returns:

| URL form | source ID |
|---|---|
| published `/spreadsheets/d/e/<publishedId>/pub?gid=359910033` | `e:<publishedId>:359910033` |
| direct `/spreadsheets/d/<id>/export?format=csv&gid=572072723` | `<id>:572072723` |
| URL without `gid` | `<id>:0` |
| unrecognised URL | `default:0` |

The published token is included because tab GIDs are only unique within one
spreadsheet. The old audit value `e:359910033` is **not** sufficient under the
corrected helper. The runbook computes the actual legacy source ID from the
current production `SHEET_URL`; do not hardcode it.

---

## 3. Implementation contract

### 3.1 Source-scoped cursors

Cursor identity:

```text
sheet:<sourceId>:<chamberId>
```

`ensureCursor` behaves as follows:

1. If the scoped cursor exists, use it.
2. If a legacy `sheet:1`/`sheet:2` cursor exists and `SHEET_LEGACY_SOURCE_ID`
   matches the active source, copy `lastTimestamp` and `lastRowIndex` into the
   scoped cursor and record `migratedFrom` / `migratedAt`.
3. If a legacy cursor exists but no explicit mapping is configured, refuse the
   chamber with `LEGACY_CURSOR_UNMAPPED`. Do not guess.
4. If a legacy cursor exists but the active source is different, create a fresh
   scoped cursor with `lastRowIndex: null`.
5. The legacy document is never modified or deleted.
6. A temporarily truncated/failed CSV clamps the row cursor to the current end
   instead of resetting it to null, so a shrink cannot replay history. An
   intentional sheet replacement requires an explicit operator rewind.

Receipts are source-scoped:

```text
key = sheet:<sourceId>:<rowIndex>:ch<n>
```

The fingerprint lookup is also filtered by `sourceId` and `chamberId`. The same
`sample_id` from two sources keeps two receipt identities, while the
`SensorReading.eventId` unique index still deduplicates the logical event.

### 3.2 Timestamp contract

Resolution order:

1. Valid ISO-8601 `sampled_at` with an explicit timezone (`Z` or `±HH:MM`).
   Offsets are honoured and normalised to UTC.
2. A timestamp extracted from `sample_id` only when it matches exactly:

   ```text
   tofusense-YYYYMMDDTHHMMSSmmmZ-<uuid>
   ```

   The embedded timestamp is UTC. This exact format was validated against every
   row in the target `test` tab.
3. Otherwise quarantine:
   - `TIMESTAMP_MISSING` when neither value is present;
   - `TIMESTAMP_INVALID` when a value is present but unusable and no validated
     `sample_id` timestamp exists.

`received_at` is provenance only. It is never substituted for measurement time.
A date-only `received_at` is retained in the receipt's raw row; for ingestion it
is not used as the receipt clock (the backend uses the import time instead). A
present-but-invalid `sampled_at` falls through to the validated `sample_id`
timestamp; it is not silently replaced by `received_at`.

Stored provenance:

| Field | Values |
|---|---|
| `sampledAt` | resolved measurement time, or null |
| `timestampSource` | `sampled`, `sample_id`, `received_at` (legacy tab only), `missing` |
| `timestampQuality` | `OK`, `SAMPLE_ID`, `MISSING`, `INVALID` |

The importer passes the resolved measurement time into `ingestReading`. The
ingest layer relabels the provenance to `SAMPLE_ID` only when the normal
resolver accepted the timestamp; a future/invalid timestamp keeps the resolver's
`INVALID`/`received_at` outcome instead of being masked.

### 3.3 Battery contract

| Path | Actual value | Evidence |
|---|---|---|
| Legacy firmware → MQTT | voltage (V) | `publishChamber(..., vbatV)` |
| Legacy firmware → Sheet | percent | `uploadSheet` sends `batteryPercent(vbatV)` |
| Bench firmware | omitted | `vbat intentionally omitted` |
| Backend model/dashboard | percent | `SensorReading.battery`, `Chamber.battery` |

`parseBattery` keeps the existing rule:

- `0 < n ≤ 5` → volts, converted with the Li-ion curve;
- `n > 5` → percent, rounded and clamped to 0–100;
- `0` → 0 %;
- empty/invalid/negative → null.

**Known ambiguity:** a genuine percent value at or below 5 % is treated as
voltage. This is existing production behaviour and was not changed. The proposed
future fields are `battery_voltage_v` and `battery_percent`; no production field
or parser behaviour changed in Phase 11B.

### 3.4 Apps Script receiver

`docs/proposed/Code.gs` is the corrected local source. It is **not deployed**.

It keeps the 10-column schema and:

- writes `received_at` as full ISO-8601 UTC;
- preserves a valid `sampled_at` and normalises offsets to UTC;
- derives `sampled_at` from the exact `sample_id` format only when `sampled_at`
  is absent;
- leaves `sampled_at` blank and reports `timestamp_defect` when it is present but
  invalid, or absent with no validated sample-id timestamp;
- keeps sample-id deduplication;
- keeps API-key validation and lock-based concurrent-write protection;
- targets `SHEET_NAME = 'test'`.

Risk: the local source still contains a hardcoded receiver key. Do not print it,
do not commit it to a public repository, and move it to Script Properties and
rotate it before any deployment.

---

## 4. Target-tab policy

The target rows (14 at the detailed audit, 18 at the final check) are treated as **pre-experiment validation data** for the
following recorded reasons:

- no matching Mongo `sampleId`/`eventId` in the 12-row audit; rows appended
  later were format-checked but not rechecked against Mongo;
- no active experiment during the audit;
- production MQTT `lastSeenAt` was `10:32Z` while the target sample IDs run to
  `15:16Z`, consistent with a local/test writer rather than the production
  device.

These assumptions must be rechecked at migration time. Do not delete, rewrite,
or clear any Sheet row.

### Option A — preserve the rows and cut over (recommended)

1. Freeze the target-tab writer.
2. Compute the current last data-row index.
3. Seed the two target cursors at that index.
4. Switch the source.
5. Verify zero target receipts and zero target readings.
6. Start the experiment later and unfreeze the writer only when its rows should
   belong to the experiment.

This preserves the validation rows without importing them.

### Option B — controlled import (not approved now)

The timestamps are technically valid through `sample_id`, but the experimental
context is not: the rows predate any active experiment. Importing them into a
current experiment would attach pre-experiment data with elapsed hours clamped
to zero and could distort baselines. Option B requires separate written approval,
a defined experiment context, and acceptance of that distortion. It is not part
of this runbook's approved path.

**Terminal warning:** without an active experiment, `ingestReading` returns
`NO_ACTIVE_EXPERIMENT`, and the importer records a terminal `UNASSIGNED` receipt
and advances the cursor. A row quarantined this way is not retried automatically.
Do not run the importer against a live target tab while no experiment is active.

---

## 5. Operator migration runbook (future, explicit approval only)

### 5.0 Preconditions

- Written operator approval and a maintenance window.
- Target-tab writer frozen; record who froze it and when.
- No experiment start/stop during the switch unless separately approved.
- Backups verified.
- A named rollback owner.
- Do not print `backend/.env` or any secret.

All commands below run on the production host in the repository root. Use a
shell function so the Compose file is always explicit:

```bash
cd /home/toscha/smart-tofu-chamber
dc() { docker compose -f docker-compose.prod.yml "$@"; }
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BK="backups/phase11b-$STAMP"
umask 077
mkdir -p "$BK"
TARGET_SPREADSHEET_ID='1X-Bh7UX4f1-jNK76X96lixMFh-WrRmQS8dUs5SWMvNA'
TARGET_GID='572072723'
TARGET_URL="https://docs.google.com/spreadsheets/d/${TARGET_SPREADSHEET_ID}/export?format=csv&gid=${TARGET_GID}"
```

### 5.1 Backup

```bash
umask 077
cp backend/.env "$BK/backend.env"
if [ -f .env ]; then cp .env "$BK/root.env"; fi

dc exec -T mongo mongoexport \
  --db=smart_tofu_chamber --collection=importcursors --jsonArray \
  > "$BK/importcursors.json"

dc exec -T mongo mongoexport \
  --db=smart_tofu_chamber --collection=importreceipts --jsonArray \
  > "$BK/importreceipts.json"

dc exec -T mongo mongosh smart_tofu_chamber --quiet --eval '
const out = {
  readings: db.sensorreadings.countDocuments(),
  predictions: db.predictions.countDocuments(),
  sessions: db.sesis.countDocuments(),
  experiments: db.experiments.countDocuments(),
  snapshots: db.rslsnapshots.countDocuments(),
  notifications: db.notificationevents.countDocuments(),
  receipts: db.importreceipts.countDocuments(),
  cursors: db.importcursors.find({}, {
    _id: 0, key: 1, sourceId: 1, lastRowIndex: 1, lastTimestamp: 1,
    migratedFrom: 1, migratedAt: 1
  }).sort({ key: 1 }).toArray()
};
print(EJSON.stringify(out, null, 2));
' > "$BK/baseline.json"

find "$BK" -maxdepth 1 -type f ! -name SHA256SUMS -print0 \
  | sort -z | xargs -0 sha256sum > "$BK/SHA256SUMS"
```

`mongoexport`, `mongoimport`, `mongodump`, and `mongorestore` are present in the
`mongo:7` image. `backend/.env` is copied with mode 600 because it contains
secrets; never cat it.

### 5.2 Verify both sources

Current production source (prints only the derived ID and GID flag, not the URL):

```bash
LEGACY_SOURCE_ID=$(dc exec -T backend node -e '
const s = require("./src/services/sheetImportService");
console.log(s.sourceIdFromUrl(process.env.SHEET_URL));
' | tr -d "\r")

dc exec -T backend node -e '
const s = require("./src/services/sheetImportService");
console.log(JSON.stringify({
  sourceId: s.sourceIdFromUrl(process.env.SHEET_URL),
  explicitGid: s.hasExplicitGid(process.env.SHEET_URL)
}));
'
```

Expected: `explicitGid: true`, and `LEGACY_SOURCE_ID` ends with `:359910033`.
The prefix is `e:<publishedId>` for a published URL, or the spreadsheet ID for a
direct export URL. Record the exact value; it is the migration mapping.

Target source:

```bash
TARGET_SOURCE_ID=$(dc exec -T backend node -e '
const s = require("./src/services/sheetImportService");
console.log(s.sourceIdFromUrl(process.argv[1]));
' "$TARGET_URL" | tr -d "\r")

dc exec -T backend node -e '
const s = require("./src/services/sheetImportService");
console.log(JSON.stringify({
  sourceId: s.sourceIdFromUrl(process.argv[1]),
  explicitGid: s.hasExplicitGid(process.argv[1])
}));
' "$TARGET_URL"
```

Expected: `TARGET_SOURCE_ID` is
`1X-Bh7UX4f1-jNK76X96lixMFh-WrRmQS8dUs5SWMvNA:572072723`.

Fetch the header, row count, and last index through the implementation parser:

```bash
dc exec -T backend node -e '
const s = require("./src/services/sheetImportService");
fetch(process.argv[1]).then(async (r) => {
  if (!r.ok) throw new Error("HTTP " + r.status);
  const rows = s.parseCsv(await r.text());
  console.log(JSON.stringify({
    status: r.status,
    header: rows[0],
    dataRows: Math.max(0, rows.length - 1),
    lastIndex: Math.max(-1, rows.length - 2)
  }));
}).catch((e) => { console.error(e.message); process.exit(1); });
' "$TARGET_URL" | tee "$BK/target-audit.json"
```

Verify every target `sample_id` matches the exact timestamp format:

```bash
dc exec -T backend node -e '
const s = require("./src/services/sheetImportService");
fetch(process.argv[1]).then(r => r.text()).then((text) => {
  const rows = s.parseCsv(text);
  const bad = [];
  for (let i = 1; i < rows.length; i += 1) {
    const id = String(rows[i][1] || "").trim();
    if (!s.extractSampleIdTimestamp(id)) bad.push(i);
  }
  console.log(JSON.stringify({
    dataRows: Math.max(0, rows.length - 1),
    badSampleIdRows: bad
  }));
});
' "$TARGET_URL" | tee "$BK/target-sample-ids.json"
```

Expected: `badSampleIdRows: []`. If not empty, **stop**. The timestamp fallback is
not safe for those rows.

### 5.3 Freeze the target writer

Stop the device/Apps Script that writes the `test` tab. Record the operator and
time. Do not skip this step: the tab grew during Phase 11B, and any row appended
after the cutoff will be processed on the next poll. If no experiment is active,
those rows become terminal `UNASSIGNED`.

### 5.4 Option A — compute the cutoff and seed target cursors

Recompute immediately before seeding; do not reuse the earlier count:

```bash
TARGET_LAST_INDEX=$(dc exec -T backend node -e '
const s = require("./src/services/sheetImportService");
fetch(process.argv[1]).then(r => r.text()).then((text) => {
  console.log(Math.max(-1, s.parseCsv(text).length - 2));
});
' "$TARGET_URL" | tr -d "\r")

echo "target last index: $TARGET_LAST_INDEX"
```

Seed the two target cursors. The script refuses to overwrite an existing cursor:

```bash
dc exec -T mongo mongosh smart_tofu_chamber --quiet --eval "
const sourceId = '$TARGET_SOURCE_ID';
const lastIndex = $TARGET_LAST_INDEX;
const now = new Date();
for (const n of [1, 2]) {
  const key = 'sheet:' + sourceId + ':' + n;
  if (db.importcursors.findOne({ key })) {
    print('REFUSING: cursor already exists: ' + key);
    quit(2);
  }
  db.importcursors.insertOne({
    key: key,
    sourceId: sourceId,
    lastRowIndex: lastIndex,
    lastTimestamp: null,
    leaseUntil: null,
    leaseOwner: null,
    migratedFrom: null,
    migratedAt: null,
    createdAt: now,
    updatedAt: now,
    __v: 0
  });
  print('created ' + key + ' lastRowIndex=' + lastIndex);
}
"
```

If it refuses, stop and inspect. Do not delete or reset the existing cursor
without an explicit decision.

Verify all cursor documents:

```bash
dc exec -T mongo mongosh smart_tofu_chamber --quiet --eval '
printjson(db.importcursors.find({}, {
  _id: 0, key: 1, sourceId: 1, lastRowIndex: 1, lastTimestamp: 1,
  migratedFrom: 1, migratedAt: 1
}).sort({ key: 1 }).toArray());
'
```

Expected before the switch:

- `sheet:1` / `sheet:2`: `lastRowIndex: 2586`, unchanged;
- `sheet:<targetSourceId>:1/2`: `lastRowIndex: TARGET_LAST_INDEX`;
- `sheet:<legacySourceId>:1/2`: not created yet. They are created in §5.5
  while the legacy source is still active.

### 5.5 Prepare the legacy scoped cursors (still on the legacy source)

This is the only step that copies `sheet:1`/`sheet:2` into the scoped legacy
keys. It must run **before** the target switch. The active source stays legacy,
so the importer continues from the same position.

Edit `backend/.env` and add only:

```text
SHEET_LEGACY_SOURCE_ID=<value of LEGACY_SOURCE_ID from §5.2>
```

Keep the existing `SHEET_URL` (legacy) and all other Sheet settings unchanged.
Recreate the backend:

```bash
dc up -d --force-recreate backend
```

Wait for health and one poll, then verify:

```bash
dc exec -T backend node -e '
fetch("http://127.0.0.1:5000/api/health").then(r => r.text()).then(console.log);
'

dc exec -T mongo mongosh smart_tofu_chamber --quiet --eval '
printjson(db.importcursors.find({}, {
  _id: 0, key: 1, sourceId: 1, lastRowIndex: 1, lastTimestamp: 1,
  migratedFrom: 1, migratedAt: 1
}).sort({ key: 1 }).toArray());
'
```

Expected:

- `sheet:1` / `sheet:2`: still exactly `lastRowIndex: 2586`, untouched;
- `sheet:<legacySourceId>:1/2`: `lastRowIndex >= 2586`,
  `migratedFrom: sheet:1` / `sheet:2`, `migratedAt` set. The scoped cursor may
  advance if new legacy rows arrived during the poll; that is normal.

If the scoped legacy cursor is missing or the old cursor changed, **stop**.
Do not continue until this is explained.

### 5.6 Switch to the target source

Edit `backend/.env` with an editor (never `echo` secrets):

```text
SHEET_URL=https://docs.google.com/spreadsheets/d/1X-Bh7UX4f1-jNK76X96lixMFh-WrRmQS8dUs5SWMvNA/export?format=csv&gid=572072723
SHEET_LEGACY_SOURCE_ID=<value of LEGACY_SOURCE_ID from §5.2>
```

Keep the existing `SHEET_MODE`, `SHEET_POLL_SEC`, `SHEET_TZ_OFFSET`,
`SHEET_DATE_ORDER`, and `SHEET_FALLBACK_*` values unless separately reviewed.
If `SHEET_IMPORT_SINCE` is set, confirm it does not exclude the rows you intend
to import; clear it only with an explicit decision.

Verify one line each without printing values:

```bash
grep -c '^SHEET_URL=' backend/.env
grep -c '^SHEET_LEGACY_SOURCE_ID=' backend/.env
```

Both must print `1`.

Immediately before switching, re-run the target audit from §5.2. If `lastIndex`
differs from `$TARGET_LAST_INDEX`, **stop** and decide explicitly:

- if the new rows are also pre-experiment validation data, advance the target
  cursor to the new index with an explicit `updateOne`:

  ```bash
  NEW_TARGET_LAST_INDEX=<new index from the audit>
  dc exec -T mongo mongosh smart_tofu_chamber --quiet --eval "
  const sourceId = '$TARGET_SOURCE_ID';
  const lastIndex = $NEW_TARGET_LAST_INDEX;
  for (const n of [1, 2]) {
    db.importcursors.updateOne(
      { key: 'sheet:' + sourceId + ':' + n },
      { \$set: { lastRowIndex: lastIndex, updatedAt: new Date() } }
    );
  }
  print('advanced target cursors to ' + lastIndex);
  "
  ```

- if they should be imported, leave the cursor where it is.

Do not change the cursor silently.

### 5.7 Recreate the backend

`restart` does not reload `env_file`; recreate the container:

```bash
dc up -d --force-recreate backend
```

Wait for health:

```bash
dc exec -T backend node -e '
fetch("http://127.0.0.1:5000/api/health")
  .then(r => r.text())
  .then(console.log);
'
```

Watch the importer:

```bash
dc logs --tail=100 backend | grep -E '\[sheet\]|cursor'
```

### 5.8 Verify the switch

Cursors and source IDs:

```bash
cat > "$BK/verify-cursors.js" <<EOF
const target = "$TARGET_SOURCE_ID";
const legacy = "$LEGACY_SOURCE_ID";
printjson({
  legacyDocs: db.importcursors.find(
    { key: { \$in: ["sheet:1", "sheet:2"] } },
    { _id: 0, key: 1, lastRowIndex: 1, lastTimestamp: 1 }
  ).toArray(),
  scopedDocs: db.importcursors.find(
    { sourceId: { \$in: [legacy, target] } },
    { _id: 0, key: 1, sourceId: 1, lastRowIndex: 1, lastTimestamp: 1,
      migratedFrom: 1, migratedAt: 1 }
  ).sort({ key: 1 }).toArray()
});
EOF
dc exec -T mongo mongosh smart_tofu_chamber --quiet < "$BK/verify-cursors.js"
```

Receipts and counts:

```bash
cat > "$BK/verify-receipts.js" <<EOF
const target = "$TARGET_SOURCE_ID";
const legacy = "$LEGACY_SOURCE_ID";
printjson({
  targetReceipts: db.importreceipts.countDocuments({ sourceId: target }),
  legacyReceipts: db.importreceipts.countDocuments({ sourceId: legacy }),
  targetRowsAtOrBelowCutoff: db.importreceipts.countDocuments({
    sourceId: target,
    rowIndex: { \$lte: $TARGET_LAST_INDEX }
  }),
  targetStatuses: db.importreceipts.aggregate([
    { \$match: { sourceId: target } },
    { \$group: { _id: "\$status", n: { \$sum: 1 } } }
  ]).toArray(),
  targetChambers: db.importreceipts.aggregate([
    { \$match: { sourceId: target } },
    { \$group: { _id: "\$chamberId", n: { \$sum: 1 } } }
  ]).toArray()
});
EOF
dc exec -T mongo mongosh smart_tofu_chamber --quiet < "$BK/verify-receipts.js"
```

For Option A with the writer frozen, expect `targetReceipts: 0`,
`targetRowsAtOrBelowCutoff: 0`, and no target readings. If new rows arrived after
the cutoff, inspect their receipts and sample IDs; do not assume they are
validation data.

Reading/prediction counts:

```bash
cat > "$BK/verify-counts.js" <<'EOF'
printjson({
  readings: db.sensorreadings.countDocuments(),
  predictions: db.predictions.countDocuments(),
  sessions: db.sesis.countDocuments(),
  experiments: db.experiments.countDocuments(),
  snapshots: db.rslsnapshots.countDocuments(),
  notifications: db.notificationevents.countDocuments()
});
EOF
dc exec -T mongo mongosh smart_tofu_chamber --quiet < "$BK/verify-counts.js"
```

Compare with `$BK/baseline.json`. Live MQTT may add readings; a jump of exactly
28 (14 rows × 2 chambers) is the signature of an unintended target import.

Chamber mapping and no replay:

```bash
cat > "$BK/verify-samples.js" <<EOF
const target = "$TARGET_SOURCE_ID";
printjson(db.importreceipts.find(
  { sourceId: target },
  { _id: 0, rowIndex: 1, chamberId: 1, sampleId: 1, status: 1, reason: 1 }
).sort({ rowIndex: 1, chamberId: 1 }).limit(10).toArray());
EOF
dc exec -T mongo mongosh smart_tofu_chamber --quiet < "$BK/verify-samples.js"
```

### 5.9 Rollback

Rollback restores the **source selection**, not deleted data.

```bash
cp "$BK/backend.env" backend/.env
dc up -d --force-recreate backend
```

Verify the legacy source is active:

```bash
dc exec -T backend node -e '
const s = require("./src/services/sheetImportService");
console.log(JSON.stringify({
  sourceId: s.sourceIdFromUrl(process.env.SHEET_URL),
  explicitGid: s.hasExplicitGid(process.env.SHEET_URL)
}));
'
```

Verify the legacy cursors:

```bash
dc exec -T mongo mongosh smart_tofu_chamber --quiet --eval '
printjson(db.importcursors.find(
  { key: { $in: ["sheet:1", "sheet:2"] } },
  { _id: 0, key: 1, lastRowIndex: 1, lastTimestamp: 1 }
).toArray());
'
```

Expected: `sheet:1`/`sheet:2` still at 2586. The scoped legacy cursor may have
advanced only by rows imported after the switch; the target cursor is left in
place for audit. Do not delete it.

If a full cursor/receipt restore is required, stop the backend and upsert the
backups (this matches on `_id` and does not delete newer documents):

```bash
dc stop backend
dc exec -T mongo mongoimport \
  --db=smart_tofu_chamber --collection=importcursors \
  --jsonArray --mode=upsert < "$BK/importcursors.json"
dc exec -T mongo mongoimport \
  --db=smart_tofu_chamber --collection=importreceipts \
  --jsonArray --mode=upsert < "$BK/importreceipts.json"
dc up -d backend
```

`--drop` is a destructive disaster-recovery option; use it only with explicit
approval. Rollback does not delete readings created from target rows. Identify
them first:

```bash
cat > "$BK/find-target-readings.js" <<EOF
const target = "$TARGET_SOURCE_ID";
printjson(db.importreceipts.find(
  { sourceId: target, status: "IMPORTED" },
  { _id: 0, sampleId: 1, eventId: 1, chamberId: 1, rowIndex: 1 }
).toArray());
EOF
dc exec -T mongo mongosh smart_tofu_chamber --quiet < "$BK/find-target-readings.js"
```

Deleting those documents is a separate destructive operation and is not part of
this runbook.

### 5.10 Option B — controlled import (not approved)

Only after separate written approval:

1. Define the experiment context and record why pre-experiment validation rows
   should belong to it.
2. Start the experiment and ensure both chamber sessions exist.
3. Freeze the target writer.
4. Seed the target cursor at `lastRowIndex: -1` **only if no target cursor
   exists**. Do not reset an existing cursor.
5. Let one poll run; verify receipts, readings, chamber mapping, and timestamps.
6. Stop the experiment.

Do not run this while no experiment is active: `UNASSIGNED` is terminal.

### 5.11 Acceptance evidence

Write the following into `$BK/acceptance.md`:

- operator, timestamp, approval reference;
- target row count and last index at cutoff;
- source IDs and cursor documents before/after;
- baseline and post-switch counts;
- target receipt count/status/chamber mapping;
- confirmation that `sheet:1`/`sheet:2` are unchanged;
- confirmation that no target row at or below the cutoff was imported;
- health output;
- rollback owner and rollback result, if used.

---

## 6. Risks and unresolved decisions

1. **Live target tab.** It grew from 12 to 14 rows during Phase 11B. Freeze the
   writer or accept that post-cutoff rows will be imported. With no active
   experiment, those rows become terminal `UNASSIGNED`.
2. **Pre-experiment classification.** The 14 rows are assumed to be validation
   data. Recheck Mongo matches and experimental context at migration time.
3. **`sampled_at` is empty.** Measurement time depends on the exact `sample_id`
   format. A format change will quarantine new rows.
4. **Date-only `received_at`.** It is not a reliable receipt clock; the raw cell
   is retained in the receipt. The corrected Apps Script writes full ISO-8601.
5. **Battery ambiguity.** A true percent ≤ 5 % is treated as voltage. Production
   semantics were not changed. Explicit future fields are proposed.
6. **Published source identity changed.** Compute `SHEET_LEGACY_SOURCE_ID` from
   the current URL; do not reuse `e:359910033`.
7. **Hardcoded Apps Script key.** Move to Script Properties and rotate before
   deployment. Do not print the value.
8. **Authenticated dashboard/history** remains unverified without authorized
   credentials.
9. **Frontend healthcheck** is prepared in the local production Compose file but
   not deployed.
10. **No production migration, Phase 12, or redeploy** was performed.

---

## 7. Changed files in Phase 11B

- `backend/src/services/sheetImportService.js`
- `backend/src/services/ingestService.js`
- `backend/src/models/ImportCursor.js`
- `backend/src/models/SensorReading.js`
- `backend/src/config/env.js`
- `backend/tests/importer_hardening.test.js`
- `backend/tests/battery.test.js`
- `backend/.env.example`
- `docs/proposed/Code.gs`
- `frontend/src/components/common/ProvenanceBadge.jsx`
- `docker-compose.prod.yml`
- `docs/data_contract.md`
- `docs/TESTING.md`
- `docs/SHEET_MIGRATION_PHASE11B.md` (this file)
- `docs/PHASE11B_REPORT.md`

---

## 8. Regression evidence

| Check | Result |
|---|---|
| Full backend suite | 215/215 pass |
| Importer hardening | 37/37 pass |
| Battery contract | 5/5 pass |
| Sheet + legacy + importer + battery | 59/59 pass |
| Phase 8 E2E | pass |
| Phase 9 E2E | pass |
| Phase 10 E2E | pass |
| Phase 10.1 E2E | pass |
| Phase 10.2 E2E | pass |
| Backend syntax (`node --check`) | pass |
| Apps Script syntax (`.gs` as `.js`) | pass |
| Frontend production build | pass |
| Production Compose config | pass |
| Real target CSV through `rowsToReadings` | 14-row snapshot → 28 readings; 18-row final check → 36 readings, all `SAMPLE_ID` |
| Real target CSV through `processRows` (in-memory models) | 14-row snapshot: 28 imported, 0 rejected, cursors at 13 |

Production health was read-only checked at 2026-11-05T15:23Z and remained
`ok`/connected. No production mutation was performed.

---

## 9. Verdict

**PASS — implementation and regression complete; production migration
prepared.**

This verdict does **not** mean the production migration is complete. It was not
executed, and Phase 12 was not started.
