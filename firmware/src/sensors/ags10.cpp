#include "sensors/ags10.h"

bool AGS10::begin(TwoWire &wire, uint8_t address) {
  _wire = &wire;
  _addr = address;
  _wire->beginTransmission(_addr);
  return _wire->endTransmission() == 0;  // perangkat membalas ACK?
}

uint8_t AGS10::crc8(const uint8_t *data, size_t len) {
  uint8_t crc = 0xFF;
  for (size_t i = 0; i < len; i++) {
    crc ^= data[i];
    for (uint8_t b = 0; b < 8; b++) {
      crc = (crc & 0x80) ? (uint8_t)((crc << 1) ^ 0x31) : (uint8_t)(crc << 1);
    }
  }
  return crc;
}

bool AGS10::read(uint32_t &tvocPpb, bool &ready) {
  if (!_wire) return false;

  _wire->beginTransmission(_addr);
  _wire->write((uint8_t)0x00);  // register data TVOC
  if (_wire->endTransmission() != 0) return false;

  delay(30);

  if (_wire->requestFrom(_addr, (uint8_t)5) != 5) return false;
  uint8_t buf[5];
  for (uint8_t i = 0; i < 5; i++) buf[i] = _wire->read();

  if (crc8(buf, 4) != buf[4]) return false;  // CRC salah -> buang

  ready = (buf[0] & 0x01) == 0;
  tvocPpb = ((uint32_t)buf[1] << 16) | ((uint32_t)buf[2] << 8) | buf[3];
  return true;
}
