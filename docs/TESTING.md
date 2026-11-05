# Testing and verification

Three layers are tested without hardware: the backend pipeline, the frontend
RSL experience, and the firmware contract/compile. Physical sensor behaviour is
checked separately with the checklist at the end.

## Backend

```bash
cd backend
npm ci
npm test
```

What the suite covers (223 tests at the time of writing):

| Area | Tests |
|---|---|
| Identity and timestamps | `tests/identity.test.js` — deterministic event ids, sampled vs received time, invalid/future timestamps |
| Ingestion idempotency | `tests/ingest_idempotency.test.js` — MQTT twice, MQTT→Sheet, Sheet→MQTT, two chambers, restart, duplicates with no side effects, late events |
| Experiment lifecycle | `tests/experiment_lifecycle.test.js` — start/stop, shared startpoint, legacy-session 409, no-active-experiment rejection, missing session, delayed events, duplicates, Sheet source, idempotent stop, concurrent/partial failure |
| Importer hardening | `tests/importer_hardening.test.js` — source-scoped cursors, explicit legacy migration, source switching, receipt scoping, timestamp resolution/quarantine, cursor outcomes, sentinel, retry bounds, restart, legacy idempotency |
| Sheets contract | `tests/sheet_contract.test.js` — live `testing` header, legacy header, row-index cursor |
| Battery contract | `tests/battery.test.js` — percent/voltage disambiguation, 5 V boundary, Sheet `vbat` for both chambers |
| Sheet legacy contract | `tests/sheet_legacy_contract.test.js` — legacy `Data` header, receipt-vs-acquisition time, missing columns, incomplete rows, historical-tab rejection, Sheet/MQTT dedup |
| Firmware contract | `tests/firmware_contract.test.js` — topic, payload fields, two messages per cycle, no fabricated vbat, MQTT/Sheets independence |
| MQTT protocol | `tests/mqtt_integration.test.js` — real Aedes broker + real `mqtt` client: connect, subscribe, two chambers, redelivery, concurrent duplicates, malformed payload, delayed event |
| RSL adapter | `tests/rsl_service.test.js` — unknown/spoiled status, storage, canonical M1/M2/M3 mapping, precision, timeout, refusal, malformed response, negative elapsed, closed experiment, no sensor predictors |
| RSL snapshots | `tests/rsl_snapshot.test.js` — shared stop timestamp, full precision, idempotent stop, unavailable outcomes, persistence failure safety, old experiments |
| RSL snapshot history | `tests/rsl_snapshots_list.test.js` — chamber-scoped immutable snapshot listing, newest-first ordering, limit, presenter provenance |
| RSL notifications | `tests/rsl_notifications.test.js` — M1 lower-bound thresholds, dedup, restart, two chambers, closed/unknown/spoiled/water/outside/timeout suppression, send failure |
| RSL snapshot recovery | `tests/rsl_recovery.test.js` — missing chamber recovery, partial writes, completion-state failure, backoff, batch limit, concurrent workers, legacy safety |
| Session finalization | `tests/rsl_snapshot.test.js` + `tests/rsl_recovery.test.js` — orphan session closure, earlier timestamps, finalization state, late MQTT/status protection |
| Existing behaviour | auth, battery, status zones, ml client, analysis, sheet parsing |

Tests use an in-memory model fake (`tests/helpers/memoryStore.js`) that mirrors the
three database constraints that matter: unique `eventId`, one active session per
chamber, and one active experiment. No MongoDB server is required for `npm test`. The MQTT test starts a real
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

## Isolated local E2E (Phase 8C.8)

Uses only the local Mongo/Mosquitto containers and a dedicated database. Never
point `MONGODB_URI` or `MQTT_URL` at production.

```bash
docker compose up -d mongo mosquitto
docker exec stc-mongo mongosh smart_tofu_chamber_e2e --quiet --eval 'db.dropDatabase()'

cd backend
export PORT=5098
export MONGODB_URI=mongodb://127.0.0.1:27017/smart_tofu_chamber_e2e
export MQTT_URL=mqtt://127.0.0.1:1883
export SHEET_URL=
export ML_MODE=mock
export JWT_SECRET=local-e2e-secret-0123456789abcdef
export DEVICE_API_KEY=e2e-device-key
npm start

# terminal 2, same env
node scripts/e2e-phase8c8.js
```

The script starts an experiment via HTTP, publishes both chambers through local
MQTT, verifies persistence/session mapping/dashboard, exercises both dedup orders
with local Sheet fixtures, checks sentinel quarantine, stops the experiment, and
verifies closed-experiment rejection. It does not contact Google Sheets.

## Phase 11B local verification (2026-11-05)

Run against local Mongo/Mosquitto, the Python RSL service on `127.0.0.1:8001`,
and the backend on the isolated `smart_tofu_chamber_e2e` database. No production
configuration, cursor, receipt, Sheet row, MQTT topic, or container was touched.

```bash
cd backend
npm test
node --test tests/importer_hardening.test.js
node --test tests/battery.test.js
node --test tests/sheet_contract.test.js tests/sheet_legacy_contract.test.js \
  tests/importer_hardening.test.js tests/battery.test.js
```

| Check | Result |
|---|---|
| Full backend suite | 215/215 pass |
| Importer hardening | 37/37 pass |
| Battery contract | 5/5 pass |
| Sheet + legacy + importer + battery | 59/59 pass |
| Backend syntax (`node --check` on `src/` and `scripts/`) | pass |
| Apps Script syntax (`.gs` copied to `.js`, `node --check`) | pass |
| Frontend production build (`npm run build`) | pass |
| Production Compose config (`docker compose -f docker-compose.prod.yml config --quiet`) | pass (with a temporary local `backend/.env` copied from `.env.example`, removed afterwards) |

Phase 8–10.2 E2E commands used `API_URL=http://127.0.0.1:5099` and the same
`MONGODB_URI`/`RSL_SERVICE_URL`:

```bash
MONGODB_URI=mongodb://127.0.0.1:27017/smart_tofu_chamber_e2e \
API_URL=http://127.0.0.1:5099 \
RSL_SERVICE_URL=http://127.0.0.1:8001 \
node scripts/e2e-phase8c8.js
# then e2e-phase9.js, e2e-phase10.js, e2e-phase10_1.js, e2e-phase10_2.js
```

All five suites passed. The real target tab was also parsed read-only through
`rowsToReadings`: a 14-row snapshot produced 28 chamber readings, and an 18-row
final check produced 36; every timestamp resolved with
`timestampQuality=SAMPLE_ID` and `timestampSource=sample_id`;
`sampled_at` was empty and date-only `received_at` was not used as measurement
time. See `docs/SHEET_MIGRATION_PHASE11B.md` for the migration policy and
operator runbook.

## Frontend

```bash
cd frontend
npm ci
npm test
npm run build
```

Vitest + Testing Library cover the RSL comparison, reference metadata, data
provenance, snapshot timeline, loading/empty/error states, and chamber-switch
isolation. `npm test` is a dev-only test runner; production dependencies are
unchanged.

## Phase 11C local verification (2026-11-06)

Run against local Mongo/Mosquitto, the Python RSL service on `127.0.0.1:8001`,
an isolated Phase 11C database for visual fixtures, and the E2E database for
lifecycle suites. No production configuration or data was touched.

| Check | Result |
|---|---|
| Backend suite | 223/223 pass |
| Frontend suite | 17/17 pass |
| RSL engine | 77/77 pass |
| RSL service | 11/11 pass |
| Phase 8 E2E | pass |
| Phase 9 E2E | pass |
| Phase 10 E2E | pass |
| Phase 10.1 E2E | pass |
| Phase 10.2 E2E | pass |
| Frontend production build | pass |
| Axe-core WCAG 2.2 A/AA (dashboard, RSL, chamber, history) | 0 violations; 1 incomplete color-contrast check caused by the page background gradient |
| Responsive widths | 390×844, 768×1024, 1440×900; no page-level horizontal overflow |

## RSL engine and service

```bash
# engine: 77 tests, including 14-point v2.3 parity
PYTHONPATH=rsl_engine/src python3 -m pytest rsl_engine/tests -q

# internal HTTP service: 11 tests + 2 frozen-baseline tests
PYTHONPATH=rsl_engine/src python3 -m pytest rsl_service/tests -q
```

Portable install check (no developer path):

```bash
python3 -m pip install --no-deps --target /tmp/rsl_install ./rsl_engine
PYTHONPATH=/tmp/rsl_install python3 -c "from tofusense_rsl import estimate_rsl; print(estimate_rsl(20)['status'])"
```

## Phase 9 local E2E (RSL)

Requires local Mongo, Mosquitto, the Python RSL service, and the backend on the
dedicated E2E database. Never point these at production.

```bash
# terminal 1
PYTHONPATH=rsl_engine/src RSL_PORT=8001 python3 -m rsl_service.server

# terminal 2
cd backend
export PORT=5099
export MONGODB_URI=mongodb://127.0.0.1:27017/smart_tofu_chamber_e2e
export MQTT_URL=mqtt://127.0.0.1:1883
export SHEET_URL=
export ML_MODE=mock
export RSL_ENABLED=true
export RSL_SERVICE_URL=http://127.0.0.1:8001
export JWT_SECRET=local-e2e-secret-0123456789abcdef
export DEVICE_API_KEY=e2e-device-key
npm start

# terminal 3
MONGODB_URI=mongodb://127.0.0.1:27017/smart_tofu_chamber_e2e \
API_URL=http://127.0.0.1:5099 \
RSL_SERVICE_URL=http://127.0.0.1:8001 \
node scripts/e2e-phase9.js
```

The script exercises: start experiment, UNKNOWN status rejection, independent
chamber statuses, Phase 7 MQTT payloads, Mongo persistence, API↔canonical parity,
dynamic elapsed without new readings, WATER/UNKNOWN/negative/outside-support
negatives, duplicate MQTT, future/missing timestamp flags, and shared stop.

## Phase 10.2 local E2E (session closure reliability)

```bash
MONGODB_URI=mongodb://127.0.0.1:27017/smart_tofu_chamber_e2e \
API_URL=http://127.0.0.1:5099 \
RSL_SERVICE_URL=http://127.0.0.1:8001 \
node scripts/e2e-phase10_2.js
```

The script verifies a normal fully finalized stop, a partial Chamber 2 closure
failure with snapshots complete, late MQTT rejection while an orphan session is
active, parent-closed sample-status rejection, worker recovery of the orphan
using the original `endedAt`, snapshot preservation, and a subsequent healthy
experiment.

## Phase 10.1 local E2E (snapshot reliability)

```bash
MONGODB_URI=mongodb://127.0.0.1:27017/smart_tofu_chamber_e2e \
API_URL=http://127.0.0.1:5099 \
RSL_SERVICE_URL=http://127.0.0.1:8001 \
node scripts/e2e-phase10_1.js
```

The script verifies normal COMPLETE stops, simulated crash-after-closure recovery,
partial one-chamber recovery without overwriting the existing snapshot,
completion-state-only recovery, original `endedAt` preservation, closed-session
status protection, and late MQTT rejection.

## Phase 10 local E2E (snapshots + notifications)

Requires local Mongo, Mosquitto, the Python RSL service, and the backend on the
dedicated E2E database.

```bash
MONGODB_URI=mongodb://127.0.0.1:27017/smart_tofu_chamber_e2e \
API_URL=http://127.0.0.1:5099 \
RSL_SERVICE_URL=http://127.0.0.1:8001 \
node scripts/e2e-phase10.js
```

The script verifies M1 notification creation/dedup/API, stop-time snapshots for
two chambers, shared `snapshotAt`/`endedAt`, full precision, historical
experiment/session retrieval, repeated-stop idempotency, closed-experiment
suppression, and UNKNOWN/SPOILED unavailable snapshots.

## Local end-to-end (requires MongoDB + Mosquitto)

`npm run seed` creates demo active sessions without an `experimentId`. The new
lifecycle requires those legacy sessions to be closed before starting an
experiment (this is intentional; it prevents reusing stale sessions).

```bash
docker compose up -d mongo mosquitto
cd backend && npm run seed && npm run dev
# terminal 2: login, close demo sessions, start one experiment
TOKEN=$(curl -s -X POST http://localhost:5000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@tofu.local","password":"admin123"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["token"])')
curl -X POST http://localhost:5000/api/chambers/1/selesai -H "Authorization: Bearer $TOKEN"
curl -X POST http://localhost:5000/api/chambers/2/selesai -H "Authorization: Bearer $TOKEN"
curl -X POST http://localhost:5000/api/experiments \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"label":"Local test"}'
# terminal 2
npm run simulate -- --chamber 1
npm run simulate -- --chamber 1 --mqtt
```

Expected: one reading per simulated payload, attached to the experiment session;
sending the same `sample_id` twice (on either path) keeps one document. Check with:

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
