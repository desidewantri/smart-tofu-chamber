/*
  =========================================================
  TOFUSENSE - DUAL SEND (MQTT + GOOGLE SHEETS)
  ESP32 + 2x SHT31 + 2x AGS10
  =========================================================

  Derived from the verified bench-test V2 sketch. Hardware reading,
  I2C mapping, NTP, sample_id and the Google Sheets redirect handling are
  unchanged. The only functional addition is MQTT publishing.

  VERIFIED HARDWARE MAPPING (do not change)

  BUS A / Wire:
    SDA = GPIO 21
    SCL = GPIO 22
    SHT31 #1 = 0x44   -> Chamber 1
    SHT31 #2 = 0x45   -> Chamber 2 (see note below)
    AGS10 #1 = 0x1A   -> Chamber 1

  BUS B / Wire1:
    SDA = GPIO 16
    SCL = GPIO 17
    AGS10 #2 = 0x1A   -> Chamber 2

  NOTE ON CHAMBER OWNERSHIP
  SHT31 #2 sits on Bus A with address 0x45 and is treated as Chamber 2's
  temperature/humidity sensor because that is how the verified bench test is
  wired and labelled. The physical chamber-to-sensor assignment has NOT been
  proven by an independent test; see docs/architecture/README.md.

  PER CYCLE (5 minutes):
    1. ensure Wi-Fi (persistent, auto reconnect)
    2. ensure NTP clock
    3. read SHT31 #1/#2 and AGS10 #1/#2
    4. build one sample_id + sampled_at for the cycle
    5. publish two MQTT messages (chamber 1 and 2)
    6. upload one Google Sheets row (both chambers)
    7. MQTT failure never blocks Sheets; Sheets failure never blocks MQTT

  SECRETS
    Wifi, Apps Script URL/API key and MQTT credentials live in
    "config_secrets.h" (not committed). Copy config_secrets.example.h and fill
    it in. Without that file the sketch compiles with placeholders and both
    destinations will fail gracefully.

  LIBRARIES
    Adafruit SHT31 Library (+ Adafruit BusIO)
    PubSubClient (knolleary)

  SCOPE
    Bench profile. Wi-Fi stays on. No deep sleep. Battery monitoring disabled.
    MQTT publishes at QoS 0 because PubSubClient does not publish QoS 1.
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <time.h>
#include <math.h>
#include <esp_system.h>
#include <PubSubClient.h>
#include "Adafruit_SHT31.h"

#if __has_include("config_secrets.h")
#include "config_secrets.h"
#else
#include "config_secrets.example.h"
#warning "config_secrets.h not found - using placeholder credentials"
#endif

#ifndef MQTT_USE_TLS
#define MQTT_USE_TLS 0
#endif

// =========================================================
// 1. FIXED DEVICE CONFIGURATION
// =========================================================

static const uint32_t CYCLE_MS = 300000UL;
static const uint32_t AGS_WARMUP_MS = 120000UL;
static const uint32_t WIFI_TIMEOUT_MS = 20000UL;
static const uint32_t NTP_TIMEOUT_MS = 20000UL;

static const int SDA_A = 21;
static const int SCL_A = 22;
static const int SDA_B = 16;
static const int SCL_B = 17;

static const uint32_t I2C_FREQ = 10000;

static const uint8_t SHT1_ADDR = 0x44;
static const uint8_t SHT2_ADDR = 0x45;
static const uint8_t AGS10_ADDR = 0x1A;

static const char* NTP_SERVER_1 = "pool.ntp.org";
static const char* NTP_SERVER_2 = "time.google.com";

static const char* TOPIC_PREFIX = "smartchamber/sensor/";

// Result of one sampling cycle (declared before functions: the Arduino
// preprocessor hoists prototypes above the first function).
struct CycleResult {
  bool mqtt[2];
  bool sheet;
  String sampleId;
  String sampledAt;
};


// =========================================================
// 2. SENSOR OBJECTS
// =========================================================

Adafruit_SHT31 sht1(&Wire);
Adafruit_SHT31 sht2(&Wire);

bool sht1Ready = false;
bool sht2Ready = false;

uint32_t sampleSequence = 0;

// =========================================================
// 3. MQTT TRANSPORT
// =========================================================

#if MQTT_USE_TLS
WiFiClientSecure mqttNet;
#else
WiFiClient mqttNet;
#endif

PubSubClient mqtt(mqttNet);

bool mqttConfigured() {
  // Placeholder is the literal prefix "ISI_". Checking only the first character
  // would silently disable MQTT for a real host such as "iot.example.com".
  return strlen(MQTT_HOST) > 0 && strncmp(MQTT_HOST, "ISI_", 4) != 0;
}

bool ensureMqtt() {
  if (!mqttConfigured()) {
    return false;
  }
  if (mqtt.connected()) {
    mqtt.loop();
    return true;
  }

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setBufferSize(512);
  mqtt.setKeepAlive(30);

#if MQTT_USE_TLS
  #ifdef MQTT_CA_CERT
    if (strlen(MQTT_CA_CERT) > 1) {
      mqttNet.setCACert(MQTT_CA_CERT);
    } else {
      mqttNet.setInsecure();
      Serial.println("[mqtt] WARNING: TLS without CA verification (setInsecure)");
    }
  #else
    mqttNet.setInsecure();
    Serial.println("[mqtt] WARNING: TLS without CA verification (setInsecure)");
  #endif
#endif

  char clientId[40];
  snprintf(clientId, sizeof(clientId), "toscha-esp32-%04X",
           (uint16_t)(ESP.getEfuseMac() & 0xFFFF));

  Serial.printf("[mqtt] connecting to %s:%d ...\n", MQTT_HOST, MQTT_PORT);

  for (uint8_t attempt = 1; attempt <= 3; attempt++) {
    bool ok;
    if (strlen(MQTT_USER) > 0) {
      ok = mqtt.connect(clientId, MQTT_USER, MQTT_PASS);
    } else {
      ok = mqtt.connect(clientId);
    }
    if (ok) {
      Serial.println("[mqtt] connected");
      return true;
    }
    Serial.printf("[mqtt] attempt %u failed (rc=%d)\n", attempt, mqtt.state());
    delay(2000);
  }
  return false;
}

// =========================================================
// 4. I2C SCANNER
// =========================================================

void printBusDevices(TwoWire& bus, const char* busName) {
  Serial.printf("\nI2C scan %s:\n", busName);
  uint8_t found = 0;
  for (uint8_t address = 1; address < 127; address++) {
    bus.beginTransmission(address);
    if (bus.endTransmission() == 0) {
      Serial.printf("  Found device at 0x%02X\n", address);
      found++;
    }
  }
  if (found == 0) Serial.println("  No I2C devices found.");
  Serial.printf("  Total devices: %u\n", found);
}

// =========================================================
// 5. SHT31 INITIALIZATION
// =========================================================

bool beginSHT31At(Adafruit_SHT31& sensor, const char* label, uint8_t address) {
  if (sensor.begin(address)) {
    Serial.printf("%s initialized at 0x%02X\n", label, address);
    return true;
  }
  Serial.printf("ERROR: %s not found at 0x%02X\n", label, address);
  return false;
}

// =========================================================
// 6. AGS10 CRC8
// =========================================================

uint8_t crc8AGS10(const uint8_t* data, size_t length) {
  uint8_t crc = 0xFF;
  for (size_t i = 0; i < length; i++) {
    crc ^= data[i];
    for (uint8_t bit = 0; bit < 8; bit++) {
      crc = (crc & 0x80) ? (uint8_t)((crc << 1) ^ 0x31) : (uint8_t)(crc << 1);
    }
  }
  return crc;
}

// =========================================================
// 7. AGS10 READING (unchanged)
// =========================================================

long readAGS10(TwoWire& bus) {
  bus.beginTransmission(AGS10_ADDR);
  bus.write((uint8_t)0x00);
  if (bus.endTransmission() != 0) return -1;
  delay(30);
  if (bus.requestFrom((uint8_t)AGS10_ADDR, (uint8_t)5) != 5) {
    while (bus.available()) bus.read();
    return -1;
  }
  uint8_t buffer[5];
  for (uint8_t i = 0; i < 5; i++) {
    int value = bus.read();
    if (value < 0) return -1;
    buffer[i] = (uint8_t)value;
  }
  if (crc8AGS10(buffer, 4) != buffer[4]) return -1;
  if (buffer[0] & 0x01) return -2;
  return ((long)buffer[1] << 16) | ((long)buffer[2] << 8) | (long)buffer[3];
}

long readAGS10WithRetry(TwoWire& bus, const char* label) {
  long result = -1;
  for (uint8_t attempt = 1; attempt <= 5; attempt++) {
    result = readAGS10(bus);
    if (result >= 0) {
      Serial.printf("%s TVOC: %ld ppb (attempt %u)\n", label, result, attempt);
      return result;
    }
    Serial.printf("%s read attempt %u failed (code %ld)\n", label, attempt, result);
    if (attempt < 5) delay(2000);
  }
  return result;
}

// =========================================================
// 8. WIFI (persistent, auto reconnect)
// =========================================================

bool connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return true;

  Serial.println("WiFi disconnected. Reconnecting...");
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < WIFI_TIMEOUT_MS) {
    delay(300);
  }
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi connected. IP: ");
    Serial.println(WiFi.localIP());
    return true;
  }
  Serial.println("ERROR: WiFi connection failed.");
  return false;
}

// =========================================================
// 9. NTP
// =========================================================

bool ensureClock() {
  time_t now = time(nullptr);
  if (now >= 1700000000) return true;
  if (WiFi.status() != WL_CONNECTED) return false;

  configTime(0, 0, NTP_SERVER_1, NTP_SERVER_2);
  uint32_t start = millis();
  now = time(nullptr);
  while (now < 1700000000 && millis() - start < NTP_TIMEOUT_MS) {
    delay(300);
    now = time(nullptr);
  }
  if (now < 1700000000) {
    Serial.println("WARNING: NTP synchronization failed.");
    return false;
  }
  Serial.println("NTP synchronized (UTC).");
  return true;
}

String formatUtcTimestamp(time_t epoch) {
  if (epoch < 1700000000) return "";
  struct tm timeInfo;
  gmtime_r(&epoch, &timeInfo);
  char buffer[25];
  snprintf(buffer, sizeof(buffer), "%04d-%02d-%02dT%02d:%02d:%02dZ",
           timeInfo.tm_year + 1900, timeInfo.tm_mon + 1, timeInfo.tm_mday,
           timeInfo.tm_hour, timeInfo.tm_min, timeInfo.tm_sec);
  return String(buffer);
}

// =========================================================
// 10. SAMPLE IDENTITY
// =========================================================

String deviceId() {
  String mac = WiFi.macAddress();
  mac.replace(":", "");
  mac.replace("-", "");
  return String("tofusense-") + mac;
}

String makeSampleId(time_t epoch) {
  sampleSequence++;
  if (epoch >= 1700000000) {
    return deviceId() + "-" + String((uint32_t)epoch) + "-" + String(sampleSequence);
  }
  return deviceId() + "-unsynced-" + String((uint32_t)esp_random()) + "-" + String(sampleSequence);
}

String eventIdFor(const String& sampleId, int chamber) {
  return sampleId + "-ch" + String(chamber);
}

// =========================================================
// 11. JSON HELPERS
// =========================================================

void addJsonFloat(String& json, const char* key, float value) {
  if (!isfinite(value)) return;
  if (json.length() > 1) json += ",";
  json += "\"" + String(key) + "\":" + String(value, 2);
}

void addJsonInt(String& json, const char* key, long value) {
  if (value < 0) return;
  if (json.length() > 1) json += ",";
  json += "\"" + String(key) + "\":" + String(value);
}

void addJsonString(String& json, const char* key, const String& value) {
  if (json.length() > 1) json += ",";
  json += "\"" + String(key) + "\":\"" + value + "\"";
}

// =========================================================
// 12. MQTT PAYLOAD (one message per chamber)
// =========================================================

bool publishChamberMqtt(int chamber, const String& sampleId, const String& sampledAt,
                        float temp, float humid, long tvoc) {
  // Backend rejects incomplete readings; do not send a chamber whose sensors
  // failed. The other chamber is still published independently.
  if (!isfinite(temp) || !isfinite(humid) || tvoc < 0) {
    Serial.printf("[mqtt] chamber %d incomplete, not published\n", chamber);
    return false;
  }
  if (!ensureMqtt()) {
    Serial.printf("[mqtt] chamber %d not published: broker unavailable\n", chamber);
    return false;
  }

  String payload = "{";
  addJsonString(payload, "event_id", eventIdFor(sampleId, chamber));
  addJsonString(payload, "sample_id", sampleId);
  addJsonString(payload, "device_id", deviceId());
  addJsonInt(payload, "chamber_id", chamber);
  addJsonInt(payload, "tvoc", tvoc);
  addJsonFloat(payload, "suhu", temp);
  addJsonFloat(payload, "rh", humid);
  if (sampledAt.length() > 0) {
    addJsonString(payload, "sampled_at", sampledAt);
    addJsonString(payload, "timestamp", sampledAt);  // legacy field
  }
  payload += "}";

  char topic[40];
  snprintf(topic, sizeof(topic), "%s%d", TOPIC_PREFIX, chamber);

  bool ok = mqtt.publish(topic, payload.c_str());
  Serial.printf("[mqtt] %s -> %s : %s\n", topic, ok ? "OK" : "FAILED", payload.c_str());
  return ok;
}

// =========================================================
// 13. GOOGLE SHEETS UPLOAD (unchanged contract)
// =========================================================

bool uploadToGoogleSheets(const String& payload) {
  if (!connectWiFi()) return false;

  int postCode = -1;
  String redirectUrl;

  {
    WiFiClientSecure postClient;
    postClient.setInsecure();  // Apps Script endpoint; see docs/security notes
    HTTPClient postHttp;
    postHttp.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
    postHttp.setTimeout(15000);
    const char* responseHeaders[] = {"Location"};
    postHttp.collectHeaders(responseHeaders, 1);

    if (!postHttp.begin(postClient, SCRIPT_URL)) {
      Serial.println("ERROR: POST HTTP begin failed.");
      return false;
    }
    postHttp.addHeader("Content-Type", "application/json");
    postCode = postHttp.POST(payload);
    redirectUrl = postHttp.header("Location");
    Serial.printf("Sheets initial POST status: %d\n", postCode);
    String body = postHttp.getString();
    if (body.length() > 0) Serial.println("Initial response: " + body.substring(0, 250));
    postHttp.end();
  }

  if (postCode == 301 || postCode == 302 || postCode == 303 || postCode == 307 || postCode == 308) {
    if (redirectUrl.length() == 0) {
      Serial.println("ERROR: Redirect Location header missing.");
      return false;
    }
    Serial.println("Following Google redirect using GET...");
    WiFiClientSecure getClient;
    getClient.setInsecure();
    HTTPClient getHttp;
    getHttp.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    getHttp.setTimeout(15000);
    if (!getHttp.begin(getClient, redirectUrl)) {
      Serial.println("ERROR: Redirect GET begin failed.");
      return false;
    }
    int getCode = getHttp.GET();
    String response = getHttp.getString();
    Serial.printf("Redirect GET status: %d\n", getCode);
    Serial.println("Sheets response: " + response);
    getHttp.end();
    return getCode >= 200 && getCode < 300 && response.indexOf("\"ok\":true") >= 0;
  }

  Serial.printf("Unexpected initial POST status: %d\n", postCode);
  return false;
}

// =========================================================
// 14. SAMPLING CYCLE
// =========================================================

CycleResult runSamplingCycle() {
  CycleResult result = {{false, false}, false, "", ""};

  Serial.println("\n========================================");
  Serial.println("Starting TofuSense sampling cycle");

  bool wifiReady = connectWiFi();
  bool clockReady = ensureClock();
  time_t sampleEpoch = clockReady ? time(nullptr) : 0;
  result.sampledAt = formatUtcTimestamp(sampleEpoch);
  result.sampleId = makeSampleId(sampleEpoch);

  float temp1 = NAN, humid1 = NAN, temp2 = NAN, humid2 = NAN;
  long tvoc1 = -1, tvoc2 = -1;

  if (sht1Ready) {
    temp1 = sht1.readTemperature();
    humid1 = sht1.readHumidity();
  }
  if (sht2Ready) {
    temp2 = sht2.readTemperature();
    humid2 = sht2.readHumidity();
  }
  tvoc1 = readAGS10WithRetry(Wire, "Chamber 1 / AGS10 #1");
  tvoc2 = readAGS10WithRetry(Wire1, "Chamber 2 / AGS10 #2");

  Serial.println("\n--- SENSOR SUMMARY ---");
  Serial.printf("Chamber 1 | SHT31: %.2f C, %.2f %%RH | AGS10: %ld ppb\n", temp1, humid1, tvoc1);
  Serial.printf("Chamber 2 | SHT31: %.2f C, %.2f %%RH | AGS10: %ld ppb\n", temp2, humid2, tvoc2);
  Serial.printf("sample_id: %s\n", result.sampleId.c_str());
  Serial.printf("sampled_at: %s\n", result.sampledAt.length() ? result.sampledAt.c_str() : "UNAVAILABLE");

  // ---- 1. MQTT (primary, real-time) ----
  if (wifiReady) {
    result.mqtt[0] = publishChamberMqtt(1, result.sampleId, result.sampledAt, temp1, humid1, tvoc1);
    result.mqtt[1] = publishChamberMqtt(2, result.sampleId, result.sampledAt, temp2, humid2, tvoc2);
    // Let PubSubClient flush before the next blocking HTTP call.
    for (int i = 0; i < 10; i++) { mqtt.loop(); delay(50); }
  } else {
    Serial.println("MQTT skipped: WiFi unavailable.");
  }

  // ---- 2. Google Sheets (archive / fallback), independent of MQTT ----
  String payload = "{";
  addJsonString(payload, "api_key", String(API_KEY));
  addJsonString(payload, "sample_id", result.sampleId);
  addJsonString(payload, "sampled_at", result.sampledAt);
  addJsonFloat(payload, "temp1", temp1);
  addJsonFloat(payload, "humid1", humid1);
  addJsonInt(payload, "tvoc1", tvoc1);
  addJsonFloat(payload, "temp2", temp2);
  addJsonFloat(payload, "humid2", humid2);
  addJsonInt(payload, "tvoc2", tvoc2);
  // vbat intentionally omitted: battery topology is not verified in this phase.
  payload += "}";

  if (wifiReady) {
    result.sheet = uploadToGoogleSheets(payload);
    Serial.println(result.sheet ? "SUCCESS: Google Sheets accepted the sample."
                                : "ERROR: Google Sheets upload failed.");
  } else {
    Serial.println("Sheets skipped: WiFi unavailable.");
  }

  Serial.printf("[cycle] mqtt ch1=%s ch2=%s sheet=%s\n",
                result.mqtt[0] ? "OK" : "FAIL",
                result.mqtt[1] ? "OK" : "FAIL",
                result.sheet ? "OK" : "FAIL");
  Serial.println("WiFi remains connected. Cycle complete.");
  Serial.println("========================================\n");
  return result;
}

// =========================================================
// 15. SETUP / LOOP
// =========================================================

uint32_t lastCycleStarted = 0;

void setup() {
  Serial.begin(115200);
  delay(500);

  Serial.println("\n========================================");
  Serial.println("TOFUSENSE DUAL SEND (MQTT + SHEETS)");
  Serial.println("WiFi persistent bench profile");
  Serial.println("========================================");

  Wire.begin(SDA_A, SCL_A, I2C_FREQ);
  Wire1.begin(SDA_B, SCL_B, I2C_FREQ);

  printBusDevices(Wire, "Bus A / Wire (GPIO 21/22)");
  printBusDevices(Wire1, "Bus B / Wire1 (GPIO 16/17)");

  Serial.println("\nInitializing SHT31 sensors...");
  sht1Ready = beginSHT31At(sht1, "SHT31 #1 / Chamber 1", SHT1_ADDR);
  sht2Ready = beginSHT31At(sht2, "SHT31 #2 / Chamber 2", SHT2_ADDR);

  Serial.println("\nStarting persistent WiFi connection...");
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.setSleep(false);
  if (connectWiFi()) {
    ensureClock();
    if (!ensureMqtt()) {
      Serial.println("WARNING: MQTT unavailable at boot; Sheets will still be attempted each cycle.");
    }
  }

  Serial.printf("\nAGS10 warm-up: %lu seconds\n", (unsigned long)(AGS_WARMUP_MS / 1000UL));
  Serial.println("WiFi stays connected during warm-up.");
  delay(AGS_WARMUP_MS);
  Serial.println("Warm-up completed.");

  lastCycleStarted = millis();
  runSamplingCycle();
  Serial.println("Next sampling cycle in approximately 5 minutes.");
}

void loop() {
  // Keep the MQTT connection alive and detect broker loss.
  if (mqtt.connected()) {
    mqtt.loop();
  }

  if ((uint32_t)(millis() - lastCycleStarted) >= CYCLE_MS) {
    lastCycleStarted = millis();
    runSamplingCycle();
    Serial.println("Next sampling cycle in approximately 5 minutes.");
  }

  delay(100);
}
