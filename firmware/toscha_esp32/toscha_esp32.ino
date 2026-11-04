/*
  ESP32: 2x SHT31 + 2x AGS10 -> MQTT DAN Google Sheets, tiap 5 menit.
  Turunan dari firmware Google Sheets tim. Hardware, pin, pembacaan sensor, baterai,
  pemanasan dan deep sleep TIDAK diubah. Yang diganti hanya bagian pengiriman.

  Siklus (300 s):
    bangun -> baca 4 sensor + baterai -> WiFi on
           -> publish MQTT ke smartchamber/sensor/1 dan /2
           -> POST ke Google Sheets (Apps Script), selalu, format kolom sama seperti dulu
           -> WiFi off -> deep sleep sisa 5 menit
  Sheet tetap lengkap untuk tim (training model, dipantau semua orang).
  Backend memakai data MQTT; baris Sheet hanya diimpor bila data MQTT-nya tidak ada
  (backend/.env: SHEET_MODE=fallback). Jadi tidak ada data dobel.

  Bus A (Wire)  : SDA=21, SCL=22 -> SHT31 #1 (0x44), SHT31 #2 (0x45), AGS10 #1 (0x1A)
  Bus B (Wire1) : SDA=16, SCL=17 -> AGS10 #2 (0x1A)

  Library: "Adafruit SHT31 Library" (+ Adafruit BusIO), "PubSubClient" (knolleary)
  (WiFiClientSecure dan HTTPClient sudah bawaan ESP32)

  JANGAN commit file ini ke git setelah bagian RAHASIA diisi.
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <PubSubClient.h>
#include <Wire.h>
#include "esp_sleep.h"
#include "Adafruit_SHT31.h"

// ---------- RAHASIA: isi sendiri, jangan di-commit ----------
const char* WIFI_SSID = "ISI_SSID";
const char* WIFI_PASS = "ISI_PASSWORD_WIFI";
const char* MQTT_HOST = "116.212.74.136";   // IP / domain server TOSCHA
const uint16_t MQTT_PORT = 1883;
const char* MQTT_USER = "esp32";            // dibuat di server dengan mosquitto_passwd
const char* MQTT_PASS = "ISI_PASSWORD_MQTT";
// Cadangan: Google Apps Script yang sama seperti firmware lama
const char* SCRIPT_URL = "ISI_SCRIPT_URL";
const char* API_KEY    = "ISI_API_KEY";      // sama dengan Code.gs

const uint32_t CYCLE_MS         = 300000;  // satu data tiap 5 menit
const uint32_t WARMUP_MS        = 120000;  // pemanasan AGS10, hanya saat pertama menyala
const uint32_t BOOT_OVERHEAD_MS = 400;     // waktu boot yang tidak terhitung millis()

#define SDA_A 21
#define SCL_A 22
#define SDA_B 16
#define SCL_B 17
#define I2C_FREQ 10000      // AGS10 butuh <= 15 kHz
#define AGS10_ADDR 0x1A

// ---------- monitor baterai ----------
#define BAT_PIN 34                 // pin ADC1 (ADC2 tidak bisa dipakai saat WiFi menyala)
const float DIVIDER_RATIO = 2.0;   // (R1+R2)/R2 -> 100k + 100k = 2.0
const float BAT_CAL       = 0.994; // kalibrasi terhadap multimeter

Adafruit_SHT31 sht1(&Wire);
Adafruit_SHT31 sht2(&Wire);

WiFiClient net;
PubSubClient mqtt(net);

// ---------- AGS10 (tidak diubah) ----------
uint8_t crc8(const uint8_t *data, int len) {
  uint8_t crc = 0xFF;
  for (int i = 0; i < len; i++) {
    crc ^= data[i];
    for (int b = 0; b < 8; b++)
      crc = (crc & 0x80) ? (crc << 1) ^ 0x31 : (crc << 1);
  }
  return crc;
}

// TVOC dalam ppb, -1 = error, -2 = belum siap
long readAGS10(TwoWire &bus) {
  bus.beginTransmission(AGS10_ADDR);
  bus.write((uint8_t)0x00);
  if (bus.endTransmission() != 0) return -1;
  delay(30);
  if (bus.requestFrom((uint8_t)AGS10_ADDR, (uint8_t)5) != 5) return -1;
  uint8_t buf[5];
  for (int i = 0; i < 5; i++) buf[i] = bus.read();
  if (crc8(buf, 4) != buf[4]) return -1;
  if (buf[0] & 0x01) return -2;
  return ((long)buf[1] << 16) | ((long)buf[2] << 8) | buf[3];
}

long readAGS10Retry(TwoWire &bus) {
  long v = -1;
  for (int i = 0; i < 5; i++) {
    v = readAGS10(bus);
    if (v >= 0) return v;
    delay(2000);
  }
  return v;
}

// ---------- tegangan baterai (tidak diubah) ----------
float readBatteryV() {
  analogSetPinAttenuation(BAT_PIN, ADC_11db);
  analogReadMilliVolts(BAT_PIN);
  uint32_t sum = 0;
  for (int i = 0; i < 32; i++) {
    sum += analogReadMilliVolts(BAT_PIN);
    delay(2);
  }
  return (sum / 32.0f) / 1000.0f * DIVIDER_RATIO * BAT_CAL;
}

// ---------- persen baterai untuk Sheet (rumus firmware lama, agar kolom vbat tetap sama) ----------
float batteryPercent(float v) {
  float p = ((v - 3.30f) / (4.00f - 3.30f)) * 100.0f;
  if (p > 100.0f) return 100.0f;
  if (p < 0.0f) return 0.0f;
  return p;
}

// ---------- WiFi + MQTT ----------
bool connectWiFi() {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 20000) delay(250);
  return WiFi.status() == WL_CONNECTED;
}

bool connectMqtt() {
  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setBufferSize(512);
  char id[32];
  snprintf(id, sizeof(id), "toscha-esp32-%04X", (uint16_t)(ESP.getEfuseMac() & 0xFFFF));
  for (int i = 0; i < 3; i++) {
    if (mqtt.connect(id, MQTT_USER, MQTT_PASS)) return true;
    Serial.printf("MQTT gagal (rc=%d), coba lagi...\n", mqtt.state());
    delay(2000);
  }
  return false;
}

// Satu pesan per chamber. Backend menolak data yang tidak lengkap, jadi chamber
// dengan sensor yang gagal dibaca tidak dikirim.
// vbat dikirim sebagai TEGANGAN (V); backend yang mengubahnya ke persen.
bool publishChamber(int chamber, float temp, float humid, long tvoc, float vbatV) {
  if (isnan(temp) || isnan(humid) || tvoc < 0) {
    Serial.printf("Chamber %d: data tidak lengkap, tidak dikirim\n", chamber);
    return false;
  }
  char topic[32];
  snprintf(topic, sizeof(topic), "smartchamber/sensor/%d", chamber);
  char payload[160];
  snprintf(payload, sizeof(payload),
           "{\"chamber_id\":%d,\"tvoc\":%ld,\"suhu\":%.2f,\"rh\":%.2f,\"vbat\":%.2f}",
           chamber, tvoc, temp, humid, vbatV);
  bool ok = mqtt.publish(topic, payload);
  Serial.printf("%s -> %s : %s\n", topic, ok ? "OK" : "GAGAL", payload);
  return ok;
}

// ---------- cadangan: Google Sheets ----------
void addFloat(String &json, const char* key, float v) {
  if (isnan(v)) return;
  json += ",\"" + String(key) + "\":" + String(v, 2);
}
void addInt(String &json, const char* key, long v) {
  if (v < 0) return;
  json += ",\"" + String(key) + "\":" + String(v);
}

// Kirim ke Sheet (format kolom sama seperti firmware lama). Chamber dengan data tidak valid dilewati.
void uploadSheet(bool send1, float t1, float h1, long v1, bool send2, float t2, float h2, long v2, float vbatV) {
  String json = "{\"api_key\":\"" + String(API_KEY) + "\"";
  if (send1) { addFloat(json, "temp1", t1); addFloat(json, "humid1", h1); addInt(json, "tvoc1", v1); }
  if (send2) { addFloat(json, "temp2", t2); addFloat(json, "humid2", h2); addInt(json, "tvoc2", v2); }
  addFloat(json, "vbat", batteryPercent(vbatV));
  json += "}";

  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
  http.setTimeout(10000);
  http.begin(client, SCRIPT_URL);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(json);
  Serial.printf("Cadangan Sheet HTTP %d: %s\n", code, http.getString().c_str());
  http.end();
}

void setup() {
  Serial.begin(115200);
  delay(200);

  // Pertama menyala / reset (bukan bangun dari timer): tunggu AGS10 panas sekali
  if (esp_sleep_get_wakeup_cause() != ESP_SLEEP_WAKEUP_TIMER) {
    Serial.println("Boot pertama: pemanasan AGS10 120 s...");
    Serial.flush();
    esp_sleep_enable_timer_wakeup((uint64_t)WARMUP_MS * 1000ULL);
    esp_light_sleep_start();
  }

  uint32_t t0 = millis();

  // 1) baca semua sensor (tidak diubah)
  Wire.begin(SDA_A, SCL_A, I2C_FREQ);
  Wire1.begin(SDA_B, SCL_B, I2C_FREQ);

  bool ok1 = sht1.begin(0x44);
  bool ok2 = sht2.begin(0x45);

  float temp1  = ok1 ? sht1.readTemperature() : NAN;
  float humid1 = ok1 ? sht1.readHumidity()    : NAN;
  float temp2  = ok2 ? sht2.readTemperature() : NAN;
  float humid2 = ok2 ? sht2.readHumidity()    : NAN;
  long  tvoc1  = readAGS10Retry(Wire);
  long  tvoc2  = readAGS10Retry(Wire1);
  float vbatV  = readBatteryV();   // dibaca sebelum WiFi menyala

  Serial.printf("S1: %.2f C, %.2f %%RH, TVOC %ld | S2: %.2f C, %.2f %%RH, TVOC %ld | Bat %.2f V\n",
                temp1, humid1, tvoc1, temp2, humid2, tvoc2, vbatV);

  // 2) kirim ke MQTT, lalu ke Google Sheets (keduanya, setiap siklus)
  if (!connectWiFi()) {
    Serial.println("WiFi gagal, data siklus ini hilang");
  } else {
    if (connectMqtt()) {
      publishChamber(1, temp1, humid1, tvoc1, vbatV);
      publishChamber(2, temp2, humid2, tvoc2, vbatV);
      // beri waktu pesan terkirim sebelum koneksi diputus
      for (int i = 0; i < 10; i++) { mqtt.loop(); delay(50); }
      mqtt.disconnect();
    } else {
      Serial.println("Broker MQTT tidak bisa dihubungi (data tetap dikirim ke Sheet)");
    }
    uploadSheet(true, temp1, humid1, tvoc1, true, temp2, humid2, tvoc2, vbatV);
  }
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);

  // 3) deep sleep sisa siklus 5 menit (jalur 3V3 tetap menyala)
  uint32_t elapsed = (millis() - t0) + BOOT_OVERHEAD_MS;
  uint32_t sleepMs = (elapsed < CYCLE_MS) ? (CYCLE_MS - elapsed) : 1000;
  Serial.printf("Deep sleep %lu s\n", (unsigned long)(sleepMs / 1000));
  Serial.flush();
  esp_sleep_enable_timer_wakeup((uint64_t)sleepMs * 1000ULL);
  esp_deep_sleep_start();
}

void loop() {
  // tidak pernah dijalankan: setiap siklus berjalan di setup() setelah bangun dari deep sleep
}
