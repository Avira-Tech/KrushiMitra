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
  getBankDetails, updateBankDetails, checkAvailability,
  verifyAadhaar, verifyGST, verifyBankDetails, initiateAadhaarVerification, completeAadhaarVerification, verifyPin
} = require('../controllers/authController');
const { uploadSingle } = require('../middlewares/upload');

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Authentication and identity management
 */

// Public routes

/**
 * @swagger
 * /auth/check-user:
 *   post:
 *     summary: Check if a user exists by phone number
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phone
 *             properties:
 *               phone:
 *                 type: string
 *                 example: "9876543210"
 *     responses:
 *       200:
 *         description: User status
 */
router.post('/check-user', otpLimiter, validate(sendOtpSchema), checkUser);

router.post('/check-availability', checkLimiter, checkAvailability);

/**
 * @swagger
 * /auth/send-otp:
 *   post:
 *     summary: Send OTP to mobile number
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - phone
 *             properties:
 *               phone:
 *                 type: string
 *                 example: "9876543210"
 *     responses:
 *       200:
 *         description: OTP sent successfully
 */
router.post('/send-otp', otpLimiter, validate(sendOtpSchema), sendOtp);
router.post('/verify-otp', authLimiter, validate(verifyOtpSchema), verifyOtp);
router.post('/send-email-otp', otpLimiter, sendEmailOtp);
router.post('/verify-email-otp', authLimiter, verifyEmailOtp);
router.post('/register', authLimiter, validate(registerSchema), register);
router.post('/google', authLimiter, validate(googleAuthSchema), googleAuth);
router.post('/refresh-token', validate(refreshTokenSchema), refreshToken);

// Verification (Public for registration flow)
router.post('/verify-aadhaar/initiate', initiateAadhaarVerification);
router.post('/verify-aadhaar/complete', completeAadhaarVerification);
router.post('/verify-gst', verifyGST);

// Protected routes
router.use(protect);
router.post('/logout', logout);
router.get('/profile', getProfile);
router.put('/profile', uploadSingle('avatar'), validate(updateProfileSchema), updateProfile);

// Bank details
router.get('/bank-details', getBankDetails);
router.put('/bank-details', updateBankDetails);
/**
 * @swagger
 * /auth/verify-pin:
 *   post:
 *     summary: Verify transaction PIN with security lockout
 *     tags: [Auth]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - pin
 *             properties:
 *               pin:
 *                 type: string
 *                 example: "1234"
 *     responses:
 *       200:
 *         description: PIN verified
 *       401:
 *         description: Incorrect PIN
 *       403:
 *         description: Account blocked for 12 hours
 */
router.post('/verify-pin', protect, verifyPin);

// Other Verification
router.post('/verify-aadhaar', verifyAadhaar);
router.post('/verify-bank', verifyBankDetails);

module.exports = router;
