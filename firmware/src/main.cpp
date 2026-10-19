// Smart Tofu Chamber: ESP32 membaca AGS10 (TVOC) + SHT31 (suhu, RH) tiap 5 menit
// lalu mempublikasikannya lewat MQTT ke smartchamber/sensor/<CHAMBER_ID>.
#include <Adafruit_SHT31.h>
#include <ArduinoJson.h>
#include <Arduino.h>
#include <Wire.h>

#include "config.h"
#include "mqtt/mqtt_client.h"
#include "sensors/ags10.h"
#include "wifi/wifi_manager.h"

static AGS10 ags10;
static Adafruit_SHT31 sht31;
static bool agsOk = false;
static bool shtOk = false;
static uint32_t bootMs = 0;
static uint32_t lastPublishMs = 0;
static bool firstPublishDone = false;

// Baca kedua sensor dengan percobaan ulang. true bila semuanya valid.
static bool readSensors(float &tvoc, float &suhu, float &rh) {
  for (int attempt = 1; attempt <= 3; attempt++) {
    uint32_t tvocPpb = 0;
    bool ready = false;
    bool aOk = agsOk && ags10.read(tvocPpb, ready) && ready;
    float t = shtOk ? sht31.readTemperature() : NAN;
    float h = shtOk ? sht31.readHumidity() : NAN;
    if (aOk && !isnan(t) && !isnan(h)) {
      tvoc = (float)tvocPpb;
      suhu = t;
      rh = h;
      return true;
    }
    Serial.printf("[sensor] percobaan %d gagal (AGS10 %s, SHT31 %s)\n", attempt, aOk ? "ok" : "gagal",
                  (!isnan(t) && !isnan(h)) ? "ok" : "gagal");
    delay(2000);
  }
  return false;
}

static String buildPayload(float tvoc, float suhu, float rh) {
  JsonDocument doc;
  doc["chamber_id"] = CHAMBER_ID;
  doc["tvoc"] = serialized(String(tvoc, 1));
  doc["suhu"] = serialized(String(suhu, 2));
  doc["rh"] = serialized(String(rh, 1));
  String ts = wifi_manager::isoTimestampUtc();
  if (ts.length() > 0) doc["timestamp"] = ts;  // bila kosong, backend memakai waktu servernya
  String out;
  serializeJson(doc, out);
  return out;
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=== Smart Tofu Chamber ===");

  Wire.begin(I2C_SDA, I2C_SCL);
  Wire.setClock(I2C_CLOCK_HZ);
  agsOk = ags10.begin(Wire, AGS10_ADDR);
  shtOk = sht31.begin(SHT31_ADDR);
  Serial.printf("[sensor] AGS10: %s | SHT31: %s\n", agsOk ? "terdeteksi" : "TIDAK terdeteksi",
                shtOk ? "terdeteksi" : "TIDAK terdeteksi");

  wifi_manager::connect();
  if (wifi_manager::syncTime()) Serial.println("[ntp] waktu tersinkron");
  else Serial.println("[ntp] gagal, timestamp dikosongkan (backend memakai waktu server)");

  mqtt_client::begin();
  bootMs = millis();
}

void loop() {
  if (!wifi_manager::ensureConnected()) {
    delay(2000);
    return;
  }
  mqtt_client::ensureConnected();

  // Tahan data sampai sensor selesai pemanasan.
  if (millis() - bootMs < SENSOR_WARMUP_MS) {
    delay(500);
    return;
  }

  uint32_t now = millis();
  if (!firstPublishDone || now - lastPublishMs >= PUBLISH_INTERVAL_MS) {
    float tvoc, suhu, rh;
    if (readSensors(tvoc, suhu, rh)) {
      if (mqtt_client::publishReading(buildPayload(tvoc, suhu, rh))) {
        lastPublishMs = now;
        firstPublishDone = true;
      }
    } else {
      Serial.println("[sensor] pembacaan gagal, data tidak dikirim (akan dicoba lagi)");
      lastPublishMs = now - PUBLISH_INTERVAL_MS + 30000;  // coba lagi 30 detik kemudian
      firstPublishDone = true;
    }
  }
  delay(200);
}
