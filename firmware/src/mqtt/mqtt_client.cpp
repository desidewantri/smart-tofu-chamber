#include "mqtt/mqtt_client.h"

#include <PubSubClient.h>
#include <WiFi.h>

#include "config.h"

namespace mqtt_client {

static WiFiClient net;
static PubSubClient client(net);
static char topic[40];

void begin() {
  snprintf(topic, sizeof(topic), "smartchamber/sensor/%d", CHAMBER_ID);
  client.setServer(MQTT_HOST, MQTT_PORT);
  client.setBufferSize(512);
}

bool ensureConnected() {
  if (client.connected()) {
    client.loop();
    return true;
  }
  char id[32];
  snprintf(id, sizeof(id), "stc-esp32-%d-%04X", CHAMBER_ID, (uint16_t)(ESP.getEfuseMac() & 0xFFFF));
  Serial.printf("[mqtt] menghubungkan ke %s:%d ...\n", MQTT_HOST, MQTT_PORT);
  bool ok = (strlen(MQTT_USER) > 0) ? client.connect(id, MQTT_USER, MQTT_PASS) : client.connect(id);
  if (ok) {
    Serial.println("[mqtt] tersambung");
  } else {
    Serial.printf("[mqtt] gagal, rc=%d\n", client.state());
  }
  return ok;
}

bool publishReading(const String &json) {
  bool ok = client.publish(topic, json.c_str());
  Serial.printf("[mqtt] %s -> %s : %s\n", topic, ok ? "OK" : "GAGAL", json.c_str());
  return ok;
}

}  // namespace mqtt_client
