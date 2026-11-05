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

## 3. Google Sheets row (tab `testing`)

```text
received_at | sample_id | sampled_at | temp1 | humid1 | tvoc1 | temp2 | humid2 | tvoc2 | vbat
```

One row per cycle, both chambers. `received_at` is when Apps Script received the
request; `sampled_at` is when the device measured. Legacy sheets with `timestamp`
and no `sample_id` remain supported, but that `timestamp` is treated as receipt
time (the legacy Apps Script writes `new Date()`), never as acquisition time.

### Sheet variants (do not mix them)

| Tab | Schema | Used by |
|---|---|---|
| `testing` | `received_at, sample_id, sampled_at, temp1, humid1, tvoc1, temp2, humid2, tvoc2, vbat` | Phase 7 telemetry; identity + dedup |
| `Data` | `timestamp, temp1, humid1, tvoc1, temp2, humid2, tvoc2, vbat` | legacy Apps Script; no identity |
| `Sesi …` | `timestamp, tvoc1, tvoc2, grad …, catatan, Lama Pengujian` | historical experiments; not telemetry |

Historical session tabs are never imported by the telemetry importer: they lack
per-chamber temperature/humidity and the importer rejects them explicitly.
A proposed, not-yet-deployed Apps Script that writes the `testing` schema is in
`docs/proposed/Code.gs`.

## 4. Backend normalised event

`ingestService.ingestReading` produces:

| Field | Source | Rule |
|---|---|---|
| chamberId | payload / topic suffix | 1 or 2 |
| tvoc | payload | 0–99,999 ppb |
| suhu | payload | −20…80 °C |
| rh | payload | 0–100 % |
| battery | payload (optional) | volts ≤ 5 converted to %, otherwise % |
| eventId | derived | `<sample_id>-ch<n>`, or explicit `event_id` |
| sampleId | payload | optional for legacy rows |
| deviceId | payload | optional |
| sampledAt | `sampled_at` only | null when missing/invalid; legacy `timestamp` maps to `receivedAt` |
| receivedAt | backend clock / Sheet `received_at` | always present |
| timestamp | sampledAt ?? receivedAt | ordering key used by the API |
| timestampSource | derived | `sampled` or `received_at` |
| timestampQuality | derived | `OK`, `MISSING`, `INVALID` |
| source | path | `mqtt`, `sheet`, `http` |
| sources | all paths that delivered the event | `["mqtt","sheet"]` |

## 5. MongoDB `sensorreadings`

Fields as above plus `sesiId`, `createdAt`. Unique partial index:

```js
{ eventId: 1 }, { unique: true, partialFilterExpression: { eventId: { $type: 'string' } } }
```

Legacy rows (`eventId: null`) are excluded from the index and keep working.

**Duplicate behaviour:** the existing document is kept untouched; the new source
is added to `sources`; no session update, prediction, counter increment or
notification is performed.

## 6. REST output

`readingView` adds `sampleId`, `deviceId`, `sampledAt`, `receivedAt`,
`timestampSource`, `timestampQuality`, `sources`. `timestamp` is unchanged in
meaning (effective event time), so the dashboard needs no change.

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


## Mengganti tab telemetri (manual)

1. Buat/pilih tab telemetri dengan header 10 kolom Phase 7.
2. Ubah `SHEET_NAME` di Apps Script (mis. `Sesi 5 - IoT`).
3. Deploy ulang deployment yang sama (Manage deployments > Edit > New version) agar URL `/exec` tidak berubah.
4. Ambil `gid` tab dari URL Google Sheet.
5. Set `SHEET_URL` di `backend/.env` ke URL tab tersebut, sertakan `gid`.
6. Restart/reload backend agar konfigurasi dibaca ulang.

Jangan mengarahkan fallback importer ke tab sesi historis. Importer menolak tab tanpa
kolom `temp1/humid1/tvoc1` secara eksplisit.
