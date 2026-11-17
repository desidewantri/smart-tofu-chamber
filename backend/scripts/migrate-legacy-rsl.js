const mongoose = require('mongoose');
const env = require('../src/config/env');
const Session = require('../src/models/Session');
const Prediction = require('../src/models/Prediction');

async function run() {
  const isApply = process.argv.includes('--apply');
  const mode = isApply ? 'apply' : 'dry-run';

  await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 5000 });

  try {
    const query = {
      modelUsed: { $ne: 'v21_weibull' },
      rslDomain: { $in: [null, undefined] },
    };

    const targetSessions = await Session.find(query).select('_id').lean();
    const ids = targetSessions.map((s) => s._id);

    let predCount = 0;
    if (ids.length > 0) {
      predCount = await Prediction.countDocuments({
        sesiId: { $in: ids },
        modelUsed: { $ne: 'v21_weibull' },
      });
    }

    if (isApply && ids.length > 0) {
      await Session.updateMany(
        { _id: { $in: ids } },
        { $set: { legacy: true, rslDomain: 'LEGACY' } }
      );
      await Prediction.updateMany(
        { sesiId: { $in: ids }, modelUsed: { $ne: 'v21_weibull' } },
        { $set: { modelUsed: 'mock_legacy' } }
      );
    }

    console.log(JSON.stringify({ sessions: ids.length, predictions: predCount, mode }));
  } finally {
    await mongoose.disconnect();
  }
}

run().catch((err) => {
  console.error('[migration-error]', err);
  process.exit(1);
});
