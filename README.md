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
npm run simulate -- --chamber 2            # kirim via HTTP
npm run simulate -- --chamber 2 --mqtt     # kirim via MQTT (lewat Mosquitto)
```
Di data demo kedua chamber sudah punya sesi aktif. Setelah menekan **Tahu Sudah Keluar**, jalankan simulator lagi dan sesi baru (ID berikutnya, mis. CH-063) muncul otomatis di Dasbor. Tombol **Tahu Sudah Keluar** menutup sesi dan memindahkannya ke History.

### Mode demo tanpa backend dan Docker
Hanya untuk melihat tampilan (data tiruan di browser, hilang saat refresh):
```bash
cd frontend
npm install
npm run dev:mock
```

## Bahasa dan Panduan
- **Dua bahasa:** tombol **ID | EN** di pojok kanan atas (di halaman login juga). Pilihan disimpan di peramban. Teks sumber bahasa Indonesia; terjemahan Inggris ada di `frontend/src/i18n/en.js`. Menambah teks baru: tulis dalam bahasa Indonesia memakai `t('...')`, lalu tambahkan padanannya di `en.js`.
- **Menu Panduan** (`/guide`): panduan penggunaan langkah demi langkah, materi dasar (TVOC, satuan, suhu dan kelembapan, umur simpan, sesi, zona status, cara membaca grafik), dan tanya jawab. Isinya di `frontend/src/guide/content.js`.
- **Grafik:** setiap sumbu X dan Y berjudul variabel dan satuan, mis. "Sisa umur simpan (jam)".

## Akun: Daftar, Masuk, dan Google

- **Daftar** (`/register`): nama, email, kata sandi (minimal 8 karakter, berisi huruf dan angka). Akun baru langsung masuk dengan peran `operator`.
- **Masuk** (`/login`): email + kata sandi, atau tombol **Masuk dengan Google**.
- Jika email Google sama dengan akun yang sudah ada, keduanya otomatis ditautkan.
- Akun yang dibuat lewat Google bisa membuat kata sandi di **Pengaturan > Akun**.
- Tutup pendaftaran dengan `ALLOW_REGISTRATION=false` di `backend/.env`.

Mengaktifkan tombol Google (sekali saja):
1. Buka Google Cloud Console > **APIs & Services > OAuth consent screen**, isi nama aplikasi (TOSCHA) dan email, tipe **External**. Selama status *Testing*, tambahkan akun Google penguji di **Test users**.
2. **Credentials > Create credentials > OAuth client ID**, tipe **Web application**.
3. **Authorized JavaScript origins**: `http://localhost` dan `http://localhost:3000` (nanti tambahkan domain server, misal `https://toscha.domainanda.id`). Redirect URI tidak perlu.
4. Salin **Client ID** (bukan Client Secret) ke `backend/.env`: `GOOGLE_CLIENT_ID=xxxx.apps.googleusercontent.com`, lalu jalankan ulang backend. Frontend mengambilnya otomatis.

Tanpa `GOOGLE_CLIENT_ID`, tombol Google disembunyikan (di mode demo tetap muncul sebagai tombol tiruan).

## Data sensor dari Google Sheet

Bila ESP32 mencatat data ke Google Sheet, backend bisa membacanya otomatis (tanpa MQTT, sensor boleh di mana saja).

1. Sheet: kolom `timestamp, temp1, humid1, tvoc1, temp2, humid2, tvoc2` (kolom 1 = Chamber 1, kolom 2 = Chamber 2; kolom lain diabaikan).
2. Bagikan Sheet: **Share > General access > Anyone with the link > Viewer** (atau File > Share > Publish to web > CSV).
3. Isi `SHEET_URL=` di `backend/.env` dengan link Sheet tersebut (link biasa dari address bar boleh), lalu jalankan ulang backend.
4. Terminal backend menampilkan `[sheet] N data baru diimpor dari Google Sheet`. Sheet dicek ulang tiap `SHEET_POLL_SEC` detik (default 60).

Baterai alat (opsional): tambahkan kolom `battery` (persen, mis. `72` atau `72%`) di Sheet, atau field `"battery": 72` pada pesan MQTT/HTTP. Nilainya tampil di bilah atas ("Baterai Alat"); di bawah 20% muncul notifikasi lonceng dan WhatsApp (sekali, lalu aktif lagi setelah baterai diisi di atas 30%).

Catatan: tekan "Tahu Sudah Keluar" pada sesi contoh dulu agar data Sheet masuk ke sesi baru. Jangan pakai MQTT dan Sheet untuk chamber yang sama sekaligus (data akan dobel).
Impor ulang dari awal: `docker exec stc-mongo mongosh smart_tofu_chamber --quiet --eval "db.importcursors.deleteMany({})"`.

## Server (VPS) dengan HTTPS

Semua berjalan di Docker: MongoDB, Mosquitto, backend, frontend, dan Caddy (HTTPS otomatis).
Aplikasi dan API memakai satu alamat: `https://DOMAIN` (frontend) dan `https://DOMAIN/api` (backend).

1. Pasang Docker di server: `curl -fsSL https://get.docker.com | sudo sh` lalu `sudo usermod -aG docker $USER` (keluar lalu masuk lagi).
2. Ambil kode: `git clone https://github.com/desidewantri/smart-tofu-chamber.git && cd smart-tofu-chamber`.
3. Buat `.env` di folder utama: `cp deploy/.env.example .env` lalu isi `DOMAIN` (tanpa https://).
4. Buat `backend/.env`: `cp backend/.env.example backend/.env`, lalu isi minimal:
   `NODE_ENV=production`, `JWT_SECRET` (hasil `openssl rand -hex 32`), `DEVICE_API_KEY` (hasil `openssl rand -hex 16`),
   serta `GOOGLE_CLIENT_ID`, `FONNTE_TOKEN`, `SHEET_URL` bila dipakai. `MONGODB_URI`, `MQTT_URL`, dan `CORS_ORIGIN` diatur otomatis oleh compose.
5. Jalankan: `docker compose -f docker-compose.prod.yml up -d --build`. Lihat log: `docker compose -f docker-compose.prod.yml logs -f backend`.
6. Google Cloud Console > Clients > Authorized JavaScript origins: tambahkan `https://DOMAIN`.
7. Buka `https://DOMAIN`, daftar akun tim. Setelah semua anggota punya akun, ubah `ALLOW_REGISTRATION=false` lalu jalankan ulang langkah 5.

Memperbarui aplikasi: `git pull` lalu ulangi langkah 5. Jangan jalankan `npm run seed` di server (menghapus data).

## Aplikasi di HP (PWA)
TOSCHA bisa dipasang di HP dan laptop seperti aplikasi, tanpa Play Store atau App Store.

- **Android (Chrome):** buka TOSCHA, ketuk menu ⋮, lalu **Instal aplikasi** atau **Tambahkan ke layar utama**.
- **iPhone (Safari):** ketuk tombol **Bagikan**, lalu **Tambah ke Layar Utama**.
- **Laptop (Chrome/Edge):** klik ikon pasang di bilah alamat, atau menu akun (kanan atas) lalu **Pasang aplikasi**.

Catatan:
- Fitur pasang dan service worker hanya aktif di **build produksi** (`npm run build` lalu `npm start`) dan hanya di **HTTPS** atau `localhost`. Saat `npm run dev`, service worker sengaja dimatikan agar tidak mengganggu pengembangan.
- Data chamber tidak disimpan di cache, jadi selalu terbaru. Bila koneksi putus, aplikasi menampilkan halaman "Tidak ada koneksi".
- File terkait: `frontend/src/app/manifest.js`, `frontend/public/sw.js`, `frontend/public/offline.html`, `frontend/public/icons/`.
- Saat mengubah `sw.js`, naikkan nilai `VERSION` di dalamnya agar HP pengguna mengambil versi baru.

## Notifikasi WhatsApp (Fonnte)
Backend memeriksa status chamber tiap 60 detik dan mengirim WhatsApp saat sesi berubah menjadi **Segera Konsumsi**, **Tidak Layak Konsumsi**, atau saat chamber **terputus**. Setiap kejadian hanya dikirim sekali per sesi.

1. Daftar di https://fonnte.com, tambah perangkat, lalu scan QR dengan nomor WA pengirim (sebaiknya nomor khusus, bukan nomor pribadi). HP itu harus tetap menyala dan terhubung internet.
2. Salin token perangkat ke `FONNTE_TOKEN` di `backend/.env`, lalu jalankan ulang backend.
3. Di aplikasi buka **Pengaturan > Notifikasi**, tambahkan nomor tujuan, aktifkan **Kirim notifikasi ke WhatsApp**, lalu tekan **Kirim pesan uji**.

Belum punya token? Isi `WA_DRY_RUN=true` di `backend/.env`: pesan tidak dikirim, hanya dicetak di terminal backend.

Catatan: Fonnte adalah gateway tidak resmi. Paket gratisnya cukup untuk demo (sekitar 1.000 pesan per bulan, dengan watermark), tetapi nomor pengirim bisa diblokir WhatsApp bila dipakai untuk spam. Untuk penggunaan jangka panjang, ganti ke WhatsApp Cloud API resmi; cukup ubah `backend/src/services/whatsappService.js`.

## Konfigurasi
- `backend/.env`: port, URL MongoDB/MQTT, `JWT_SECRET`, `DEVICE_API_KEY`, `ML_MODE`, `ML_SERVICE_URL`. Contoh di `.env.example`.
- `frontend/.env.local`: `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_USE_MOCK`. Ubah env lalu restart `npm run dev`.

## Menyambungkan ml-service (bagian teman)
1. Jalankan ml-service di port 8000 dengan endpoint `POST /predict`. Kontrak lengkap di [docs/api/README.md](docs/api/README.md).
2. Di `backend/.env`: `ML_MODE=auto` (jatuh ke mock bila gagal) atau `live`, lalu restart backend.
3. Cek `GET http://localhost:5000/api/health`. Dashboard tidak menampilkan nama model; modelnya hanya tercatat di data prediksi.

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
