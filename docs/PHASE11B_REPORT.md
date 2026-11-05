# Phase 11B — Sheet importer hardening and migration preparation

**Verdict: PASS — implementation and regression complete; production migration
prepared.**

Production migration was **not** executed. Phase 12 was **not** started. No
production `SHEET_URL`, cursor, receipt, database row, Apps Script, MQTT topic,
experiment, chamber, or container was changed.

---

## 1. Scope

Phase 11B repaired the Google Sheets ingestion architecture locally and prepared
an operator-approved migration from the legacy tab (GID `359910033`) to the
selected `test` tab (GID `572072723`).

Delivered:

1. Source-scoped import cursors with explicit legacy migration.
2. Strict timestamp resolution and quarantine.
3. Corrected local Apps Script receiver (not deployed).
4. Battery `vbat` semantic audit and validation tests.
5. Target-tab migration policy with two explicit options.
6. Exact production migration/rollback runbook.
7. Full local regression evidence.

---

## 2. Implementation summary

### 2.1 Source-scoped cursors

Cursor identity is now:

```text
sheet:<sourceId>:<chamberId>
```

- `sourceIdFromUrl` returns `e:<publishedId>:<gid>` for published URLs,
  `<spreadsheetId>:<gid>` for direct export URLs, and `<id>:0` when no GID is
  present. The published token is included because GIDs are only unique within
  one spreadsheet.
- Existing `sheet:1` / `sheet:2` documents are legacy. They are copied to the
  scoped key only when `SHEET_LEGACY_SOURCE_ID` explicitly matches the active
  source.
- The copy records `migratedFrom` and `migratedAt`; the legacy document is never
  modified or deleted.
- If a legacy cursor exists without an explicit mapping, the importer refuses
  with `LEGACY_CURSOR_UNMAPPED` instead of guessing.
- Import receipts are source-scoped by key and by fingerprint lookup.
- A temporarily truncated/failed CSV clamps the row cursor instead of resetting
  it to null, so a shrink cannot replay history. An intentional sheet
  replacement requires an explicit operator rewind.

### 2.2 Timestamp resolution

Resolution order:

1. Valid ISO-8601 `sampled_at` with an explicit timezone.
2. Exact validated `sample_id` format:
   `tofusense-YYYYMMDDTHHMMSSmmmZ-<uuid>`.
3. Quarantine: `TIMESTAMP_MISSING` or `TIMESTAMP_INVALID`.

`received_at` is provenance only and is never used as measurement time. A
date-only `received_at` is preserved in the receipt's raw row and is not used as
the ingestion receipt clock. An invalid `sampled_at` falls through to a valid
`sample_id` timestamp; it is not replaced by `received_at`.

Stored provenance uses `timestampSource` (`sampled`, `sample_id`, `received_at`,
`missing`) and `timestampQuality` (`OK`, `SAMPLE_ID`, `MISSING`, `INVALID`).

**Bug found and fixed during verification:** the importer resolved a
`sample_id` timestamp but did not pass it as the measurement time to
`ingestReading`, and the provenance override could mask a rejected future
timestamp. The fix passes the resolved time explicitly and only relabels
provenance when the normal resolver accepted the timestamp. Regression tests
cover both the accepted and rejected cases.

### 2.3 Battery `vbat`

Audit result:

- legacy firmware → MQTT: voltage (V);
- legacy firmware → Sheet: percent (`batteryPercent(vbatV)`);
- bench firmware: omitted;
- backend model/dashboard: percent.

`parseBattery` keeps the existing rule: `0 < n ≤ 5` is voltage, `n > 5` is
percent, `0` is 0 %, invalid/negative is null. The ≤ 5 % ambiguity is documented
and intentionally unchanged. Proposed future fields are `battery_voltage_v` and
`battery_percent`; no production semantics changed.

### 2.4 Apps Script

`docs/proposed/Code.gs` is corrected locally and **not deployed**:

- target `SHEET_NAME = 'test'`;
- 10-column schema preserved;
- `received_at` written as full ISO-8601 UTC;
- valid `sampled_at` preserved and normalised to UTC;
- exact `sample_id` fallback only when `sampled_at` is absent;
- blank `sampled_at` plus `timestamp_defect` when unusable;
- sample-id deduplication, API-key validation, and lock protection preserved.

The local source still contains a hardcoded receiver key. It was not printed or
changed. Move it to Script Properties and rotate it before deployment.

### 2.5 Target-tab policy

The target tab grew from 12 to 14 rows during the detailed audit and to 18 rows by the final read-only check. Every row has an empty
`sampled_at`, a date-only `received_at`, and an exact valid `sample_id`
timestamp. The rows are treated as pre-experiment validation data based on:

- no matching Mongo `sampleId`/`eventId` in the 12-row audit; rows appended
  later were format-checked but not rechecked against Mongo;
- no active experiment during the audit;
- production MQTT `lastSeenAt` at `10:32Z` while target sample IDs run to
  `15:16Z`, consistent with a local/test writer.

Option A (recommended): freeze the target writer, compute the current last row
index, seed the two target cursors at that index, switch, and verify zero target
receipts/readings. The rows remain in the Sheet untouched.

Option B (not approved): controlled import into a defined experiment context.
The timestamps are technically valid, but the rows predate any active experiment
and would be attached with elapsed hours clamped to zero. This requires separate
written approval.

Without an active experiment, new rows become terminal `UNASSIGNED` and are not
retried automatically. Do not switch to a live target tab while no experiment is
active unless the writer is frozen.

---

## 3. Changed files

| File | Change |
|---|---|
| `backend/src/services/sheetImportService.js` | Source-scoped cursors, legacy migration, source-scoped receipts, timestamp resolution/quarantine, measurement-time passthrough, published source identity |
| `backend/src/services/ingestService.js` | Provenance override only when the resolver accepted the timestamp |
| `backend/src/models/ImportCursor.js` | `sourceId`, `migratedFrom`, `migratedAt` |
| `backend/src/models/SensorReading.js` | `sample_id`, `SAMPLE_ID`, `missing` enum values |
| `backend/src/config/env.js` | `SHEET_LEGACY_SOURCE_ID` |
| `backend/tests/importer_hardening.test.js` | Source-scoped cursor, switching, receipt, timestamp, passthrough, and masking tests |
| `backend/tests/battery.test.js` | Percent/voltage boundaries and Sheet `vbat` assertions |
| `backend/.env.example` | New cursor identity and `SHEET_LEGACY_SOURCE_ID` documentation |
| `docs/proposed/Code.gs` | Corrected local receiver source, target `test` tab |
| `frontend/src/components/common/ProvenanceBadge.jsx` | `SAMPLE_ID` timestamp provenance title |
| `docker-compose.prod.yml` | Local frontend healthcheck prepared (not deployed) |
| `docs/data_contract.md` | Cursor, timestamp, battery, and Sheet variant contract |
| `docs/TESTING.md` | Updated test counts and Phase 11B verification section |
| `docs/SHEET_MIGRATION_PHASE11B.md` | Operator migration/rollback runbook |
| `docs/PHASE11B_REPORT.md` | This report |

---

## 4. Regression evidence

| Check | Result |
|---|---|
| Full backend suite (`npm test`) | **215/215 pass** |
| Importer hardening | **37/37 pass** |
| Battery contract | **5/5 pass** |
| Sheet + legacy + importer + battery | **59/59 pass** |
| Phase 8 E2E | pass |
| Phase 9 E2E | pass |
| Phase 10 E2E | pass |
| Phase 10.1 E2E | pass |
| Phase 10.2 E2E | pass |
| Backend syntax (`node --check` on `src/` and `scripts/`) | pass |
| Apps Script syntax (`.gs` copied to `.js`, `node --check`) | pass |
| Frontend production build (`npm run build`) | pass |
| Production Compose config (`docker compose -f docker-compose.prod.yml config --quiet`) | pass |
| Real target CSV through `rowsToReadings` | 14-row snapshot → 28 readings; 18-row final check → 36 readings, all `SAMPLE_ID` |
| Real target CSV through `processRows` (in-memory models) | 14-row snapshot: 28 imported, 0 rejected, cursors at 13 |

E2E environment: local Mongo/Mosquitto, RSL service on `127.0.0.1:8001`, backend
on `127.0.0.1:5099`, isolated `smart_tofu_chamber_e2e` database. No production
endpoint or credential was used.

Production public health was read-only checked at `2026-11-05T15:23Z` and
remained `ok` with DB/MQTT connected. No production mutation was performed.

---

## 5. Production migration status

**Prepared, not executed.** The exact runbook is
`docs/SHEET_MIGRATION_PHASE11B.md`.

Key preconditions before execution:

1. Operator approval and maintenance window.
2. Target-tab writer frozen.
3. Current target row count and last index computed immediately before the
   switch.
4. Backups of `backend/.env`, `importcursors`, `importreceipts`, and baseline
   counts.
5. Legacy scoped cursors prepared while the legacy source is still active.
6. Target cursors seeded at the cutoff (Option A).
7. Post-switch verification of cursors, receipts, counts, chamber mapping, and
   no replay.
8. Named rollback owner.

---

## 6. Risks and unresolved decisions

1. **Live target tab.** The writer must be frozen or post-cutoff rows will be
   imported. Without an active experiment they become terminal `UNASSIGNED`.
2. **Pre-experiment classification.** Recheck Mongo matches and experimental
   context at migration time.
3. **`sampled_at` empty.** Measurement time depends on the exact `sample_id`
   format; a format change will quarantine new rows.
4. **Date-only `received_at`.** Not a reliable receipt clock; raw text is kept in
   the receipt. The corrected Apps Script writes full ISO-8601.
5. **Battery ≤ 5 % ambiguity.** Existing behaviour unchanged; explicit future
   fields proposed.
6. **Published source identity.** Compute `SHEET_LEGACY_SOURCE_ID` from the
   current URL; the old `e:359910033` value is not sufficient.
7. **Hardcoded Apps Script key.** Move to Script Properties and rotate before
   deployment.
8. **Authenticated dashboard/history** remains unverified without authorized
   credentials.
9. **Frontend healthcheck** is prepared locally but not deployed.

---

## 7. Explicit non-actions

- No production `SHEET_URL` modification.
- No production cursor or receipt mutation.
- No Apps Script deployment.
- No MQTT test publication.
- No sensor-reading insertion.
- No experiment start or stop.
- No CH-009/CH-010 modification.
- No database migration on production.
- No container redeployment.
- No secret printing.
- No Phase 12 work.
