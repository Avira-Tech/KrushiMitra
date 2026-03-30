const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth');
const { authLimiter, otpLimiter } = require('../middlewares/rateLimiter');
const { validate } = require('../middlewares/validate');
const {
  sendOtpSchema, verifyOtpSchema, registerSchema,
  googleAuthSchema, refreshTokenSchema, updateProfileSchema,
} = require('../validators/authValidators');
const {
  sendOtp, verifyOtp, register, googleAuth,
  refreshToken, logout, getProfile, updateProfile,
} = require('../controllers/authController');

// Public routes
router.post('/send-otp', otpLimiter, validate(sendOtpSchema), sendOtp);
router.post('/verify-otp', otpLimiter, validate(verifyOtpSchema), verifyOtp);
router.post('/register', otpLimiter, validate(registerSchema), register);
router.post('/google', authLimiter, validate(googleAuthSchema), googleAuth);
router.post('/refresh-token', validate(refreshTokenSchema), refreshToken);

// Protected routes
router.use(protect);
router.post('/logout', logout);
router.get('/profile', getProfile);
router.put('/profile', validate(updateProfileSchema), updateProfile);

module.exports = router;
