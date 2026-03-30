const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middlewares/auth');
const {
  getDashboard, getPendingVerifications, verifyUser,
  getAllUsers, banUser, resolveDispute, sendBroadcast,
} = require('../controllers/adminController');

router.use(protect, restrictTo('admin'));

router.get('/dashboard', getDashboard);
router.get('/users', getAllUsers);
router.get('/verifications', getPendingVerifications);
router.patch('/users/:userId/verify', verifyUser);
router.patch('/users/:userId/ban', banUser);
router.patch('/contracts/:contractId/dispute/resolve', resolveDispute);
router.post('/broadcast', sendBroadcast);

module.exports = router;
