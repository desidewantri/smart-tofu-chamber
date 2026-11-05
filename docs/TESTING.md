# Testing and verification

Two layers are tested without hardware: the backend pipeline and the firmware
contract/compile. Physical sensor behaviour is checked separately with the
checklist at the end.

## Backend

```bash
cd backend
npm ci
npm test
```

What the suite covers (98 tests at the time of writing):

| Area | Tests |
|---|---|
| Identity and timestamps | `tests/identity.test.js` — deterministic event ids, sampled vs received time, invalid/future timestamps |
| Ingestion idempotency | `tests/ingest_idempotency.test.js` — MQTT twice, MQTT→Sheet, Sheet→MQTT, two chambers, restart, duplicates with no side effects, late events |
| Sheets contract | `tests/sheet_contract.test.js` — live `testing` header, legacy header, row-index cursor |
| Sheet legacy contract | `tests/sheet_legacy_contract.test.js` — legacy `Data` header, receipt-vs-acquisition time, missing columns, incomplete rows, historical-tab rejection, Sheet/MQTT dedup |
| Firmware contract | `tests/firmware_contract.test.js` — topic, payload fields, two messages per cycle, no fabricated vbat, MQTT/Sheets independence |
| MQTT protocol | `tests/mqtt_integration.test.js` — real Aedes broker + real `mqtt` client: connect, subscribe, two chambers, redelivery, concurrent duplicates, malformed payload, delayed event |
| Existing behaviour | auth, battery, status zones, ml client, analysis, sheet parsing |

Tests use an in-memory model fake (`tests/helpers/memoryStore.js`) that mirrors the
two database constraints that matter: unique `eventId` and one active session per
chamber. No MongoDB server is required for `npm test`. The MQTT test starts a real
broker (Aedes) on an ephemeral port, so the MQTT protocol path is exercised without
touching the production broker.

## Firmware

```bash
python3 -m pip install --user platformio
python3 -m platformio run -d firmware/toscha_esp32_bench
```

The sketch compiles with placeholder credentials. To build a flashable binary,
copy `config_secrets.example.h` to `config_secrets.h` in the same folder and fill
in Wi-Fi, Apps Script and MQTT values. `config_secrets.h` is gitignored.

## Broker check

```bash
cd backend
npm run mqtt:check
```

Connects with `backend/.env`, subscribes to `MQTT_TOPIC`, prints connect/subscribe
status and redacts credentials. Exit 0 = broker reachable and subscription accepted.

## Verified local run (2026-11-05)

Executed against the real dev stack (`stc-mosquitto` + `stc-mongo`), with the
backend started from this tree and an isolated database
`smart_tofu_chamber_phase8a`:

- `npm run mqtt:check` → CONNECT ok, SUBSCRIBE ok on `smartchamber/sensor/+`
- `/api/health` → `db: connected`, `mqtt.connected: true`
- two chamber messages published twice → `readings=2`, `predictions=2`,
  `sessions=2`, zero duplicate `eventId` groups
- the isolated test database was dropped afterwards; existing dev data untouched

Not covered by this run: production broker (no credentials/SSH access), live
Google Sheet import (no `SHEET_URL` in the local env), physical ESP32.

## Local end-to-end (requires MongoDB + Mosquitto)

```bash
docker compose up -d mongo mosquitto
cd backend && npm run seed && npm run dev
# terminal 2
npm run simulate -- --chamber 1
npm run simulate -- --chamber 1 --mqtt
```

Expected: one reading per simulated payload; sending the same `sample_id` twice
(on either path) keeps one document. Check with:

```bash
docker exec stc-mongo mongosh smart_tofu_chamber --quiet \
  --eval 'db.sensorreadings.aggregate([{$group:{_id:"$eventId",n:{$sum:1}}},{$match:{n:{$gt:1}}}])'
```

An empty result means no duplicate event ids.

## Manual hardware checklist (when the ESP32 is reconnected)

1. **I2C scan.** Serial monitor must show `0x44`, `0x45`, `0x1A` on Bus A and
   `0x1A` on Bus B.
2. **Chamber mapping.** This is the one thing software cannot prove.
   - Disconnect SHT31 #2 (0x45) and confirm Chamber 2 temperature disappears while
     Chamber 1 stays.
   - Cover AGS10 #2 (Wire1) and confirm only Chamber 2 TVOC changes.
   - Label each chamber physically with the result. If the labels are swapped,
     swap the chamber argument in `publishChamberMqtt`/Sheet payload — not the I2C
     pins.
3. **MQTT.** Backend log shows `[mqtt] terhubung` and
   `[mqtt] smartchamber/sensor/1 -> CH-...`. Broker credentials must match
   `deploy/mosquitto-passwd`.
4. **Sheets.** Serial shows `Redirect GET status: 200` and
   `"ok":true,"duplicate":false`. A repeat within the same cycle should return
   `"duplicate":true`.
5. **Dual send independence.** Stop the broker, run one cycle: Sheet must still
   receive the row and serial shows `mqtt ... FAIL` / `sheet OK`. Restart the
   broker, run another cycle: MQTT recovers.
6. **Timestamp.** `sampled_at` in MQTT and the Sheet must match the NTP clock.
   If NTP fails, serial prints `sampled_at: UNAVAILABLE` and the backend records
   `timestampQuality = MISSING`.
7. **Deduplication.** With both paths up, confirm one MongoDB document per
   `eventId` and `sources: ["mqtt","sheet"]`.
8. **Battery.** Out of scope for this phase; `vbat` is deliberately omitted.

Record the serial log and the Mongo document for the run.
