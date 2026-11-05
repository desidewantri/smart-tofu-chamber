# MQTT broker — discovery and configuration

**Result: the broker already exists in this repository. Do not create a new one.**

## 1. What was found

| Evidence | Path | Meaning |
|---|---|---|
| Broker service (local) | `docker-compose.yml` → `mosquitto:` | Eclipse Mosquitto 2, port 1883 |
| Broker service (server) | `docker-compose.prod.yml` → `mosquitto:` | Same image, password-protected, port 1883 exposed to devices |
| Dev config | `infra/mosquitto/mosquitto.conf` | `allow_anonymous true`, persistence on |
| Prod config | `infra/mosquitto/mosquitto.prod.conf` | `allow_anonymous false`, `password_file`, persistence, `queue_qos0_messages true` |
| Credential provisioning | `deploy/setup-mqtt.sh` | Creates users `esp32` and `backend` with random passwords, writes `backend/.env`, opens 1883 |
| Backend subscriber | `backend/src/services/mqttService.js` | Connects, subscribes `smartchamber/sensor/+` |
| Backend settings | `backend/src/config/env.js` (`mqtt`) | `MQTT_URL`, `MQTT_USERNAME`, `MQTT_PASSWORD`, `MQTT_TOPIC`, `MQTT_CLIENT_ID` |
| Backend env template | `backend/.env.example` | Placeholders only; no real secrets |
| Firmware | `firmware/toscha_esp32_bench/config_secrets.example.h` | `MQTT_HOST`, `MQTT_PORT`, `MQTT_USER`, `MQTT_PASS`, `MQTT_USE_TLS` |
| Historical firmware | `firmware/toscha_esp32/toscha_esp32.ino` | Contains a hardcoded VPS host (redacted here) proving remote use |

No EMQX, HiveMQ, RabbitMQ or hosted MQTT SaaS exists anywhere in the repo.

**Broker type: B + C** — a Dockerized Mosquitto defined in the repository, deployed
on the same VPS as the web stack. It is not an external hosted broker; it is not
"configuration only" either, because `docker-compose.prod.yml` starts it and the
backend connects to it over the Compose network.

## 2. Topology

```text
Development (laptop)                      Production (VPS)
─────────────────────                     ─────────────────
ESP32 ── 1883 ──► localhost Mosquitto     ESP32 ── 1883 ──► Mosquitto (container)
                     ▲                                       ▲
backend ─────────────┘                     backend ── mqtt://mosquitto:1883
(MQTT_URL=mqtt://127.0.0.1:1883)           (internal Docker DNS, not the public IP)
```

The backend never uses the public hostname in production; Compose injects
`MQTT_URL: mqtt://mosquitto:1883`. Only devices connect from outside.

## 3. Topic convention

```text
smartchamber/sensor/1     chamber 1
smartchamber/sensor/2     chamber 2
backend subscribes:       smartchamber/sensor/+
```

QoS: publisher 0 (PubSubClient), subscriber 1 → effective 0. Retain false.
No LWT; offline status derives from `chamber.lastSeenAt` (3× interval).

## 4. Configuration variables

### Backend (`backend/.env`)

| Variable | Dev | Production | Notes |
|---|---|---|---|
| `MQTT_ENABLED` | `true` | `true` | `false` disables the subscriber |
| `MQTT_URL` | `mqtt://127.0.0.1:1883` | injected by Compose (`mqtt://mosquitto:1883`) | Do not hardcode public host in the repo |
| `MQTT_USERNAME` | empty | `backend` | Created by `deploy/setup-mqtt.sh` |
| `MQTT_PASSWORD` | empty | **set by the script** | Never commit |
| `MQTT_TOPIC` | `smartchamber/sensor/+` | same | |
| `MQTT_CLIENT_ID` | `toscha-backend` | same | Fixed + `clean:false` for a persistent session |

### ESP32 (`firmware/toscha_esp32_bench/config_secrets.h`)

| Define | Value |
|---|---|
| `MQTT_HOST` | the VPS hostname/IP that runs `docker-compose.prod.yml` (not `localhost`) |
| `MQTT_PORT` | `1883` (or `8883` if TLS is enabled) |
| `MQTT_USER` | `esp32` |
| `MQTT_PASS` | password printed by `deploy/setup-mqtt.sh` |
| `MQTT_USE_TLS` | `0` (current) / `1` after the broker has a TLS listener |

If `MQTT_HOST` still starts with `ISI_`, the firmware compiles but disables MQTT
cleanly and keeps sending to Sheets.

## 5. Verify the broker without deploying

```bash
cd backend
npm run mqtt:check
```

Expected output (no credentials printed):

```text
[check] broker   : mqtt://<host>:1883
[check] topic    : smartchamber/sensor/+
[check] username : set
[check] password : set
[check] CONNECT ok
[check] SUBSCRIBE ok: smartchamber/sensor/+
```

From the server, a raw check:

```bash
docker compose -f docker-compose.prod.yml ps mosquitto
docker compose -f docker-compose.prod.yml logs --tail=50 mosquitto
```

## 6. Security status (important)

- Prod broker uses `allow_anonymous false` + `password_file` — good.
- **There is no TLS listener.** MQTT credentials and sensor data cross the public
  internet in plaintext on 1883. Do not describe this as production-safe.
- `mosquitto.prod.conf` contains a commented TLS 8883 block. Enabling it requires
  certificates, a firewall change, and `MQTT_USE_TLS 1` + `MQTT_CA_CERT` in the
  firmware.
- The backend's `/api/health` redacts credentials from the reported URL
  (`mqttService.redactUrl`).

## 7. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `connack timeout` / `Not authorized` | user/password mismatch | re-run `deploy/setup-mqtt.sh` or check `deploy/mosquitto-passwd` |
| Backend connects, no data | device publishes to another topic | must be `smartchamber/sensor/<1|2>` |
| Data arrives only in Sheets | `MQTT_HOST` still a placeholder, or broker unreachable | set host, open port 1883 |
| Duplicate rows in Mongo | legacy payload without `sample_id` | new firmware always sends `sample_id`; dedup keyed on `eventId` |
| Backend restarts lose messages | QoS 0 and `queue_qos0_messages` off | prod config enables queueing; Sheets is the fallback |
