#pragma once
// Copy this file to config_secrets.h and fill in the real values.
// config_secrets.h is gitignored and must never be committed.

// Wi-Fi (ESP32 only supports 2.4 GHz).
#define WIFI_SSID "ISI_SSID"
#define WIFI_PASS "ISI_PASSWORD_WIFI"

// Google Apps Script Web App that appends to the "testing" tab.
#define SCRIPT_URL "ISI_SCRIPT_URL"
#define API_KEY "ISI_API_KEY"

// MQTT broker. Leave MQTT_HOST starting with "ISI_" to disable MQTT cleanly.
#define MQTT_HOST "ISI_MQTT_HOST"
#define MQTT_PORT 1883
#define MQTT_USER "ISI_MQTT_USER"
#define MQTT_PASS "ISI_MQTT_PASS"

// 0 = plain TCP (bench only), 1 = TLS. For TLS, provide the broker CA below;
// without it the sketch falls back to setInsecure() and prints a warning.
#define MQTT_USE_TLS 0
// #define MQTT_CA_CERT "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n"
