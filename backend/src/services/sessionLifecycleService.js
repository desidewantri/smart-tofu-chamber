const { remainingSeconds, classifyShelfLife } = require('../utils/status');

/**
 * Fields used when a chamber session is closed. Kept in one place so the
 * per-chamber close endpoint and the experiment stop endpoint cannot drift.
 */
function closeSessionFields(session, settings, endedAt = new Date()) {
  const plain = session && typeof session.toObject === 'function' ? session.toObject() : session;
  const sisa = remainingSeconds(plain, endedAt.getTime());
  return {
    status: 'selesai',
    selesai: endedAt,
    statusAkhir: sisa === null ? null : classifyShelfLife(sisa / 3600, settings.zones),
    sisaAkhirJam: sisa === null ? null : Math.round((sisa / 3600) * 100) / 100,
  };
}

/** Close all still-active sessions for one experiment with a shared timestamp. */
async function closeExperimentSessions({ sessions, SessionModel, settings, endedAt }) {
  const errors = [];
  for (const session of sessions || []) {
    if (session.status !== 'aktif') continue;
    const fields = closeSessionFields(session, settings, endedAt);
    try {
      await SessionModel.findByIdAndUpdate(session._id, { $set: fields }, { new: true });
    } catch (err) {
      errors.push({
        sessionId: String(session._id),
        chamberId: session.chamberId,
        code: 'SESSION_CLOSURE_FAILED',
      });
      console.error(
        `[experiment] gagal menutup sesi chamber ${session.chamberId}: ${err.message}`
      );
    }
  }
  return errors;
}

module.exports = { closeSessionFields, closeExperimentSessions };
