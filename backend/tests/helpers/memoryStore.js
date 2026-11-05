/**
 * In-memory stand-in for the small Mongoose surface used by ingestService,
 * experimentService, and the API tests. Behaviour that matters for correctness
 * (unique event ids, one active session per chamber, one active experiment) is
 * enforced here like the database indexes do.
 */

function createMemoryStore(shared, options = {}) {
  const state = shared || {
    readings: [],
    sessions: [],
    predictions: [],
    chambers: [],
    experiments: [],
    rslSnapshots: [],
    notificationEvents: [],
    seq: 0,
    ids: 0,
    calls: {
      createReading: 0,
      createPrediction: 0,
      sessionUpdates: 0,
      chamberSeen: 0,
      predict: 0,
      predictInputs: [],
      experimentCreates: 0,
      sessionCreates: 0,
      snapshotCreates: 0,
      notificationCreates: 0,
    },
  };
  state.rslSnapshots = state.rslSnapshots || [];
  state.notificationEvents = state.notificationEvents || [];
  const nextId = () => `id${++state.ids}`;

  // A default active experiment + two sessions keeps the existing ingestion
  // tests focused on dedup/provenance. Tests that exercise "no active
  // experiment" pass { withExperiment: false }.
  if (!shared && options.withExperiment !== false) {
    const startedAt = new Date('2026-11-04T00:00:00.000Z');
    const experiment = {
      _id: nextId(),
      label: 'Seed experiment',
      startedAt,
      endedAt: null,
      status: 'aktif',
      chamberIds: [1, 2],
    };
    state.experiments.push(experiment);
    for (const chamberId of [1, 2]) {
      state.sessions.push({
        _id: nextId(),
        seq: chamberId,
        sesiCode: `CH-${String(chamberId).padStart(3, '0')}`,
        experimentId: experiment._id,
        chamberId,
        status: 'aktif',
        masuk: null,
        tvoc_awal: null,
        suhu_awal: null,
        rh_awal: null,
        shelfLifeMulai: null,
        shelfLifeAwal: null,
        prediksiDibuat: null,
        modelUsed: null,
        readingCount: 0,
      });
    }
  }

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

  const getPath = (doc, path) =>
    String(path).split('.').reduce((value, key) => (value == null ? undefined : value[key]), doc);
  const setPath = (doc, path, value) => {
    const keys = String(path).split('.');
    let target = doc;
    for (const key of keys.slice(0, -1)) {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {};
      target = target[key];
    }
    target[keys[keys.length - 1]] = value;
  };
  const matches = (doc, filter = {}) => Object.entries(filter).every(([key, expected]) => {
    if (key === '$and') return expected.every((sub) => matches(doc, sub));
    if (key === '$or') return expected.some((sub) => matches(doc, sub));
    if (key === '$nor') return !expected.some((sub) => matches(doc, sub));
    const actual = getPath(doc, key);
    if (expected && typeof expected === 'object' && !(expected instanceof Date)) {
      if ('$exists' in expected) return expected.$exists ? actual !== undefined : actual === undefined;
      if ('$in' in expected) {
        return expected.$in.some((v) => String(actual) === String(v));
      }
      if ('$ne' in expected) return actual !== expected.$ne;
      if ('$gte' in expected && !(actual >= expected.$gte)) return false;
      if ('$lte' in expected && !(actual <= expected.$lte)) return false;
      if ('$gt' in expected && !(actual > expected.$gt)) return false;
      if ('$lt' in expected && !(actual < expected.$lt)) return false;
      return true;
    }
    return actual === expected;
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
    find(filter = {}) {
      return query((self) => {
        self._filter = filter;
        const out = pick(self, state.sessions);
        return self._limit ? out.slice(0, self._limit) : out;
      });
    },
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
      const record = {
        _id: nextId(),
        status: 'aktif',
        masuk: null,
        tvoc_awal: null,
        suhu_awal: null,
        rh_awal: null,
        shelfLifeMulai: null,
        shelfLifeAwal: null,
        prediksiDibuat: null,
        modelUsed: null,
        readingCount: 0,
        ...doc,
      };
      state.sessions.push(record);
      state.calls.sessionCreates += 1;
      return record;
    },
    async findByIdAndUpdate(id, update) {
      const doc = state.sessions.find((s) => s._id === id);
      if (!doc) return null;
      Object.assign(doc, update.$set || {});
      state.calls.sessionUpdates += 1;
      return doc;
    },
    async findOneAndUpdate(filter, update) {
      const doc = state.sessions.find((s) => matches(s, filter));
      if (!doc) return null;
      for (const [key, value] of Object.entries(update.$set || {})) setPath(doc, key, value);
      state.calls.sessionUpdates += 1;
      return doc;
    },
    async updateOne(filter, update) {
      const doc = state.sessions.find((s) => matches(s, filter));
      if (doc) for (const [key, value] of Object.entries(update.$set || {})) setPath(doc, key, value);
      return { acknowledged: true };
    },
    async findById(id) {
      return state.sessions.find((s) => s._id === id) || null;
    },
    async deleteMany(filter = {}) {
      const before = state.sessions.length;
      state.sessions = state.sessions.filter((doc) => !matches(doc, filter));
      return { deletedCount: before - state.sessions.length };
    },
  };

  const Chamber = {
    codeFor: (chamberId) => `CHAMBER-${chamberId}`,
    findOne(filter = {}) {
      return query((self) => {
        self._filter = filter;
        const [first] = pick(self, state.chambers);
        return first || null;
      });
    },
    async create(doc) {
      const record = { _id: nextId(), enabled: true, ...doc };
      state.chambers.push(record);
      return record;
    },
    async findOneAndUpdate(filter, update) {
      let doc = state.chambers.find((c) => c.chamberId === filter.chamberId);
      if (!doc) {
        doc = { _id: nextId(), chamberId: filter.chamberId, lastSeenAt: null, battery: null, batteryAt: null,
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
    find(filter = {}) {
      return query((self) => {
        self._filter = filter;
        const out = pick(self, state.chambers);
        return self._limit ? out.slice(0, self._limit) : out;
      });
    },
  };

  const Experiment = {
    async create(doc) {
      if (doc.status === 'aktif' && state.experiments.some((e) => e.status === 'aktif')) {
        const err = new Error('E11000 duplicate key: uniq_active_experiment');
        err.code = 11000;
        throw err;
      }
      const record = { _id: nextId(), status: 'aktif', chamberIds: [1, 2], ...doc };
      state.experiments.push(record);
      state.calls.experimentCreates += 1;
      return record;
    },
    find(filter = {}) {
      return query((self) => {
        self._filter = filter;
        const out = pick(self, state.experiments);
        return self._limit ? out.slice(0, self._limit) : out;
      });
    },
    findOne(filter = {}) {
      return query((self) => {
        self._filter = filter;
        const [first] = pick(self, state.experiments);
        return first || null;
      });
    },
    async findById(id) {
      return state.experiments.find((e) => e._id === id) || null;
    },
    async findByIdAndUpdate(id, update) {
      const doc = state.experiments.find((e) => e._id === id);
      if (!doc) return null;
      Object.assign(doc, update.$set || {});
      return doc;
    },
    async findOneAndUpdate(filter, update) {
      const doc = state.experiments.find((e) => matches(e, filter));
      if (!doc) return null;
      Object.assign(doc, update.$set || {});
      return doc;
    },
    async updateOne(filter, update) {
      const doc = state.experiments.find((e) => matches(e, filter));
      if (doc) Object.assign(doc, update.$set || {});
      return { acknowledged: true };
    },
    async deleteOne(filter = {}) {
      const index = state.experiments.findIndex((doc) => matches(doc, filter));
      if (index === -1) return { deletedCount: 0 };
      state.experiments.splice(index, 1);
      return { deletedCount: 1 };
    },
    async deleteMany(filter = {}) {
      const before = state.experiments.length;
      state.experiments = state.experiments.filter((doc) => !matches(doc, filter));
      return { deletedCount: before - state.experiments.length };
    },
  };

  const Prediction = {
    async create(doc) {
      const record = { _id: nextId(), ...doc };
      state.predictions.push(record);
      state.calls.createPrediction += 1;
      return record;
    },
  };

  const RslSnapshot = {
    find(filter = {}) {
      return query((self) => {
        self._filter = filter;
        const out = pick(self, state.rslSnapshots);
        return self._limit ? out.slice(0, self._limit) : out;
      });
    },
    findOne(filter = {}) {
      return query((self) => {
        self._filter = filter;
        const [first] = pick(self, state.rslSnapshots);
        return first || null;
      });
    },
    async findOneAndUpdate(filter, update) {
      let doc = state.rslSnapshots.find((s) => matches(s, filter));
      if (doc) return doc;
      if (state.rslSnapshots.some((s) =>
        String(s.experimentId) === String(filter.experimentId) && s.chamberId === filter.chamberId)) {
        const err = new Error('E11000 duplicate key: uniq_experiment_chamber_rsl_snapshot');
        err.code = 11000;
        throw err;
      }
      doc = { _id: nextId(), ...(update.$setOnInsert || {}) };
      state.rslSnapshots.push(doc);
      state.calls.snapshotCreates += 1;
      return doc;
    },
  };

  const NotificationEvent = {
    find(filter = {}) {
      return query((self) => {
        self._filter = filter;
        const out = pick(self, state.notificationEvents);
        return self._limit ? out.slice(0, self._limit) : out;
      });
    },
    findOne(filter = {}) {
      return query((self) => {
        self._filter = filter;
        const [first] = pick(self, state.notificationEvents);
        return first || null;
      });
    },
    async create(doc) {
      const duplicate = state.notificationEvents.some((e) =>
        String(e.experimentId) === String(doc.experimentId) &&
        String(e.sessionId) === String(doc.sessionId) &&
        e.chamberId === doc.chamberId && e.kind === doc.kind &&
        e.thresholdHours === doc.thresholdHours);
      if (duplicate) {
        const err = new Error('E11000 duplicate key: uniq_rsl_notification_event');
        err.code = 11000;
        throw err;
      }
      const record = { _id: nextId(), createdAt: new Date(), ...doc };
      state.notificationEvents.push(record);
      state.calls.notificationCreates += 1;
      return record;
    },
    async findOneAndUpdate(filter, update) {
      let doc = state.notificationEvents.find((e) => matches(e, filter));
      if (doc) return doc;
      doc = { _id: nextId(), createdAt: new Date(), ...(update.$setOnInsert || {}) };
      state.notificationEvents.push(doc);
      state.calls.notificationCreates += 1;
      return doc;
    },
    async updateOne(filter, update) {
      const doc = state.notificationEvents.find((e) => matches(e, filter));
      if (doc) for (const [key, value] of Object.entries(update.$set || {})) setPath(doc, key, value);
      return { acknowledged: true };
    },
  };

  const predictionService = {
    async predict(input) {
      state.calls.predict += 1;
      state.calls.predictInputs.push(input);
      return { shelfLifeJam: 32, modelUsed: 'mock' };
    },
  };

  return {
    state,
    models: { Chamber, Session, SensorReading, Prediction, Experiment, RslSnapshot, NotificationEvent },
    predictionService,
  };
}

module.exports = { createMemoryStore };
