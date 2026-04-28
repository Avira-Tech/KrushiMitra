const User = require('../models/User');
const { generateTokenPair, verifyRefreshToken } = require('../utils/jwt');
const { redis } = require('../config/redis');
const { sendOTP } = require('../config/sms');
const { generateOTP, sanitizePhone, isValidIndianPhone, hashString } = require('../utils/helpers');
const { sendSuccess, sendCreated, sendError, sendUnauthorized, sendValidationError } = require('../utils/apiResponse');
const NotificationService = require('../services/notificationService');
const logger = require('../utils/logger');

// ─── HELPERS ────────────────────────────────────────────────────────────────────────────

/**
 * Shared OTP verification logic with brute-force protection.
 * Returns { success, error, status, user }
 */
const verifyOtpHelper = async (phone, otp) => {
  const normalizedPhone = sanitizePhone(phone);
  const LOCKOUT_KEY = `lockout:otp:${normalizedPhone}`;
  const ATTEMPTS_KEY = `attempts:otp:${normalizedPhone}`;

  // 1. Check if account is locked in Redis (Distributed Lockout)
  const isLocked = await redis.get(LOCKOUT_KEY);
  if (isLocked) {
    const ttl = await redis.ttl(LOCKOUT_KEY);
    const remaining = Math.ceil(ttl / 60);
    return { success: false, error: `Too many failed attempts. Try again in ${remaining} minutes.`, status: 403 };
  }

  const user = await User.findOne({ phone: normalizedPhone }).select('+otp +refreshToken');
  if (!user) return { success: false, error: 'User not found', status: 401 };
  if (!user.otp?.code || !user.otp?.expiresAt) return { success: false, error: 'No active OTP. Request a new one.', status: 401 };

  // 2. Check Expiry
  if (new Date() > user.otp.expiresAt) return { success: false, error: 'OTP expired', status: 401 };

  // 3. Validate
  const hashedOtp = hashString(otp);
  if (user.otp.code !== hashedOtp) {
    const attempts = await redis.incr(ATTEMPTS_KEY);

    // Set expiry if first attempt
    if (attempts === 1) await redis.expire(ATTEMPTS_KEY, 15 * 60);

    if (attempts >= 5) {
      await redis.set(LOCKOUT_KEY, 'true', 'EX', 15 * 60);
      await redis.del(ATTEMPTS_KEY);
      logger.warn(`User ${normalizedPhone} locked out after 5 failed attempts.`);
      return { success: false, error: 'Account locked for 15 minutes due to too many failed attempts.', status: 403 };
    }

    // Also update DB for fallback/audit
    await User.findByIdAndUpdate(user._id, { 'otp.wrongAttempts': attempts });

    const remaining = 5 - attempts;
    return {
      success: false,
      error: `Invalid OTP. ${remaining} attempts remaining.`,
      status: 401
    };
  }

  // Success: Clear Redis tracking
  await redis.del(ATTEMPTS_KEY);
  await redis.del(LOCKOUT_KEY);

  return { success: true, user };
};

// ─── SEND OTP ───────────────────────────────────────────────────────────────────────────
const sendOtp = async (req, res) => {
  const { phone, role } = req.body;
  const normalizedPhone = sanitizePhone(phone);

  if (!isValidIndianPhone(normalizedPhone)) {
    return sendValidationError(res, [{ field: 'phone', message: 'Enter a valid 10-digit Indian mobile number' }]);
  }

  let user = await User.findOne({ phone: normalizedPhone }).select('+otp');
  const isNewUser = !user;

  // Rate limiting: max 5 OTPs per 20 minutes (hardened)
  if (user?.otp?.attempts >= 5 && user.otp.expiresAt > new Date(Date.now() - 20 * 60 * 1000)) {
    return sendError(res, { message: 'Too many OTP requests. Please wait 15 minutes.', statusCode: 429 });
  }

  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  const otpData = {
    'otp.code': hashString(otp),
    'otp.expiresAt': expiresAt,
    'otp.attempts': (user?.otp?.attempts || 0) + 1,
  };

  if (user) {
    await User.findByIdAndUpdate(user._id, otpData);
  } else {
    await User.findOneAndUpdate(
      { phone: normalizedPhone },
      { $set: { phone: normalizedPhone, role: role || 'farmer', ...otpData } },
      { upsert: true }
    );
  }

  await sendOTP(`+91${normalizedPhone}`, otp);
  logger.info(`OTP sent to ${normalizedPhone}`);
  console.log(otp)
  return sendSuccess(res, {
    message: `OTP sent to ${normalizedPhone}`,
    data: { phone: normalizedPhone, isNewUser, expiresIn: 300 },
  });
};

// ─── VERIFY OTP / LOGIN ─────────────────────────────────────────────────────────────
const verifyOtp = async (req, res) => {
  const { phone, otp, fcmToken } = req.body;

  const result = await verifyOtpHelper(phone, otp);
  if (!result.success) {
    return res.status(result.status).json({ success: false, error: result.error });
  }

  const user = result.user;

  // Success: Clear OTP data and reset wrong attempts
  const update = {
    $unset: { 'otp.code': 1, 'otp.expiresAt': 1, 'otp.lockedUntil': 1 },
    $set: { 'otp.attempts': 0, 'otp.wrongAttempts': 0, lastLoginAt: new Date() },
  };

  if (fcmToken) {
    update.$addToSet = { fcmTokens: fcmToken };
  }

  await User.findByIdAndUpdate(user._id, update);

  const { accessToken, refreshToken, expiresIn, csrfToken } = generateTokenPair(user);
  await User.findByIdAndUpdate(user._id, { refreshToken: hashString(refreshToken) });

  logger.info(`User logged in: ${user._id}`);

  return sendSuccess(res, {
    message: 'Login successful',
    data: {
      user: user.toSafeObject(),
      accessToken,
      refreshToken,
      csrfToken,
      expiresIn,
      isNewUser: !user.name,
    },
  });
};

// ─── REGISTER ─────────────────────────────────────────────────────────────────────────────
const register = async (req, res) => {
  const { name, phone, email, role, farmerId, aadhaarNumber, companyName, gstNumber, businessAddress, location, language, otp, fcmToken } = req.body;
  const normalizedPhone = sanitizePhone(phone);

  // Verify OTP via helper
  const result = await verifyOtpHelper(phone, otp);
  if (!result.success) {
    return res.status(result.status).json({ success: false, error: result.error });
  }

  const tempUser = result.user;

  // Check if already registered with name
  if (tempUser.name) {
    return sendError(res, { message: 'Phone number already registered. Please login.', statusCode: 409 });
  }

  // Check email uniqueness
  if (email) {
    const emailExists = await User.findOne({ email: email.toLowerCase() });
    if (emailExists) {
      return sendError(res, { message: 'Email already registered', statusCode: 409 });
    }
  }

  // Update user with registration data
  const updateData = {
    name,
    email: email?.toLowerCase(),
    role,
    language: language || 'en',
    $unset: { 'otp.code': 1, 'otp.expiresAt': 1 },
    $set: { 'otp.attempts': 0 },
  };

  if (role === 'farmer') {
    updateData.farmerId = farmerId;
    updateData.aadhaarNumber = aadhaarNumber;
  } else if (role === 'buyer') {
    updateData.companyName = companyName;
    updateData.gstNumber = gstNumber;
    updateData.businessAddress = businessAddress;
  }

  if (location) {
    updateData.location = {
      type: 'Point',
      coordinates: [parseFloat(location.lng), parseFloat(location.lat)],
      address: location.address,
      city: location.city,
      state: location.state,
      pincode: location.pincode,
    };
  }

  if (fcmToken) {
    updateData.$addToSet = { fcmTokens: fcmToken };
  }

  const user = await User.findByIdAndUpdate(tempUser._id, updateData, { new: true, runValidators: true });

  const { accessToken, refreshToken, csrfToken, expiresIn } = generateTokenPair(user);
  await User.findByIdAndUpdate(user._id, { refreshToken: hashString(refreshToken) });

  // Notify admin of new registration
  const admins = await User.find({ role: 'admin' }).select('_id');
  if (admins.length > 0) {
    NotificationService.createBulk(
      admins.map((a) => a._id),
      {
        type: 'system',
        title: '👤 New User Registration',
        body: `${name} registered as ${role}. Verification required.`,
        priority: 'normal',
      }
    ).catch(() => { });
  }

  logger.info(`New user registered: ${user._id} (${role})`);

  return sendCreated(res, {
    message: 'Registration successful! Your account is pending verification.',
    data: {
      user: user.toSafeObject(),
      accessToken,
      refreshToken,
    },
  });
};

// ─── GOOGLE AUTH ────────────────────────────────────────────────────────────────────────
const googleAuth = async (req, res) => {
  const { idToken, role } = req.body;
  try {
    // Verify Google ID token
    const { OAuth2Client } = require('google-auth-library');
    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture } = payload;

    const googleIdStr = String(googleId);
    const emailStr = String(email).toLowerCase();

    let user = await User.findOne({ $or: [{ googleId: googleIdStr }, { email: emailStr }] });

    if (!user) {
      user = await User.create({
        name,
        email: email?.toLowerCase(),
        googleId,
        role: role || 'buyer',
        avatar: { url: picture },
        isVerified: false,
        verificationStatus: 'pending',
        // Phone optional - require manual verification/add later
      });
    } else if (!user.googleId) {
      user.googleId = googleId;
      await user.save();
    }

    const { accessToken, refreshToken } = generateTokenPair(user);
    await User.findByIdAndUpdate(user._id, { refreshToken: hashString(refreshToken), lastLoginAt: new Date() });

    return sendSuccess(res, {
      message: 'Google authentication successful',
      data: { user: user.toSafeObject(), accessToken, refreshToken },
    });
  } catch (error) {
    logger.error('Google auth error:', error.message);
    return sendUnauthorized(res, 'Google authentication failed');
  }
};

// ─── REFRESH TOKEN ─────────────────────────────────────────────────────────────────────
const refreshToken = async (req, res) => {
  const { refreshToken: token } = req.body;
  if (!token) return sendUnauthorized(res, 'Refresh token required');

  try {
    const decoded = verifyRefreshToken(token);
    const user = await User.findById(decoded.id).select('+refreshToken');
    if (!user) return sendUnauthorized(res, 'User not found');

    // Token Rotation & Reuse Detection
    const hashedToken = hashString(token);
    if (user.refreshToken !== hashedToken) {
      // Detection of reuse: someone is using an old/stolen token
      logger.error(`🚨 Refresh token reuse detected for user ${user._id}. Possible token theft!`);
      // Revoke ALL access as a precaution
      await User.findByIdAndUpdate(user._id, { $unset: { refreshToken: 1 } });
      return sendUnauthorized(res, 'Security violation: please login again');
    }

    const { accessToken, refreshToken: newRefreshToken, csrfToken, expiresIn } = generateTokenPair(user);

    // Rotate: Issue new RT and invalidate old one
    await User.findByIdAndUpdate(user._id, {
      refreshToken: hashString(newRefreshToken),
      lastLoginAt: new Date()
    });

    logger.info(`Token rotated for user ${user._id}`);

    return sendSuccess(res, {
      message: 'Token refreshed',
      data: { accessToken, refreshToken: newRefreshToken, csrfToken, expiresIn },
    });
  } catch (err) {
    logger.warn(`Refresh failed: ${err.message}`);
    return sendUnauthorized(res, 'Invalid or expired refresh token');
  }
};

// ─── LOGOUT ───────────────────────────────────────────────────────────────────────────────
const logout = async (req, res) => {
  try {
    const { fcmToken } = req.body;
    const token = req.token;

    // 1. Blacklist current access token in Redis (TTL 15m matching JWT_EXPIRE)
    if (token) {
      const BLACKLIST_PREFIX = 'blacklist:token:';
      await redis.set(`${BLACKLIST_PREFIX}${token}`, 'true', 'EX', 15 * 60);
    }

    // 2. Remove refresh token from DB and FCM token if provided
    const update = { $unset: { refreshToken: 1 } };
    if (fcmToken) {
      update.$pull = { fcmTokens: fcmToken };
    }

    await User.findByIdAndUpdate(req.user._id, update);

    logger.info(`User logged out: ${req.user._id}${fcmToken ? ' (FCM token removed)' : ''}`);
    return sendSuccess(res, { message: 'Logged out successfully' });
  } catch (err) {
    logger.error('Logout error:', err.message);
    return sendError(res, { message: 'Logout failed', statusCode: 500 });
  }
};

// ─── GET PROFILE ─────────────────────────────────────────────────────────────────────────
const getProfile = async (req, res) => {
  const user = await User.findById(req.user._id);
  return sendSuccess(res, { data: { user: user.toSafeObject() } });
};

// ─── UPDATE PROFILE ──────────────────────────────────────────────────────────────────────
const updateProfile = async (req, res) => {
  const { name, email, language, fcmToken, location, companyName, businessAddress, username, avatar } = req.body;

  const updateData = {};
  const specialUpdates = {};

  if (name) updateData.name = name;
  if (email && email.toLowerCase() !== req.user.email) {
    updateData.email = email.toLowerCase();
    updateData.isVerified = false; // Mark unverified until new email is verified
    logger.info(`User ${req.user._id} changed email. Status set to unverified.`);
  }

  if (language) updateData.language = language;
  if (companyName) updateData.companyName = companyName;
  if (businessAddress) updateData.businessAddress = businessAddress;
  if (username) updateData.username = username.trim();
  if (avatar) updateData.avatar = avatar;

  if (fcmToken) {
    specialUpdates.$addToSet = { fcmTokens: fcmToken };
  }

  if (location) {
    updateData.location = {
      type: 'Point',
      coordinates: [parseFloat(location.lng), parseFloat(location.lat)],
      address: location.address,
      city: location.city,
      state: location.state,
      pincode: location.pincode,
    };
  }

  const user = await User.findByIdAndUpdate(
    req.user._id,
    { $set: updateData, ...specialUpdates },
    { new: true, runValidators: true }
  );

  return sendSuccess(res, {
    message: updateData.email ? 'Profile updated. Please verify your new email.' : 'Profile updated',
    data: { user: user.toSafeObject() }
  });
};

// ─── BANK DETAILS ────────────────────────────────────────────────────────────────────────
const getBankDetails = async (req, res) => {
  const user = await User.findById(req.user._id).select('bankDetails');
  return sendSuccess(res, { data: { bankDetails: user.bankDetails || {} } });
};

const updateBankDetails = async (req, res) => {
  const { accountNumber, bankName, ifscCode, accountHolderName, upiId } = req.body;

  // Farmers can only add bank details if approved
  if (req.user.role === 'farmer' && req.user.verificationStatus !== 'approved') {
    return sendForbidden(res, 'Bank details can only be added after account approval');
  }

  const user = await User.findByIdAndUpdate(
    req.user._id,
    {
      $set: {
        bankDetails: { accountNumber, bankName, ifscCode, accountHolderName, upiId },
      },
    },
    { new: true, runValidators: true }
  );

  return sendSuccess(res, {
    message: 'Bank details updated successfully',
    data: { bankDetails: user.bankDetails },
  });
};

module.exports = {
  sendOtp,
  verifyOtp,
  register,
  googleAuth,
  refreshToken,
  logout,
  getProfile,
  updateProfile,
  getBankDetails,
  updateBankDetails,
};
