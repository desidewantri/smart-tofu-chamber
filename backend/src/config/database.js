const mongoose = require('mongoose');
const env = require('./env');

async function connectDatabase() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 5000 });
  console.log(`[db] terhubung ke MongoDB: ${mongoose.connection.host}/${mongoose.connection.name}`);
}

module.exports = { connectDatabase };
