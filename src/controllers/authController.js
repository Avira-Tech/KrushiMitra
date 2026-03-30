const User = require('../models/User');
const { generateTokenPair, verifyRefreshToken } = require('../utils/jwt');
const { sendOTP } = require('../config/sms');
const { generateOTP, sanitizePhone, isValidIndianPhone, hashString } = require('../utils/helpers');
const { sendSuccess, sendCreated, sendError, sendUnauthorized, sendValidationError } = require('../utils/apiResponse');
const NotificationService = require('../services/notificationService');
const logger = require('../utils/logger');

// ─── SEND OTP ───────────────────────────────────────────────────────────────────────────
const sendOtp = async (req, res) => {
  const { phone, role } = req.body;
  const normalizedPhone = sanitizePhone(phone);

  if (!isValidIndianPhone(phone)) {
    return sendValidationError(res, [{ field: 'phone', message: 'Enter a valid 10-digit Indian mobile number' }]);
  }

  // Check if user exists for login flow
  let user = await User.findOne({ phone: normalizedPhone }).select('+otp');
  const isNewUser = !user;

  // Rate limiting: max 3 OTPs per 10 minutes
  if (user?.otp?.attempts >= 3 && user.otp.expiresAt > new Date()) {
    return sendError(res, { message: 'Too many OTP attempts. Please wait 10 minutes.', statusCode: 429 });
  }

  const otp = generateOTP();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes (temp)

  if (user) {
    await User.findByIdAndUpdate(user._id, {
      'otp.code': hashString(otp),
      'otp.expiresAt': expiresAt,
      'otp.attempts': (user.otp?.attempts || 0) + 1,
    });
  } else {
    // Store OTP temporarily for new user registration
    await User.findOneAndUpdate(
      { phone: normalizedPhone },
      { $set: { phone: normalizedPhone, role: role || 'farmer', 'otp.code': hashString(otp), 'otp.expiresAt': expiresAt, 'otp.attempts': 1 } },
      { upsert: true, new: true }
    );
  }

  // Send OTP via Twilio
  await sendOTP(normalizedPhone, otp);

  logger.info(`OTP sent to ${normalizedPhone} (${isNewUser ? 'new user' : 'existing user'})`);

  return sendSuccess(res, {
    message: `OTP sent to ${normalizedPhone}`,
    data: {
      phone: normalizedPhone,
      isNewUser,
      expiresIn: 300, // 5 minutes seconds (temp)

    },
  });
};

// ─── VERIFY OTP / LOGIN ─────────────────────────────────────────────────────────────
const verifyOtp = async (req, res) => {
  const { phone, otp, role } = req.body;
  const normalizedPhone = sanitizePhone(phone);

  const user = await User.findOne({ phone: normalizedPhone }).select('+otp +refreshToken');

  if (!user) {
    return sendUnauthorized(res, 'Phone number not found. Please register first.');
  }

  // Check OTP
  if (!user.otp?.code || !user.otp?.expiresAt) {
    return sendUnauthorized(res, 'No OTP found. Please request a new OTP.');
  }

  if (new Date() > user.otp.expiresAt) {
    return sendUnauthorized(res, 'OTP expired. Please request a new one.');
  }

  const hashedOtp = hashString(otp);
  if (user.otp.code !== hashedOtp) {
    return sendUnauthorized(res, 'Invalid OTP. Please try again.');
  }

  // Clear OTP
  await User.findByIdAndUpdate(user._id, {
    $unset: { 'otp.code': 1, 'otp.expiresAt': 1 },
    $set: { 'otp.attempts': 0, lastLoginAt: new Date() },
  });

  const { accessToken, refreshToken, expiresIn } = generateTokenPair(user);

  // Store refresh token hash
  await User.findByIdAndUpdate(user._id, { refreshToken: hashString(refreshToken) });

  logger.info(`User logged in: ${user._id} (${user.role})`);

  return sendSuccess(res, {
    message: 'Login successful',
    data: {
      user: user.toSafeObject(),
      accessToken,
      refreshToken,
      expiresIn,
      isNewUser: !user.name,
    },
  });
};

// ─── REGISTER ─────────────────────────────────────────────────────────────────────────────
const register = async (req, res) => {
  const { name, phone, email, role, farmerId, governmentId, companyName, gstNumber, businessAddress, location, language, otp } = req.body;
  const normalizedPhone = sanitizePhone(phone);

  // Verify OTP first
  const tempUser = await User.findOne({ phone: normalizedPhone }).select('+otp');
  if (!tempUser?.otp?.code) {
    return sendUnauthorized(res, 'Please verify your phone number with OTP first.');
  }

  if (new Date() > tempUser.otp.expiresAt) {
    return sendUnauthorized(res, 'OTP expired. Please request a new one.');
  }

  if (tempUser.otp.code !== hashString(otp)) {
    return sendUnauthorized(res, 'Invalid OTP.');
  }

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
    updateData.governmentId = governmentId;
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

  const user = await User.findByIdAndUpdate(tempUser._id, updateData, { new: true, runValidators: true });

  const { accessToken, refreshToken } = generateTokenPair(user);
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
    ).catch(() => {});
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

    let user = await User.findOne({ $or: [{ googleId }, { email: email?.toLowerCase() }] });

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
  try {
    const decoded = verifyRefreshToken(token);
    const user = await User.findById(decoded.id).select('+refreshToken');
    if (!user) return sendUnauthorized(res, 'User not found');
    if (user.refreshToken !== hashString(token)) return sendUnauthorized(res, 'Invalid refresh token');

    const { accessToken, refreshToken: newRefreshToken } = generateTokenPair(user);
    await User.findByIdAndUpdate(user._id, { refreshToken: hashString(newRefreshToken) });

    return sendSuccess(res, {
      message: 'Token refreshed',
      data: { accessToken, refreshToken: newRefreshToken },
    });
  } catch (err) {
    return sendUnauthorized(res, 'Invalid or expired refresh token');
  }
};

// ─── LOGOUT ───────────────────────────────────────────────────────────────────────────────
const logout = async (req, res) => {
  await User.findByIdAndUpdate(req.user._id, { $unset: { refreshToken: 1 } });
  return sendSuccess(res, { message: 'Logged out successfully' });
};

// ─── GET PROFILE ─────────────────────────────────────────────────────────────────────────
const getProfile = async (req, res) => {
  const user = await User.findById(req.user._id);
  return sendSuccess(res, { data: { user: user.toSafeObject() } });
};

// ─── UPDATE PROFILE ──────────────────────────────────────────────────────────────────────
const updateProfile = async (req, res) => {
  const { name, email, language, fcmToken, location, companyName, businessAddress } = req.body;

  const updateData = {};
  if (name) updateData.name = name;
  if (email) updateData.email = email.toLowerCase();
  if (language) updateData.language = language;
  if (fcmToken) updateData.fcmToken = fcmToken;
  if (companyName) updateData.companyName = companyName;
  if (businessAddress) updateData.businessAddress = businessAddress;

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

  const user = await User.findByIdAndUpdate(req.user._id, updateData, { new: true, runValidators: true });
  return sendSuccess(res, { message: 'Profile updated', data: { user: user.toSafeObject() } });
};

module.exports = { sendOtp, verifyOtp, register, googleAuth, refreshToken, logout, getProfile, updateProfile };
