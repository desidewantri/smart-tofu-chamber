#pragma once
#include <Arduino.h>
#include <Wire.h>

// Driver minimal AGS10 (TVOC, ppb) lewat I2C, alamat 0x1A.
// Format baca (5 byte): [status][TVOC 3 byte][CRC8].
//  - status bit0 = 0 -> data siap, 1 -> sensor masih pemanasan
//  - CRC8: polinomial 0x31, nilai awal 0xFF, dihitung atas 4 byte pertama
// CATATAN: verifikasi format & timing dengan datasheet AGS10 yang Anda pakai.
class AGS10 {
 public:
  bool begin(TwoWire &wire, uint8_t address);
  // true bila pembacaan valid (I2C sukses + CRC cocok). `ready` false = masih pemanasan.
  bool read(uint32_t &tvocPpb, bool &ready);

 private:
  static uint8_t crc8(const uint8_t *data, size_t len);
  TwoWire *_wire = nullptr;
  uint8_t _addr = 0x1A;
};
