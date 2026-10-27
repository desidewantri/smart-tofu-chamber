# Smart Tofu Chamber

Aplikasi monitoring dan prediksi shelf-life tahu secara real-time (Capstone C-251).
Sensor ESP32 (AGS10 + SHT31) → MQTT → Backend (Express + MongoDB) → Dashboard (Next.js).

> Folder `ml-service/` (FastAPI, Random Forest + LSTM) dikerjakan anggota tim ML dan **tidak ada** di sini.
> Sampai ml-service siap, backend memakai **model tiruan** (`ML_MODE=mock`) agar seluruh alur bisa dicoba.

```
smart-tofu-chamber/
├── frontend/   Next.js 14 + Tailwind + Recharts (Login, Dashboard, Chambers, Analysis, History, Settings)
├── backend/    Express + Mongoose + MQTT + JWT (+ seed & simulator sensor)
├── firmware/   ESP32 (PlatformIO)
├── docs/       arsitektur, API, database
├── infra/      konfigurasi Mosquitto
└── docker-compose.yml   MongoDB + Mosquitto
```

## Prasyarat
- Node.js 18+ (dicoba dengan Node 22)
- Docker Desktop (untuk MongoDB + Mosquitto). Tanpa Docker: pasang MongoDB Community sendiri, dan MQTT bisa dimatikan (`MQTT_ENABLED=false`).

## Cara menjalankan (dengan backend asli)

Buka 3 terminal dari folder `smart-tofu-chamber`.

**1. Database + MQTT broker**
```bash
docker compose up -d
```

**2. Backend** (terminal 2)
```bash
cd backend
npm install
npm run seed      # isi data demo (sekali; mengulang akan menghapus data lama)
npm run dev       # API di http://localhost:5000
```

**3. Frontend** (terminal 3)
```bash
cd frontend
npm install
npm run dev       # http://localhost:3000
```

Login demo: **admin@tofu.local** / **admin123** (ganti di Settings → Akun).

### Mencoba sensor tanpa hardware
Terminal ke-4:
```bash
cd backend
npm run simulate -- --chamber 3            # kirim via HTTP
npm run simulate -- --chamber 3 --mqtt     # kirim via MQTT (lewat Mosquitto)
```
Chamber 3 tidak punya sesi aktif di data demo, jadi sesi baru muncul otomatis di Dashboard beberapa detik kemudian. Tombol **Tahu Sudah Keluar** menutup sesi dan memindahkannya ke History.

### Mode demo tanpa backend dan Docker
Hanya untuk melihat tampilan (data tiruan di browser, hilang saat refresh):
```bash
cd frontend
npm install
npm run dev:mock
```

## Konfigurasi
- `backend/.env`: port, URL MongoDB/MQTT, `JWT_SECRET`, `DEVICE_API_KEY`, `ML_MODE`, `ML_SERVICE_URL`. Contoh di `.env.example`.
- `frontend/.env.local`: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_USE_MOCK`. Ubah env lalu restart `npm run dev`.

## Menyambungkan ml-service (bagian teman)
1. Jalankan ml-service di port 8000 dengan endpoint `POST /predict`. Kontrak lengkap di [docs/api/README.md](docs/api/README.md).
2. Di `backend/.env`: `ML_MODE=auto` (jatuh ke mock bila gagal) atau `live`, lalu restart backend.
3. Cek `GET http://localhost:5000/api/health` dan kolom "Model Aktif" di Dashboard.

## Menyambungkan ESP32
1. Edit `firmware/include/config.h`: WiFi, `MQTT_HOST` (IP komputer yang menjalankan Mosquitto, bukan `localhost`), `CHAMBER_ID`.
2. Buka `firmware/` dengan PlatformIO (VS Code) lalu Upload.
3. Pastikan firewall komputer mengizinkan port 1883.

## Tes
```bash
cd backend && npm test        # 19 tes unit (zona status, validasi payload, ML client, analisis)
```

## Yang sudah dan belum diverifikasi
Diuji di lingkungan pengembangan saya:
- Backend: 19 tes unit lulus; rute tanpa database dicek (health, 401, validasi 400).
- Frontend: `next build` lulus; semua halaman dibuka di browser headless (mode demo) tanpa error konsol; alur login, tutup sesi, tab Analysis, tampilan mobile dicek.

**Belum teruji** (tidak bisa dijalankan di lingkungan saya, jadi mungkin perlu penyesuaian kecil saat pertama dijalankan):
- Backend terhubung ke MongoDB asli, `npm run seed`, alur MQTT lewat Mosquitto, dan `npm run simulate`.
- Frontend melawan backend asli (mode demo dan backend memakai bentuk data yang sama, tetapi belum dipasangkan langsung).
- Firmware: belum dikompilasi atau diunggah ke ESP32. Format baca AGS10 (register `0x00`, 5 byte, CRC8 0x31/0xFF, status bit0) ditulis dari ingatan format datasheet; **cocokkan dengan datasheet AGS10 Anda**. AGS10 butuh clock I2C ≤ 15 kHz.

Bila ada galat saat menjalankan, kirimkan pesan galatnya.

## Catatan ilmiah penting
- Prediksi dari model tiruan **bukan** hasil ML. Angka koreksinya asumsi.
- Hubungan TVOC ↔ jumlah bakteri pada tahu belum tervalidasi oleh jurnal yang kami temukan. Batas parameter sensor (Settings) dan asumsi Biaya & Manfaat adalah titik awal yang harus disesuaikan dengan data uji lab.
- Teks di Analysis menyatakan bahwa TVOC/suhu/RH adalah parameter pendukung prediksi, bukan pengukuran langsung kondisi mikrobiologis.

## Masalah umum
| Gejala | Solusi |
|---|---|
| Backend: "Gagal terhubung ke MongoDB" | `docker compose up -d`, tunggu beberapa detik, jalankan ulang. |
| Frontend: "Tidak dapat terhubung ke server" | Backend belum jalan, atau `NEXT_PUBLIC_API_URL` salah. |
| Login gagal | Jalankan `npm run seed` di `backend/`. |
| Dashboard kosong | Belum ada sesi aktif; jalankan `npm run seed` atau simulator. |
| Chamber "Offline" | Sensor tidak mengirim data dalam 3× interval (default 15 menit). |
| Port 5000 dipakai (macOS) | Ubah `PORT` di `backend/.env` dan `NEXT_PUBLIC_API_URL` di frontend. |
