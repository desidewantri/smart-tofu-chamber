const env = require('./config/env');
const { connectDatabase } = require('./config/database');
const app = require('./app');
const mqttService = require('./services/mqttService');
const notifierService = require('./services/notifierService');
const SystemSetting = require('./models/SystemSetting');

async function main() {
  try {
    await connectDatabase();
  } catch (err) {
    console.error('\n[db] Gagal terhubung ke MongoDB:', err.message);
    console.error('     Pastikan MongoDB berjalan, mis. dari folder utama: docker compose up -d\n');
    process.exit(1);
  }

  await SystemSetting.get(); // pastikan dokumen pengaturan default ada
  mqttService.start();
  notifierService.start();

  const server = app.listen(env.port, () => {
    console.log(`[api] berjalan di http://localhost:${env.port}  (ML_MODE=${env.ml.mode})`);
  });

  const shutdown = async () => {
    console.log('\n[api] mematikan server...');
    notifierService.stop();
    await mqttService.stop();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
