#pragma once
#include <Arduino.h>

namespace wifi_manager {
// Hubungkan WiFi (blocking sampai timeoutMs). true bila tersambung.
bool connect(uint32_t timeoutMs = 20000);
// Panggil di loop(): sambung ulang bila terputus.
bool ensureConnected();
// Sinkronisasi waktu NTP; true bila waktu valid.
bool syncTime();
// Waktu UTC format ISO 8601, atau string kosong jika belum sinkron.
String isoTimestampUtc();
}  // namespace wifi_manager
