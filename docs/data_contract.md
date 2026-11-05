# Data contract — TofuSense dual-send pipeline

**Rule: dual send, single ingest, idempotent storage.**

One sampling cycle produces one `sample_id`. Each chamber reading of that cycle
is a separate logical event with a deterministic id:

```text
sample_id            = <device_id>-<epoch>-<sequence>
event_id (chamber n) = <sample_id>-ch<n>
```

The same ids are produced by the MQTT path and derived from the Google Sheets
row, so both paths address the same MongoDB document.

## 1. ESP32 sampling cycle (every 5 minutes)

| Field | Example | Notes |
|---|---|---|
| device_id | `tofusense-FCF5C46F0E2C` | Wi-Fi MAC, no separators |
| sample_id | `tofusense-FCF5C46F0E2C-1793817129-1` | shared by both chambers |
| sampled_at | `2026-11-04T18:15:29Z` | UTC from NTP; empty if NTP failed |

Read once per cycle: SHT31 #1 (0x44, Wire), SHT31 #2 (0x45, Wire), AGS10 #1
(Wire), AGS10 #2 (Wire1).

## 2. MQTT chamber message

Topic: `smartchamber/sensor/1`, `smartchamber/sensor/2`.
QoS 0 (PubSubClient limitation), retain false.

```json
{
  "event_id": "tofusense-FCF5C46F0E2C-1793817129-1-ch1",
  "sample_id": "tofusense-FCF5C46F0E2C-1793817129-1",
  "device_id": "tofusense-FCF5C46F0E2C",
  "chamber_id": 1,
  "tvoc": 88,
  "suhu": 27.54,
  "rh": 78.92,
  "sampled_at": "2026-11-04T18:15:29Z",
  "timestamp": "2026-11-04T18:15:29Z"
}
```

`timestamp` is kept for backward compatibility; `sampled_at` is canonical.
`vbat` is omitted in the bench phase (battery topology unverified). It is
accepted when present as volts (≤ 5) or percent.

## 3. Google Sheets row (telemetry tabs)

```text
received_at | sample_id | sampled_at | temp1 | humid1 | tvoc1 | temp2 | humid2 | tvoc2 | vbat
```

One row per cycle, both chambers. `received_at` is when Apps Script received the
request; `sampled_at` is when the device measured. Legacy sheets with `timestamp`
and no `sample_id` remain supported, but that `timestamp` is treated as receipt
time (the legacy Apps Script writes `new Date()`), never as acquisition time.

### Timestamp resolution (importer)

The importer resolves measurement time in this exact order:

1. A valid ISO-8601 `sampled_at` with an explicit timezone (`Z` or `±HH:MM`).
   Offsets are honoured; the value is normalised to UTC.
2. A timestamp extracted from `sample_id` only when it matches the exact,
   validated target format:

   ```text
   tofusense-YYYYMMDDTHHMMSSmmmZ-<uuid>
   ```

   The embedded timestamp is UTC. This format was validated against every row
   present in the target `test` tab during Phase 11B. Older sample ids such as
   `tofusense-FCF5C46F0E2C-1793816129-1` are **not** accepted as a timestamp
   source because that format was not validated for this purpose.
3. Otherwise the record is quarantined with `TIMESTAMP_MISSING` (empty) or
   `TIMESTAMP_INVALID` (present but not parseable).

`received_at` is provenance only. A date-only `received_at` is retained as raw
text in the import receipt (`rawRow`) and may still be parsed as a received
timestamp, but it is **never** substituted for measurement time. A present but
invalid `sampled_at` falls through to the validated `sample_id` timestamp; it is
not silently replaced by `received_at`.

Derived fields on a reading:

| Field | Values |
|---|---|
| `sampledAt` | resolved measurement time, or null |
| `timestampSource` | `sampled`, `sample_id`, `received_at` (legacy tab only), `missing` |
| `timestampQuality` | `OK`, `SAMPLE_ID`, `MISSING`, `INVALID` |

**Sentinel policy (interim):** a Sheet TVOC value of `99999` is treated as an
invalid sentinel (`INVALID_TVOC_SENTINEL`), quarantined in `importreceipts`, and
not ingested as a valid reading. MQTT validation is unchanged. The raw row is
retained; the value is never converted to zero. `SHEET_MODE` defaults to
`fallback`; production should set it explicitly.

### Source-scoped cursors and receipts

Each spreadsheet/tab has an independent cursor identity:

```text
sheet:<sourceId>:<chamberId>
```

`sourceId` is derived from the Sheet URL by `sourceIdFromUrl`:

| URL form | sourceId |
|---|---|
| published `/spreadsheets/d/e/<publishedId>/pub?gid=359910033` | `e:<publishedId>:359910033` |
| direct `/spreadsheets/d/<id>/export?format=csv&gid=572072723` | `<id>:572072723` |
| URL without `gid` | `<id>:0` |

The published token is included deliberately: tab GIDs are only unique within a
spreadsheet, so `e:<gid>` alone would collide across two published spreadsheets.

Existing production cursors `sheet:1` and `sheet:2` are legacy documents. They
are copied to a scoped key only when `SHEET_LEGACY_SOURCE_ID` explicitly matches
the active source. The copy records `migratedFrom` and `migratedAt`; the legacy
document is never modified or deleted. If a legacy cursor exists and no explicit
mapping is configured, the importer refuses the chamber with
`LEGACY_CURSOR_UNMAPPED` instead of guessing. Import receipts are scoped by
`sourceId`, so the same `sample_id` arriving from two different sources keeps
separate receipt identities while the `SensorReading.eventId` unique index still
deduplicates the logical event.

### Sheet variants (do not mix them)

| Tab | Schema | Used by |
|---|---|---|
| `testing` | `received_at, sample_id, sampled_at, temp1, humid1, tvoc1, temp2, humid2, tvoc2, vbat` | Phase 7 telemetry; identity + dedup |
| `test` (GID `572072723`) | same 10-column schema | operator-selected target tab; see migration policy |
| `Data` | `timestamp, temp1, humid1, tvoc1, temp2, humid2, tvoc2, vbat` | legacy Apps Script; no identity |
| `Sesi …` | `timestamp, tvoc1, tvoc2, grad …, catatan, Lama Pengujian` | historical experiments; not telemetry |

Historical session tabs are never imported by the telemetry importer: they lack
per-chamber temperature/humidity and the importer rejects them explicitly.
A corrected, not-yet-deployed Apps Script that writes the 10-column schema to the
`test` tab is in `docs/proposed/Code.gs`. It writes `received_at` as full
ISO-8601 UTC, preserves a valid `sampled_at`, derives `sampled_at` from the exact
sample-id format only when `sampled_at` is absent, and otherwise leaves it blank
while reporting `timestamp_defect`.

## 4. Backend normalised event

`ingestService.ingestReading` produces:

| Field | Source | Rule |
|---|---|---|
| chamberId | payload / topic suffix | 1 or 2 |
| tvoc | payload | 0–99,999 ppb |
| suhu | payload | −20…80 °C |
| rh | payload | 0–100 % |
| battery | payload (optional) | percent 0–100; `vbat` ≤ 5 is treated as volts and converted, see battery contract |
| eventId | derived | `<sample_id>-ch<n>`, or explicit `event_id` |
| sampleId | payload | optional for legacy rows |
| deviceId | payload | optional |
| sampledAt | resolved measurement time | null when missing/invalid; legacy `timestamp` maps to `receivedAt` |
| receivedAt | backend clock / Sheet `received_at` | always present; provenance only |
| timestamp | sampledAt ?? receivedAt | ordering key used by the API |
| timestampSource | derived | `sampled`, `sample_id`, `received_at` (legacy tab), `missing` |
| timestampQuality | derived | `OK`, `SAMPLE_ID`, `MISSING`, `INVALID` |
| source | path | `mqtt`, `sheet`, `http` |
| sources | all paths that delivered the event | `["mqtt","sheet"]` |

### Battery field contract (`vbat`)

The field name `vbat` is overloaded by transport and must not be interpreted
without its source:

| Path | Actual value | Evidence |
|---|---|---|
| Legacy firmware → MQTT | battery **voltage** (V) | `publishChamber(..., vbatV)` sends `vbatV` |
| Legacy firmware → Sheet | battery **percent** | `uploadSheet` sends `batteryPercent(vbatV)` |
| Bench firmware | omitted | `vbat intentionally omitted` |
| Backend model/dashboard | percent | `SensorReading.battery` and `Chamber.battery` are percent |

Backend `parseBattery` keeps the historical disambiguation:

- `0 < n ≤ 5` → volts, converted with the Li-ion curve (3.27 V = 0 %, 4.20 V = 100 %)
- `n > 5` → percent, rounded and clamped to 0–100
- `0` → 0 %
- empty/invalid/negative → null

**Known ambiguity:** a genuine battery percentage at or below 5 % is
indistinguishable from a voltage and is converted as volts (usually to 0 %).
This is existing production behaviour and is intentionally unchanged in Phase
11B. A future schema should carry explicit fields:

```text
battery_voltage_v | battery_percent
```

When both are present, the backend should prefer `battery_percent`; when only
`battery_voltage_v` is present, it should convert with the same curve. This is a
proposal only; no production field or parser behaviour changed in Phase 11B.

## 5. MongoDB `sensorreadings`

Fields as above plus `sesiId`, `createdAt`. Unique partial index:

```js
{ eventId: 1 }, { unique: true, partialFilterExpression: { eventId: { $type: 'string' } } }
```

Legacy rows (`eventId: null`) are excluded from the index and keep working.

**Duplicate behaviour:** the existing document is kept untouched; the new source
is added to `sources`; no session update, prediction, counter increment or
notification is performed.

**Import audit:** `importreceipts` records one durable outcome per source row and
chamber. Its key is `sheet:<sourceId>:<rowIndex>:ch<n>`; the row fingerprint is
looked up together with `sourceId` and `chamberId`. Terminal statuses are
`IMPORTED`, `DUPLICATE`, `QUARANTINED_INVALID`, `UNASSIGNED`,
`QUARANTINED_INTEGRITY`, and `QUARANTINED_RETRY_EXHAUSTED`; `RETRYABLE_ERROR`
stays retryable up to five attempts. The raw CSV row is retained for forensic
inspection, including original timestamp text.

## 6. REST output

`readingView` adds `sesiId`, `sampleId`, `deviceId`, `sampledAt`, `receivedAt`,
`timestampSource`, `timestampQuality`, `sources`. `sessionView` adds
`experimentId`, `experimentStartedAt`, and `elapsedHours` (null for historical
sessions). `timestamp` is unchanged in meaning (effective event time), so the
dashboard needs no change.

Sensor messages are only ingested under an active experiment. Without one, the
backend returns `409 NO_ACTIVE_EXPERIMENT` and creates no session/reading.
Historical sessions keep `experimentId: null` and their existing `masuk`.

## 7. Dashboard consumption

The dashboard keeps polling `/api/dashboard` every 10 s. It sorts by `timestamp`
(sample time), so a delayed historical event is inserted chronologically and does
not become the "latest reading". `chamber.lastSeenAt` tracks when the backend
last heard from the device and is only updated for fresh events.

## Source precedence

1. MQTT is the primary real-time path.
2. Sheets is the archive and fallback.
3. Whichever arrives first creates the document; the second is recognised as a
   duplicate. A delayed MQTT message after a Sheets import, and a delayed Sheets
   row after MQTT, both resolve to one document.

## 8. RSL API contract (Phase 11C)

The browser never calls the internal Python RSL service. It reads authenticated
backend endpoints only. The backend adapter normalizes the engine response; the
frontend must not calculate M1/M2/M3 or fill missing values.

### Live estimate

`GET /api/experiments/:id/rsl/:chamberId` returns:

| Field | Nullability | Meaning |
|---|---|---|
| `status` | never null | `AVAILABLE` or `UNAVAILABLE` |
| `reason` | null when available | explicit unavailability code |
| `message` | null when available | human-readable reason |
| `sampleStatus` | never null | operator state: `UNKNOWN`, `NOT_SPOILED`, `SPOILED` |
| `storageCondition` | never null | `DRY`, `WATER`, `UNKNOWN`; only `DRY` is supported by the frozen reference |
| `elapsedHours` | nullable | `(now - Experiment.startedAt) / 3600000` |
| `generatedAt` | never null | time the adapter resolved the live request |
| `primary` | null when unavailable | M1 only |
| `primary.lowerHours`, `primary.upperHours` | numeric when available | canonical full-precision M1 bounds |
| `primary.display.lowerHours/upperHours` | numeric when available | presentation-rounded bounds; never a new estimate |
| `supporting.M2` | nullable | Turnbull NPMLE support, status, advisory, components |
| `supporting.M2.components[]` | array | `{ lowerHours, upperHours, mass }`; support is not a confidence interval |
| `supporting.M3` | nullable | Weibull A0 comparator: `available`, `shape`, `scale`, `r10Hours`, `r90Hours`, `supportWarning`, `suppressFromDashboard` |
| `metadata` | object | engine/reference provenance |

M1 is an **empirical interval envelope**. M2 is conditional support. M3 is a
parametric comparator. They are not the same quantity and must not be averaged,
copied into one another, or presented as a single confidence interval.

### Historical snapshot

`GET /api/rsl/snapshots?chamberId=<1|2>&limit=<1..100>` returns immutable
`rslsnapshots` documents in newest-first order. It is additive and does not
change existing RSL endpoints.

| Field | Meaning |
|---|---|
| `isSnapshot` | always `true`; marks persisted history |
| `snapshotAt`, `endedAt` | original experiment stop boundary, never request time |
| `experimentId`, `sessionId`, `chamberId`, `experimentLabel`, `sesiCode` | association and display context |
| `status`, `reason`, `message` | persisted outcome; unavailable snapshots remain visible |
| `primary`, `supporting`, `metadata` | frozen result and reference provenance |
| `timestampQuality`, `lastReadingAt`, `readingCount` | measurement provenance at capture time |

Snapshots are never recalculated. The frontend must not substitute a live
estimate for a missing or unavailable snapshot.

### Frontend mapping

| UI field | Backend source |
|---|---|
| M1 primary interval | `primary.display` for headline, `primary.lowerHours/upperHours` for full bounds |
| M2 comparison | `supporting.M2.components` and `status` |
| M3 comparison | `supporting.M3.r10Hours/r90Hours`, `shape`, `scale`, `available` |
| Reference metadata | `metadata.referenceVersion`, `referencePopulation`, `referenceStorageCondition`, `engineVersion`, `elapsedOrigin`, `tvocContribution`, `caveats` |
| Live calculation time | `generatedAt` |
| Snapshot time | `snapshotAt` |
| Measurement time | `latestReading.sampledAt` |
| Server receipt time | `latestReading.receivedAt` |
| Timestamp quality/source | `latestReading.timestampQuality` / `timestampSource` |
| Chamber identity | `chamber.chamberId` on the selected response; the RSL tab guards against stale chamber data during switches |
