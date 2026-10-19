#pragma once
// ====== EDIT BAGIAN INI SEBELUM UPLOAD ======

// WiFi (ESP32 hanya mendukung 2.4 GHz)
#define WIFI_SSID "NAMA_WIFI"
#define WIFI_PASSWORD "PASSWORD_WIFI"

// MQTT broker = IP komputer yang menjalankan Mosquitto (bukan "localhost")
#define MQTT_HOST "192.168.1.100"
#define MQTT_PORT 1883
#define MQTT_USER ""
#define MQTT_PASS ""

// Nomor chamber: topik menjadi smartchamber/sensor/<CHAMBER_ID>
#define CHAMBER_ID 1

// Jeda kirim data (ms). 5 menit sesuai proposal.
#define PUBLISH_INTERVAL_MS 300000UL
// Waktu pemanasan sensor sebelum data pertama dikirim (ms). Minimal 2 menit.
#define SENSOR_WARMUP_MS 120000UL

// Pin & pengaturan I2C
#define I2C_SDA 21
#define I2C_SCL 22
// AGS10 hanya andal pada clock I2C rendah (<= 15 kHz). SHT31 tetap aman di 10 kHz.
#define I2C_CLOCK_HZ 10000

#define AGS10_ADDR 0x1A
#define SHT31_ADDR 0x44

// Zona waktu untuk timestamp (WIB = UTC+7). Timestamp dikirim dalam UTC.
#define NTP_SERVER "pool.ntp.org"
