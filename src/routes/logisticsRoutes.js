const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middlewares/auth');
const {
  registerTruck,
  getAvailableJobs,
  acceptJob,
  verifyPickup,
  verifyDelivery,
  getSuggestedTrucks,
  resendOtp
} = require('../controllers/logisticsController');

router.use(protect);

// Truck Management
router.post('/trucks', restrictTo('logistics'), registerTruck);
router.get('/my-trucks', restrictTo('logistics'), require('../controllers/logisticsController').getMyTrucks);
router.delete('/trucks/:id', restrictTo('logistics'), require('../controllers/logisticsController').deleteTruck);
router.get('/suggested', getSuggestedTrucks);

// Job Management
router.get('/jobs/available', restrictTo('logistics'), getAvailableJobs);
router.post('/jobs/accept', restrictTo('logistics'), acceptJob);

// Handover Verification
router.post('/verify-pickup', restrictTo('logistics'), verifyPickup);
router.post('/verify-delivery', restrictTo('logistics'), verifyDelivery);
router.post('/resend-otp', restrictTo('logistics'), resendOtp);

module.exports = router;
