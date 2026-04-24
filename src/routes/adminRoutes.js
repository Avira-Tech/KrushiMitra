const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middlewares/auth');
const {
  getDashboard, getPendingVerifications, verifyUser,
  getAllUsers, banUser, resolveDispute, sendBroadcast,
  getActivity, getDisputes, getGeoAnalytics, getAuditLogs
} = require('../controllers/adminController');
const { getSettings, updateSetting } = require('../controllers/settingController');
const {
  upsertScheme, deleteScheme,
  upsertArticle, deleteArticle
} = require('../controllers/cmsController');

router.use(protect, restrictTo('admin'));

router.get('/dashboard', getDashboard);
router.get('/activity', getActivity);
router.get('/analytics/geo', getGeoAnalytics);
router.get('/disputes', getDisputes);
router.get('/users', getAllUsers);
router.get('/logs', getAuditLogs);
router.get('/settings', getSettings);
router.patch('/settings', updateSetting);

// CMS - Schemes
router.post('/cms/schemes', upsertScheme);
router.patch('/cms/schemes/:id', upsertScheme);
router.delete('/cms/schemes/:id', deleteScheme);

// CMS - Articles
router.post('/cms/articles', upsertArticle);
router.patch('/cms/articles/:id', upsertArticle);
router.delete('/cms/articles/:id', deleteArticle);

router.get('/verifications', getPendingVerifications);
router.patch('/users/:userId/verify', verifyUser);
router.patch('/users/:userId/ban', banUser);
router.patch('/contracts/:contractId/dispute/resolve', resolveDispute);
router.post('/broadcast', sendBroadcast);

module.exports = router;
