const express = require('express');
const env = require('../config/env');
const mqttService = require('../services/mqttService');
const { requireAuth, requireDeviceKey } = require('../middleware/authMiddleware');

const auth = require('../controllers/authController');
const chamber = require('../controllers/chamberController');
const session = require('../controllers/sessionController');
const sensor = require('../controllers/sensorController');
const dashboard = require('../controllers/dashboardController');
const analysis = require('../controllers/analysisController');
const setting = require('../controllers/settingController');

const router = express.Router();

// ---- publik ----
router.get('/health', dashboard.health(mqttService.status, env));
router.post('/auth/login', auth.login);
router.post('/sensor', requireDeviceKey, sensor.ingest); // perangkat / simulator

// ---- butuh login ----
router.use(requireAuth);

router.get('/auth/me', auth.me);
router.put('/auth/profile', auth.updateProfile);
router.put('/auth/password', auth.changePassword);

router.get('/dashboard', dashboard.dashboard);
router.get('/notifications', dashboard.notifications);

router.get('/chambers', chamber.list);
router.post('/chambers', chamber.create);
router.get('/chambers/:id', chamber.detail);
router.put('/chambers/:id', chamber.update);
router.post('/chambers/:id/selesai', chamber.closeSession);

router.get('/sesi', session.list);
router.get('/sesi/:id', session.detail);
router.get('/sesi/:id/prediksi', session.predictions);
router.get('/sesi/:id/sensor', session.sensors);

router.get('/sensor/:chamberId', sensor.listByChamber);

router.get('/analysis/condition', analysis.condition);
router.get('/analysis/cost-benefit', analysis.costBenefit);
router.get('/analysis/seasonal', analysis.seasonal);

router.get('/settings', setting.get);
router.put('/settings', setting.update);

module.exports = router;
