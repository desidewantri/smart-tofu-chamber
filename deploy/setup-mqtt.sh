#!/usr/bin/env bash
# Aktifkan MQTT di server TOSCHA (sekali saja). Jalankan dari mana saja:
#   bash ~/smart-tofu-chamber/deploy/setup-mqtt.sh
# - membuat user broker "esp32" dan "backend" dengan password acak (deploy/mosquitto-passwd)
# - mengisi MQTT_USERNAME/MQTT_PASSWORD dan SHEET_MODE=fallback di backend/.env
# - membuka port 1883 dan menjalankan ulang container
set -euo pipefail
cd ~/smart-tofu-chamber
F=deploy/mosquitto-passwd

# Bila Docker sempat membuat folder kosong dengan nama ini, hapus dulu.
if [ -d "$F" ]; then sudo rmdir "$F"; fi

if [ -s "$F" ]; then
  echo "[mqtt] File password sudah ada, tidak dibuat ulang. (Hapus $F bila ingin password baru.)"
else
  P_ESP=$(openssl rand -hex 12)
  P_BE=$(openssl rand -hex 12)
  docker run --rm -v "$PWD/deploy:/work" eclipse-mosquitto:2 sh -c \
    "mosquitto_passwd -b -c /work/mosquitto-passwd esp32 $P_ESP && mosquitto_passwd -b /work/mosquitto-passwd backend $P_BE"
  sudo chown 1883:1883 "$F"
  sudo chmod 600 "$F"

  # backend/.env: ganti baris lama (bila ada) lalu tambahkan yang baru
  [ -n "$(tail -c1 backend/.env)" ] && echo >> backend/.env
  sed -i '/^MQTT_USERNAME=/d;/^MQTT_PASSWORD=/d;/^MQTT_CLIENT_ID=/d;/^SHEET_MODE=/d' backend/.env
  printf 'MQTT_USERNAME=backend\nMQTT_PASSWORD=%s\nMQTT_CLIENT_ID=toscha-backend\nSHEET_MODE=fallback\n' "$P_BE" >> backend/.env

  echo
  echo "=========== CATAT UNTUK FIRMWARE ESP32 (jangan dibagikan / di-commit) ==========="
  echo "  MQTT_USER = esp32"
  echo "  MQTT_PASS = $P_ESP"
  echo "=================================================================================="
  echo
fi

sudo ufw allow 1883/tcp >/dev/null && echo "[ufw] port 1883 dibuka"
docker compose -f docker-compose.prod.yml up -d --build
echo "[mqtt] menunggu backend menyala..."
sleep 10
docker compose -f docker-compose.prod.yml logs --tail=40 backend | grep -E "\[mqtt\]|\[sheet\]" || true
