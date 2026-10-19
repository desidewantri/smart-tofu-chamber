#pragma once
#include <Arduino.h>

namespace mqtt_client {
void begin();
// Sambung ulang ke broker bila perlu; true bila tersambung.
bool ensureConnected();
// Kirim payload JSON ke smartchamber/sensor/<CHAMBER_ID>.
bool publishReading(const String &json);
}  // namespace mqtt_client
