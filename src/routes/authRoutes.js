const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth');
const { authLimiter, otpLimiter, checkLimiter } = require('../middlewares/rateLimiter');
const { validate } = require('../middlewares/validate');
const {
  sendOtpSchema, verifyOtpSchema, registerSchema,
  googleAuthSchema, refreshTokenSchema, updateProfileSchema,
} = require('../validators/authValidators');
const {
  checkUser, sendOtp, sendEmailOtp, verifyOtp, verifyEmailOtp, register, googleAuth,
  refreshToken, logout, getProfile, updateProfile,
  getBankDetails, updateBankDetails, checkAvailability
} = require('../controllers/authController');

// Public routes
router.post('/check-user', otpLimiter, validate(sendOtpSchema), checkUser);
router.post('/check-availability', checkLimiter, checkAvailability);
router.post('/send-otp', otpLimiter, validate(sendOtpSchema), sendOtp);
router.post('/verify-otp', authLimiter, validate(verifyOtpSchema), verifyOtp);
router.post('/send-email-otp', otpLimiter, sendEmailOtp);
router.post('/verify-email-otp', authLimiter, verifyEmailOtp);
router.post('/register', authLimiter, validate(registerSchema), register);
router.post('/google', authLimiter, validate(googleAuthSchema), googleAuth);
router.post('/refresh-token', validate(refreshTokenSchema), refreshToken);

// Protected routes
router.use(protect);
router.post('/logout', logout);
router.get('/profile', getProfile);
router.put('/profile', validate(updateProfileSchema), updateProfile);

// Bank details
router.get('/bank-details', getBankDetails);
router.put('/bank-details', updateBankDetails);

module.exports = router;
