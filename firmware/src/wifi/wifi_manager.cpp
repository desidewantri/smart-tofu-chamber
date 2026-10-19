#include "wifi/wifi_manager.h"

#include <WiFi.h>
#include <time.h>

#include "config.h"

namespace wifi_manager {

bool connect(uint32_t timeoutMs) {
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.printf("[wifi] menghubungkan ke %s", WIFI_SSID);
  uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < timeoutMs) {
    delay(500);
    Serial.print('.');
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("[wifi] tersambung, IP %s\n", WiFi.localIP().toString().c_str());
    return true;
  }
  Serial.println("[wifi] gagal tersambung");
  return false;
}

bool ensureConnected() {
  if (WiFi.status() == WL_CONNECTED) return true;
  Serial.println("[wifi] terputus, mencoba lagi...");
  return connect(10000);
}

bool syncTime() {
  configTime(0, 0, NTP_SERVER);  // UTC
  struct tm t;
  for (int i = 0; i < 10; i++) {
    if (getLocalTime(&t, 1000)) return true;
  }
  return false;
}

String isoTimestampUtc() {
  struct tm t;
  if (!getLocalTime(&t, 100)) return "";
  char buf[25];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &t);
  return String(buf);
}

}  // namespace wifi_manager
