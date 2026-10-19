/**
 * Isi halaman Panduan dalam dua bahasa. Setiap teks berbentuk { id, en }.
 * Catatan ilmiah: hubungan TVOC dengan jumlah bakteri pada tahu belum tervalidasi,
 * jadi materi menyebut TVOC sebagai parameter pendukung prediksi, bukan ukuran langsung bakteri.
 */

export const STEPS = [
  {
    icon: 'login',
    href: null,
    title: { id: 'Masuk ke aplikasi', en: 'Sign in to the app' },
    body: {
      id: 'Masukkan email dan kata sandi akun admin, lalu tekan Masuk. Centang "Ingat saya" agar tidak perlu masuk ulang di perangkat yang sama.',
      en: 'Enter the admin email and password, then press Sign in. Tick "Remember me" to stay signed in on the same device.',
    },
    tips: [
      { id: 'Akun demo: admin@tofu.local / admin123.', en: 'Demo account: admin@tofu.local / admin123.' },
      { id: 'Ganti bahasa Indonesia atau English lewat tombol ID | EN di pojok kanan atas.', en: 'Switch between Indonesian and English with the ID | EN button at the top right.' },
    ],
  },
  {
    icon: 'dashboard',
    href: '/dashboard',
    title: { id: 'Kenali Dasbor', en: 'Get to know the Dashboard' },
    body: {
      id: 'Dasbor menampilkan satu kartu untuk setiap chamber yang sedang menyimpan tahu. Data diperbarui otomatis setiap 10 detik.',
      en: 'The dashboard shows one card for each chamber that is storing tofu. Data refreshes automatically every 10 seconds.',
    },
    tips: [
      { id: 'Angka besar di kartu adalah hitung mundur sisa umur tahu (jam, menit, detik).', en: 'The large number on a card is the countdown of the tofu’s remaining life (hours, minutes, seconds).' },
      { id: 'Grafik menunjukkan perkiraan sisa umur simpan dari waktu ke waktu.', en: 'The chart shows the estimated remaining shelf life over time.' },
      { id: 'Tiga baris di bawahnya adalah kondisi sensor: TVOC, suhu, dan kelembapan.', en: 'The three rows below show the sensor readings: TVOC, temperature, and humidity.' },
    ],
  },
  {
    icon: 'status',
    href: '/dashboard',
    title: { id: 'Baca status berwarna', en: 'Read the colour status' },
    body: {
      id: 'Warna kartu mengikuti sisa umur simpan. Hijau berarti aman dijual, kuning berarti sebaiknya segera dijual, merah berarti tidak layak dijual.',
      en: 'The card colour follows the remaining shelf life. Green means safe to sell, yellow means sell soon, red means not fit for sale.',
    },
    tips: [
      { id: 'Layak Jual: sisa lebih dari 24 jam. Segera Jual: 8 sampai 24 jam. Tidak Layak Jual: kurang dari 8 jam.', en: 'Fit to sell: more than 24 hours left. Sell soon: 8 to 24 hours. Not fit to sell: under 8 hours.' },
      { id: 'Batas 24 dan 8 jam bisa diubah di Pengaturan → Umum → Zona Status.', en: 'The 24 and 8 hour limits can be changed in Settings → General → Status Zones.' },
    ],
  },
  {
    icon: 'chamber',
    href: '/chambers',
    title: { id: 'Kelola chamber', en: 'Manage chambers' },
    body: {
      id: 'Menu Chamber berisi daftar semua chamber beserta status koneksinya. Buka Lihat Detail untuk sesi berjalan, sensor, dan sesi terakhir.',
      en: 'The Chamber menu lists every chamber with its connection status. Open View details for the current session, sensors, and recent sessions.',
    },
    tips: [
      { id: 'Tombol Tambah Chamber membuat chamber baru; nomornya dipakai perangkat ESP32.', en: 'Add Chamber creates a new chamber; its number is used by the ESP32 device.' },
      { id: 'Chamber berstatus Terputus berarti belum ada data masuk dalam waktu tiga kali interval pembaruan.', en: 'A Disconnected chamber has sent no data for three update intervals.' },
    ],
  },
  {
    icon: 'close',
    href: '/dashboard',
    title: { id: 'Tutup sesi saat tahu keluar', en: 'Close the session when tofu leaves' },
    body: {
      id: 'Satu sesi mewakili satu kelompok tahu. Saat tahu dikeluarkan atau terjual, tekan Tahu Sudah Keluar pada kartu chamber.',
      en: 'One session represents one batch of tofu. When the tofu is taken out or sold, press Tofu Has Left on the chamber card.',
    },
    tips: [
      { id: 'Sesi baru dibuat otomatis ketika sensor mengirim data tahu berikutnya.', en: 'A new session is created automatically when the sensor sends data for the next batch.' },
      { id: 'Sesi yang ditutup pindah ke menu Riwayat.', en: 'A closed session moves to the History menu.' },
    ],
  },
  {
    icon: 'history',
    href: '/history',
    title: { id: 'Telusuri Riwayat', en: 'Browse the History' },
    body: {
      id: 'Riwayat menyimpan semua sesi. Saring berdasarkan chamber, status, atau tanggal, lalu buka Lihat Detail untuk melihat grafik prediksi dan sensor sepanjang sesi.',
      en: 'History keeps every session. Filter by chamber, status, or date, then open View details to see the prediction and sensor charts for the whole session.',
    },
    tips: [
      { id: 'Daftar diurutkan dari sesi terbaru.', en: 'The list is sorted from the newest session.' },
    ],
  },
  {
    icon: 'analysis',
    href: '/analysis',
    title: { id: 'Pakai Analisis', en: 'Use Analysis' },
    body: {
      id: 'Menu Analisis punya tiga tab: Analisis Kondisi (keadaan saat ini), Biaya dan Manfaat (perkiraan keuntungan memakai sistem), dan Analisis Musiman (pola per bulan dan musim).',
      en: 'Analysis has three tabs: Condition Analysis (the current state), Cost and Benefit (estimated gain from using the system), and Seasonal Analysis (patterns by month and season).',
    },
    tips: [
      { id: 'Pilih chamber dan periode di bagian atas untuk mengubah data yang dihitung.', en: 'Choose the chamber and period at the top to change the data being calculated.' },
      { id: 'Biaya dan manfaat bergantung pada asumsi yang Anda isi di Pengaturan.', en: 'Cost and benefit depend on the assumptions you enter in Settings.' },
    ],
  },
  {
    icon: 'settings',
    href: '/settings',
    title: { id: 'Atur sistem', en: 'Configure the system' },
    body: {
      id: 'Di Pengaturan Anda dapat mengubah interval, zona status, batas parameter sensor, notifikasi, asumsi biaya, serta nama dan kata sandi akun.',
      en: 'In Settings you can change the interval, status zones, sensor parameter limits, notifications, cost assumptions, and your account name and password.',
    },
    tips: [
      { id: 'Ikon lonceng di atas menampilkan notifikasi Segera Jual, Tidak Layak Jual, dan chamber terputus.', en: 'The bell icon at the top shows Sell soon, Not fit to sell, and disconnected chamber alerts.' },
    ],
  },
];

export const TOPICS = [
  {
    icon: 'tvoc',
    title: { id: 'Apa itu TVOC?', en: 'What is TVOC?' },
    body: [
      {
        id: 'TVOC (Total Volatile Organic Compounds) adalah jumlah keseluruhan senyawa organik yang mudah menguap di udara. Sensor AGS10 pada chamber mengukurnya dalam satuan ppb (bagian per miliar).',
        en: 'TVOC (Total Volatile Organic Compounds) is the combined amount of organic compounds that easily evaporate into the air. The AGS10 sensor in the chamber measures it in ppb (parts per billion).',
      },
      {
        id: 'Saat bahan pangan berubah kualitasnya, sebagian senyawa menguap dan dapat ikut terukur. Karena itu TVOC dijadikan salah satu masukan model prediksi umur simpan tahu.',
        en: 'When food quality changes, some compounds evaporate and may be picked up. That is why TVOC is used as one of the inputs for predicting the shelf life of tofu.',
      },
      {
        id: 'Penting: hubungan antara TVOC dan jumlah bakteri pada tahu belum terbukti secara ilmiah. TVOC di sini adalah parameter pendukung prediksi, bukan pengukuran langsung kondisi mikrobiologis tahu.',
        en: 'Important: the link between TVOC and bacteria count in tofu has not been scientifically proven. TVOC here is a supporting prediction parameter, not a direct measurement of the tofu’s microbiological condition.',
      },
    ],
  },
  {
    icon: 'ppb',
    title: { id: 'Satuan: ppb, °C, dan %', en: 'Units: ppb, °C, and %' },
    body: [
      {
        id: 'ppb berarti bagian per miliar; 1.000 ppb sama dengan 1 ppm. Suhu diukur dalam derajat Celsius (°C). Kelembapan relatif (RH) dalam persen (%), yaitu seberapa jenuh udara oleh uap air.',
        en: 'ppb means parts per billion; 1,000 ppb equals 1 ppm. Temperature is measured in degrees Celsius (°C). Relative humidity (RH) is in percent (%), showing how saturated the air is with water vapour.',
      },
    ],
  },
  {
    icon: 'temp',
    title: { id: 'Suhu dan kelembapan', en: 'Temperature and humidity' },
    body: [
      {
        id: 'Pada umumnya, semakin hangat dan lembap ruang penyimpanan, semakin cepat mutu tahu menurun. Suhu rendah memperlambat penurunan mutu.',
        en: 'In general, the warmer and more humid the storage space, the faster tofu quality drops. A low temperature slows the decline.',
      },
      {
        id: 'Sensor SHT31 mengukur suhu dan kelembapan, lalu nilainya masuk ke model prediksi bersama TVOC.',
        en: 'The SHT31 sensor measures temperature and humidity, and the values go into the prediction model together with TVOC.',
      },
    ],
  },
  {
    icon: 'clock',
    title: { id: 'Umur simpan', en: 'Shelf life' },
    body: [
      {
        id: 'Umur simpan adalah perkiraan berapa lama tahu masih layak dijual sejak masuk chamber. Aplikasi menghitungnya dari data sensor, lalu menampilkannya sebagai hitung mundur.',
        en: 'Shelf life is the estimate of how long the tofu stays fit to sell after entering the chamber. The app calculates it from sensor data and shows it as a countdown.',
      },
      {
        id: 'Angka ini perkiraan dan dapat berubah ketika kondisi sensor berubah. Bukan pengganti pemeriksaan mutu langsung.',
        en: 'This number is an estimate and can change when sensor conditions change. It does not replace a direct quality check.',
      },
    ],
  },
  {
    icon: 'session',
    title: { id: 'Sesi', en: 'Session' },
    body: [
      {
        id: 'Satu sesi sama dengan satu kelompok tahu di dalam chamber. Sesi dibuat otomatis ketika sensor pertama kali mengirim data, dan ditutup dengan tombol Tahu Sudah Keluar.',
        en: 'One session equals one batch of tofu inside the chamber. A session is created automatically when the sensor first sends data, and closed with the Tofu Has Left button.',
      },
    ],
  },
  {
    icon: 'zone',
    title: { id: 'Zona status dan zona sensor', en: 'Status zones and sensor zones' },
    body: [
      {
        id: 'Status tahu ditentukan dari sisa umur simpan: Layak Jual (lebih dari 24 jam), Segera Jual (8 sampai 24 jam), dan Tidak Layak Jual (kurang dari 8 jam).',
        en: 'Tofu status is decided by the remaining shelf life: Fit to sell (over 24 hours), Sell soon (8 to 24 hours), and Not fit to sell (under 8 hours).',
      },
      {
        id: 'Setiap sensor juga diberi label Aman, Perhatian, atau Bahaya. Batas awalnya hanya titik mulai, bukan ambang ilmiah, dan sebaiknya disesuaikan dengan data uji laboratorium.',
        en: 'Each sensor also gets a Safe, Caution, or Danger label. The starting limits are only a starting point, not scientific thresholds, and should be adjusted using laboratory test data.',
      },
    ],
  },
  {
    icon: 'chart',
    title: { id: 'Cara membaca grafik', en: 'How to read the charts' },
    body: [
      {
        id: 'Setiap grafik menuliskan variabel dan satuan pada kedua sumbunya. Pada grafik umur simpan, sumbu X adalah waktu sejak tahu masuk (jam) dan sumbu Y adalah sisa umur simpan (jam).',
        en: 'Every chart labels the variable and unit on both axes. On the shelf-life chart, the X axis is the time since the tofu entered (hours) and the Y axis is the remaining shelf life (hours).',
      },
      {
        id: 'Garis putus-putus hijau adalah Batas Segar dan kuning adalah Batas Rawan. Garis yang menurun berarti tahu makin mendekati akhir umur simpannya.',
        en: 'The dashed green line is the Fresh Limit and the yellow one is the Risk Limit. A falling line means the tofu is getting closer to the end of its shelf life.',
      },
    ],
  },
  {
    icon: 'limits',
    title: { id: 'Batasan yang perlu diketahui', en: 'Limits to keep in mind' },
    body: [
      {
        id: 'Prediksi adalah perkiraan, bukan jaminan mutu. Analisis Biaya dan Manfaat memakai asumsi yang Anda isi sendiri, bukan hasil audit. Selama layanan prediksi belum tersambung, aplikasi memakai model tiruan sebagai pengganti sementara.',
        en: 'Predictions are estimates, not a quality guarantee. The Cost and Benefit analysis uses assumptions you enter yourself, not an audit. While the prediction service is not connected, the app uses a stand-in demo model.',
      },
    ],
  },
];

export const FAQ = [
  {
    q: { id: 'Dasbor kosong, tidak ada kartu chamber.', en: 'The dashboard is empty, no chamber cards.' },
    a: { id: 'Belum ada sesi aktif. Sesi muncul otomatis begitu sensor mengirim data pertama. Pastikan perangkat menyala dan terhubung.', en: 'There is no active session yet. A session appears automatically once the sensor sends its first data. Make sure the device is on and connected.' },
  },
  {
    q: { id: 'Chamber berstatus Terputus.', en: 'A chamber shows Disconnected.' },
    a: { id: 'Tidak ada data masuk dalam waktu tiga kali interval pembaruan. Periksa WiFi dan daya perangkat ESP32.', en: 'No data arrived within three update intervals. Check the WiFi and power of the ESP32 device.' },
  },
  {
    q: { id: 'Grafik belum muncul.', en: 'The chart does not show yet.' },
    a: { id: 'Grafik butuh minimal dua prediksi. Tunggu beberapa kali pengiriman data sensor.', en: 'A chart needs at least two predictions. Wait for a few sensor data transmissions.' },
  },
  {
    q: { id: 'Bagaimana mengganti bahasa?', en: 'How do I change the language?' },
    a: { id: 'Tekan ID atau EN di pojok kanan atas. Pilihan tersimpan di peramban ini.', en: 'Press ID or EN at the top right. Your choice is saved in this browser.' },
  },
];
