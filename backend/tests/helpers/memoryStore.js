/**
 * In-memory stand-in for the small Mongoose surface used by ingestService.
 * Lets the ingestion logic be tested without a MongoDB server. Behaviour that
 * matters for idempotency (unique event ids, unique active session per chamber)
 * is enforced here exactly like the database indexes do.
 */

function createMemoryStore(shared) {
  const state = shared || {
    readings: [],
    sessions: [],
    predictions: [],
    chambers: [],
    seq: 0,
    ids: 0,
    calls: { createReading: 0, createPrediction: 0, sessionUpdates: 0, chamberSeen: 0, predict: 0 },
  };
  const nextId = () => `id${++state.ids}`;

  const compare = (a, b, spec) => {
    const [[key, dir]] = Object.entries(spec);
    const av = a[key] instanceof Date ? a[key].getTime() : a[key];
    const bv = b[key] instanceof Date ? b[key].getTime() : b[key];
    if (av === bv) return 0;
    return (av < bv ? -1 : 1) * (dir < 0 ? -1 : 1);
  };

  const query = (resolve) => {
    const q = {
      _sort: null,
      _limit: null,
      _filter: null,
      sort(spec) { q._sort = spec; return q; },
      limit(n) { q._limit = n; return q; },
      select() { return q; },
      lean() { return Promise.resolve(resolve(q)); },
      then(onFulfilled, onRejected) { return Promise.resolve(resolve(q)).then(onFulfilled, onRejected); },
    };
    return q;
  };

  const matches = (doc, filter = {}) => Object.entries(filter).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      if ('$ne' in expected) return doc[key] !== expected.$ne;
      if ('$gte' in expected && !(doc[key] >= expected.$gte)) return false;
      if ('$lte' in expected && !(doc[key] <= expected.$lte)) return false;
      return true;
    }
    return doc[key] === expected;
  });

  const pick = (q, list) => {
    let out = list.filter((doc) => matches(doc, q._filter || {}));
    if (q._sort) out = out.slice().sort((a, b) => compare(a, b, q._sort));
    return out;
  };

  const SensorReading = {
    find(filter = {}) {
      const q = query((self) => {
        self._filter = filter;
        const out = pick(self, state.readings);
        return self._limit ? out.slice(0, self._limit) : out;
      });
      return q;
    },
    findOne(filter = {}) {
      return query((self) => {
        self._filter = filter;
        const [first] = pick(self, state.readings);
        return first || null;
      });
    },
    async create(doc) {
      if (doc.eventId && state.readings.some((row) => row.eventId === doc.eventId)) {
        const err = new Error('E11000 duplicate key error collection: sensorreadings eventId');
        err.code = 11000;
        throw err;
      }
      const record = { _id: nextId(), sources: doc.source ? [doc.source] : [], ...doc };
      state.readings.push(record);
      state.calls.createReading += 1;
      return record;
    },
    async countDocuments(filter = {}) {
      return state.readings.filter((doc) => matches(doc, filter)).length;
    },
    async updateOne(filter, update) {
      const doc = state.readings.find((row) => matches(row, filter));
      if (doc && update.$addToSet) {
        for (const [key, value] of Object.entries(update.$addToSet)) {
          doc[key] = doc[key] || [];
          if (!doc[key].includes(value)) doc[key].push(value);
        }
      }
      return { acknowledged: true };
    },
  };

  const Session = {
    codeFor: (seq) => `CH-${String(seq).padStart(3, '0')}`,
    findOne(filter = {}) {
      return query((self) => {
        self._filter = filter;
        const [first] = pick(self, state.sessions);
        return first || null;
      });
    },
    async create(doc) {
      if (state.sessions.some((s) => s.chamberId === doc.chamberId && s.status === 'aktif')) {
        const err = new Error('E11000 duplicate key: uniq_active_per_chamber');
        err.code = 11000;
        throw err;
      }
      const record = { _id: nextId(), status: 'aktif', ...doc };
      state.sessions.push(record);
      return record;
    },
    async findByIdAndUpdate(id, update) {
      const doc = state.sessions.find((s) => s._id === id);
      if (!doc) return null;
      Object.assign(doc, update.$set || {});
      state.calls.sessionUpdates += 1;
      return doc;
    },
    async findById(id) {
      return state.sessions.find((s) => s._id === id) || null;
    },
  };

  const Chamber = {
    codeFor: (chamberId) => `CHAMBER-${chamberId}`,
    async findOneAndUpdate(filter, update) {
      let doc = state.chambers.find((c) => c.chamberId === filter.chamberId);
      if (!doc) {
        doc = { chamberId: filter.chamberId, lastSeenAt: null, battery: null, batteryAt: null,
                ...(update.$setOnInsert || {}) };
        state.chambers.push(doc);
      }
      if (update.$max && update.$max.lastSeenAt) {
        doc.lastSeenAt = update.$max.lastSeenAt;
        state.calls.chamberSeen += 1;
      }
      return doc;
    },
    async updateOne() { return { acknowledged: true }; },
  };

  const Prediction = {
    async create(doc) {
      const record = { _id: nextId(), ...doc };
      state.predictions.push(record);
      state.calls.createPrediction += 1;
      return record;
    },
  };

  const predictionService = {
    async predict() {
      state.calls.predict += 1;
      return { shelfLifeJam: 32, modelUsed: 'mock' };
    },
  };

  return { state, models: { Chamber, Session, SensorReading, Prediction }, predictionService };
}

module.exports = { createMemoryStore };
