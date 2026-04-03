// const User = require('../models/User');
// const OTP = require('../models/OTP');
// const jwt = require('jsonwebtoken');
// const logger = require('../utils/logger');
// const { sendOTP } = require('../config/sms');
// const mongoose = require('mongoose');

// // ─── Helper: Check Database Connection ────────────────────────────────
// const checkDatabaseConnection = async () => {
//   try {
//     if (mongoose.connection.readyState !== 1) {
//       throw new Error('Database connection not established');
//     }
//     return true;
//   } catch (error) {
//     logger.error('❌ Database connection check failed:', error.message);
//     throw error;
//   }
// };

// // ─── Helper: Generate JWT Token ────────────────────────────────────────
// const generateToken = (userId, phone, role) => {
//   return jwt.sign(
//     {
//       id: userId,
//       phone,
//       role,
//     },
//     process.env.JWT_SECRET || 'your-secret-key',
//     { expiresIn: process.env.JWT_EXPIRE || '7d' }
//   );
// };

// // ─── Send OTP ──────────────────────────────────────────────────────────
// /**
//  * POST /api/v1/auth/send-otp
//  */
// const sendOtp = async (req, res) => {
//   try {
//     // Check database connection
//     await checkDatabaseConnection();

//     const { phone } = req.body;

//     if (!phone) {
//       return res.status(400).json({
//         success: false,
//         message: 'Phone is required',
//       });
//     }

//     // Validate phone format (10 digits)
//     const cleanPhone = phone.toString().replace(/^\+?91|^0/, '').slice(-10);
//     if (cleanPhone.length !== 10 || !/^\d+$/.test(cleanPhone)) {
//       return res.status(400).json({
//         success: false,
//         message: 'Invalid phone number format',
//       });
//     }

//     // Generate 6-digit OTP
//     const otp = Math.floor(100000 + Math.random() * 900000).toString();
//     const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

//     logger.info(`📱 Sending OTP to ${cleanPhone}`);

//     // Save OTP to database\n    await OTP.findOneAndUpdate(\n      { phone: cleanPhone },\n      {\n        phone: cleanPhone,\n        otp,\n        expiresAt,\n        attempts: 0,\n      },\n      { upsert: true, new: true }\n    );\n\n    // Send actual SMS\n    const e164Phone = `+91${cleanPhone}`;\n    await sendOTP(e164Phone, otp);\n\n    return res.status(200).json({\n      success: true,\n      message: 'OTP sent successfully',\n      data: {\n        phone: cleanPhone,\n        expiresIn: 600, // 10 minutes\n      },\n    });\n  } catch (error) {
//     logger.error('❌ Send OTP error:', {
//       message: error.message,
//       stack: error.stack,
//       isConnectionError: error.message.includes('connection') || error.message.includes('connect'),
//     });
    
//     return res.status(503).json({
//       success: false,
//       message: error.message.includes('connection') 
//         ? 'Database connection error. Please try again later.' 
//         : error.message || 'Failed to send OTP',
//       error: process.env.NODE_ENV === 'development' ? error.message : undefined,
//     });
//   }
// }

// // ─── Verify OTP ────────────────────────────────────────────────────────
// /**
//  * POST /api/v1/auth/verify-otp
//  */
// const verifyOtp = async (req, res) => {
//   try {
//     // Check database connection
//     await checkDatabaseConnection();

//     const { phone, otp } = req.body;

//     if (!phone || !otp) {
//       return res.status(400).json({
//         success: false,
//         message: 'Phone and OTP are required',
//       });
//     }

//     // Clean phone number
//     const cleanPhone = phone.toString().replace(/^\+?91|^0/, '').slice(-10);

//     logger.info(`🔐 Verifying OTP for ${cleanPhone}`);

//     // Find OTP record
//     const otpRecord = await OTP.findOne({ phone: cleanPhone });

//     if (!otpRecord) {
//       return res.status(401).json({
//         success: false,
//         message: 'No OTP found. Please request a new OTP.',
//       });
//     }

//     // Check if OTP expired
//     if (new Date() > otpRecord.expiresAt) {
//       logger.warn(`⏰ OTP expired for ${cleanPhone}`);
//       await OTP.deleteOne({ phone: cleanPhone });
//       return res.status(401).json({
//         success: false,
//         message: 'OTP expired. Please request a new OTP.',
//       });
//     }

//     // Check if OTP matches
//     if (otpRecord.otp !== otp.toString()) {
//       otpRecord.attempts += 1;

//       // Lock after 3 failed attempts
//       if (otpRecord.attempts >= 3) {
//         logger.warn(`🔒 Too many OTP attempts for ${cleanPhone}`);
//         await OTP.deleteOne({ phone: cleanPhone });
//         return res.status(401).json({
//           success: false,
//           message: 'Too many failed attempts. Please request a new OTP.',
//         });
//       }

//       await otpRecord.save();
//       return res.status(401).json({
//         success: false,
//         message: 'Invalid OTP. Please try again.',
//       });
//     }

//     // OTP verified successfully
//     logger.info(`✅ OTP verified for ${cleanPhone}`);

//     // Check if user exists
//     let user = await User.findOne({ phone: cleanPhone });

//     if (!user) {
//       // Create new user
//       user = new User({
//         phone: cleanPhone,
//         role: 'farmer',
//         name: `User ${cleanPhone}`,
//         state: '',
//         district: '',
//         isVerified: false,
//       });
//       await user.save();
//       logger.info(`✅ New user created: ${user._id}`);
//     } else {
//       logger.info(`✅ Existing user: ${user._id}`);
//     }

//     // Generate JWT token
//     const token = generateToken(user._id, user.phone, user.role);

//     // Delete OTP after successful verification
//     await OTP.deleteOne({ phone: cleanPhone });

//     return res.status(200).json({
//       success: true,
//       message: 'OTP verified successfully',
//       data: {
//         token,
//         user: {
//           _id: user._id,
//           name: user.name,
//           phone: user.phone,
//           role: user.role,
//           avatar: user.avatar || null,
//           isVerified: user.isVerified,
//         },
//       },
//     });
//   } catch (error) {
//     logger.error('❌ Verify OTP error:', {
//       message: error.message,
//       stack: error.stack,
//       isConnectionError: error.message.includes('connection') || error.message.includes('connect'),
//     });
    
//     return res.status(503).json({
//       success: false,
//       message: error.message.includes('connection') 
//         ? 'Database connection error. Please try again later.' 
//         : error.message || 'Failed to verify OTP',
//       error: process.env.NODE_ENV === 'development' ? error.message : undefined,
//     });
//   }
// };

// // ─── Register (Optional - for additional info) ──────────────────────────
// /**
//  * POST /api/v1/auth/register
//  */
// const register = async (req, res) => {
//   try {
//     // Check database connection
//     await checkDatabaseConnection();

//     const { phone, name, role, state, district } = req.body;

//     if (!phone || !name) {
//       return res.status(400).json({
//         success: false,
//         message: 'Phone and name are required',
//       });
//     }

//     const cleanPhone = phone.toString().replace(/^\+?91|^0/, '').slice(-10);

//     let user = await User.findOne({ phone: cleanPhone });

//     if (user) {
//       return res.status(400).json({
//         success: false,
//         message: 'User already exists',
//       });
//     }

//     user = new User({
//       phone: cleanPhone,
//       name,
//       role: role || 'farmer',
//       state: state || '',
//       district: district || '',
//       isVerified: false,
//     });

//     await user.save();
//     logger.info(`✅ User registered: ${user._id}`);

//     const token = generateToken(user._id, user.phone, user.role);

//     return res.status(201).json({
//       success: true,
//       message: 'User registered successfully',
//       data: {
//         token,
//         user: {
//           _id: user._id,
//           name: user.name,
//           phone: user.phone,
//           role: user.role,
//           state: user.state,
//           district: user.district,
//           isVerified: user.isVerified,
//         },
//       },
//     });
//   } catch (error) {
//     logger.error('❌ Register error:', {
//       message: error.message,
//       stack: error.stack,
//       isConnectionError: error.message.includes('connection') || error.message.includes('connect'),
//     });
    
//     return res.status(503).json({
//       success: false,
//       message: error.message.includes('connection') 
//         ? 'Database connection error. Please check your connection and try again.' 
//         : error.message || 'Registration failed',
//       error: process.env.NODE_ENV === 'development' ? error.message : undefined,
//     });
//   }
// };

// // ─── Google Auth ───────────────────────────────────────────────────────
// /**
//  * POST /api/v1/auth/google
//  */
// const googleAuth = async (req, res) => {
//   try {
//     const { idToken } = req.body;

//     if (!idToken) {
//       return res.status(400).json({
//         success: false,
//         message: 'ID token is required',
//       });
//     }

//     // TODO: Verify Google ID token
//     logger.info('🔐 Google auth not fully implemented');

//     return res.status(501).json({
//       success: false,
//       message: 'Google authentication not yet implemented',
//     });
//   } catch (error) {
//     logger.error('❌ Google auth error:', error);
//     return res.status(500).json({
//       success: false,
//       message: error.message || 'Google authentication failed',
//     });
//   }
// };

// // ─── Refresh Token ─────────────────────────────────────────────────────
// /**
//  * POST /api/v1/auth/refresh-token
//  */
// const refreshToken = async (req, res) => {
//   try {
//     const { refreshToken: oldToken } = req.body;

//     if (!oldToken) {
//       return res.status(400).json({
//         success: false,
//         message: 'Refresh token is required',
//       });
//     }

//     // TODO: Implement refresh token logic
//     logger.info('🔄 Refresh token not fully implemented');

//     return res.status(501).json({
//       success: false,
//       message: 'Refresh token not yet implemented',
//     });
//   } catch (error) {
//     logger.error('❌ Refresh token error:', error);
//     return res.status(500).json({
//       success: false,
//       message: error.message || 'Token refresh failed',
//     });
//   }
// };

// // ─── Logout ────────────────────────────────────────────────────────────
// /**
//  * POST /api/v1/auth/logout
//  */
// const logout = async (req, res) => {
//   try {
//     logger.info(`👤 User ${req.user?.id} logged out`);

//     return res.status(200).json({
//       success: true,
//       message: 'Logged out successfully',
//     });
//   } catch (error) {
//     logger.error('❌ Logout error:', error);
//     return res.status(500).json({
//       success: false,
//       message: error.message || 'Logout failed',
//     });
//   }
// };

// // ─── Get Profile ───────────────────────────────────────────────────────
// /**
//  * GET /api/v1/auth/profile
//  */
// const getProfile = async (req, res) => {
//   try {
//     const user = await User.findById(req.user?.id).select('-password');

//     if (!user) {
//       return res.status(404).json({
//         success: false,
//         message: 'User not found',
//       });
//     }

//     return res.status(200).json({
//       success: true,
//       data: user,
//     });
//   } catch (error) {
//     logger.error('❌ Get profile error:', error);
//     return res.status(500).json({
//       success: false,
//       message: error.message || 'Failed to get profile',
//     });
//   }
// };

// // ─── Update Profile ────────────────────────────────────────────────────
// /**
//  * PUT /api/v1/auth/profile
//  */
// const updateProfile = async (req, res) => {
//   try {
//     const { name, avatar, state, district, address } = req.body;
//     const userId = req.user?.id;

//     if (!userId) {
//       return res.status(401).json({
//         success: false,
//         message: 'Unauthorized',
//       });
//     }

//     const user = await User.findByIdAndUpdate(
//       userId,
//       {
//         ...(name && { name }),
//         ...(avatar && { avatar }),
//         ...(state && { state }),
//         ...(district && { district }),
//         ...(address && { address }),
//       },
//       { new: true }
//     ).select('-password');

//     if (!user) {
//       return res.status(404).json({
//         success: false,
//         message: 'User not found',
//       });
//     }

//     logger.info(`✅ Profile updated: ${user._id}`);

//     return res.status(200).json({
//       success: true,
//       message: 'Profile updated successfully',
//       data: user,
//     });
//   } catch (error) {
//     logger.error('❌ Update profile error:', error);
//     return res.status(500).json({
//       success: false,
//       message: error.message || 'Failed to update profile',
//     });
//   }
// };

// module.exports = {
//   sendOtp,
//   verifyOtp,
//   register,
//   googleAuth,
//   refreshToken,
//   logout,
//   getProfile,
//   updateProfile,
// };


// const User = require('../models/User');
// const OTP = require('../models/OTP');
// const jwt = require('jsonwebtoken');
// const logger = require('../utils/logger');
// const { sendOTP } = require('../config/sms');
// const mongoose = require('mongoose');

// // ─── Helper: Check Database Connection ────────────────────────────────
// const checkDatabaseConnection = async () => {
//   try {
//     if (mongoose.connection.readyState !== 1) {
//       throw new Error('Database connection not established');
//     }
//     return true;
//   } catch (error) {
//     logger.error('❌ Database connection check failed:', error.message);
//     throw error;
//   }
// };

// const generateToken = (userId, phone, role) => {
//   return jwt.sign(
//     { id: userId, phone, role },
//     process.env.JWT_SECRET,
//     { expiresIn: process.env.JWT_EXPIRE || '7d' }
//   );
// };

// exports.sendOtp = async (req, res) => {
//   const { phone } = req.body;
//   const cleanPhone = phone.toString().replace(/^\+?91|^0/, '').slice(-10);
  
//   const otp = Math.floor(100000 + Math.random() * 900000).toString();
//   const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

//   await OTP.findOneAndUpdate(
//     { phone: cleanPhone },
//     { phone: cleanPhone, otp, expiresAt, attempts: 0 },
//     { upsert: true, new: true }
//   );

//   await sendOTP(`+91${cleanPhone}`, otp);
//   res.status(200).json({ success: true, message: 'OTP sent successfully' });
// };

// exports.verifyOtp = async (req, res) => {
//   const { phone, otp } = req.body;
//   const cleanPhone = phone.toString().replace(/^\+?91|^0/, '').slice(-10);

//   const otpRecord = await OTP.findOne({ phone: cleanPhone });
//   if (!otpRecord || otpRecord.otp !== otp) {
//     return res.status(401).json({ success: false, message: 'Invalid or expired OTP' });
//   }

//   let user = await User.findOne({ phone: cleanPhone });
//   if (!user) {
//     user = await User.create({
//       phone: cleanPhone,
//       role: req.body.role || 'farmer',
//       name: `User ${cleanPhone}`,
//       isVerified: false
//     });
//   }

//   const token = generateToken(user._id, user.phone, user.role);
//   await OTP.deleteOne({ phone: cleanPhone });

//   res.status(200).json({
//     success: true,
//     data: { token, user }
//   });
// };


// // ─── Helper: Generate JWT Token ────────────────────────────────────────
// // const generateToken = (userId, phone, role) => {
// //   return jwt.sign(
// //     {
// //       id: userId,
// //       phone,
// //       role,
// //     },
// //     process.env.JWT_SECRET || 'your-secret-key',
// //     { expiresIn: process.env.JWT_EXPIRE || '7d' }
// //   );
// // };

// // ─── Send OTP ──────────────────────────────────────────────────────────
// /**
//  * POST /api/v1/auth/send-otp
//  */
// // const sendOtp = async (req, res) => {
// //   try {
// //     // Check database connection
// //     await checkDatabaseConnection();

// //     const { phone } = req.body;

// //     if (!phone) {
// //       return res.status(400).json({
// //         success: false,
// //         message: 'Phone is required',
// //       });
// //     }

// //     // Validate phone format (10 digits)
// //     const cleanPhone = phone.toString().replace(/^\+?91|^0/, '').slice(-10);
// //     if (cleanPhone.length !== 10 || !/^\d+$/.test(cleanPhone)) {
// //       return res.status(400).json({
// //         success: false,
// //         message: 'Invalid phone number format',
// //       });
// //     }

// //     // Generate 6-digit OTP
// //     const otp = Math.floor(100000 + Math.random() * 900000).toString();
// //     const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

// //     logger.info(`📱 Sending OTP to ${cleanPhone}`);

// //     // Save OTP to database
// //     await OTP.findOneAndUpdate(
// //       { phone: cleanPhone },
// //       {
// //         phone: cleanPhone,
// //         otp,
// //         expiresAt,
// //         attempts: 0,
// //       },
// //       { upsert: true, new: true }
// //     );

// //     // Send actual SMS
// //     const e164Phone = `+91${cleanPhone}`;
// //     await sendOTP(e164Phone, otp);

// //     return res.status(200).json({
// //       success: true,
// //       message: 'OTP sent successfully',
// //       data: {
// //         phone: cleanPhone,
// //         expiresIn: 600, // 10 minutes
// //       },
// //     });
// //   } catch (error) {
// //     logger.error('❌ Send OTP error:', {
// //       message: error.message,
// //       stack: error.stack,
// //       isConnectionError: error.message.includes('connection') || error.message.includes('connect'),
// //     });
    
// //     return res.status(503).json({
// //       success: false,
// //       message: error.message.includes('connection') 
// //         ? 'Database connection error. Please try again later.' 
// //         : error.message || 'Failed to send OTP',
// //       error: process.env.NODE_ENV === 'development' ? error.message : undefined,
// //     });
// //   }
// // };

// // ─── Verify OTP ────────────────────────────────────────────────────────
// /**
//  * POST /api/v1/auth/verify-otp
//  */
// // const verifyOtp = async (req, res) => {
// //   try {
// //     // Check database connection
// //     await checkDatabaseConnection();

// //     const { phone, otp } = req.body;

// //     if (!phone || !otp) {
// //       return res.status(400).json({
// //         success: false,
// //         message: 'Phone and OTP are required',
// //       });
// //     }

// //     // Clean phone number
// //     const cleanPhone = phone.toString().replace(/^\+?91|^0/, '').slice(-10);

// //     logger.info(`🔐 Verifying OTP for ${cleanPhone}`);

// //     // Find OTP record
// //     const otpRecord = await OTP.findOne({ phone: cleanPhone });

// //     if (!otpRecord) {
// //       return res.status(401).json({
// //         success: false,
// //         message: 'No OTP found. Please request a new OTP.',
// //       });
// //     }

// //     // Check if OTP expired
// //     if (new Date() > otpRecord.expiresAt) {
// //       logger.warn(`⏰ OTP expired for ${cleanPhone}`);
// //       await OTP.deleteOne({ phone: cleanPhone });
// //       return res.status(401).json({
// //         success: false,
// //         message: 'OTP expired. Please request a new OTP.',
// //       });
// //     }

// //     // Check if OTP matches
// //     if (otpRecord.otp !== otp.toString()) {
// //       otpRecord.attempts += 1;

// //       // Lock after 3 failed attempts
// //       if (otpRecord.attempts >= 3) {
// //         logger.warn(`🔒 Too many OTP attempts for ${cleanPhone}`);
// //         await OTP.deleteOne({ phone: cleanPhone });
// //         return res.status(401).json({
// //           success: false,
// //           message: 'Too many failed attempts. Please request a new OTP.',
// //         });
// //       }

// //       await otpRecord.save();
// //       return res.status(401).json({
// //         success: false,
// //         message: 'Invalid OTP. Please try again.',
// //       });
// //     }

// //     // OTP verified successfully
// //     logger.info(`✅ OTP verified for ${cleanPhone}`);

// //     // Check if user exists
// //     let user = await User.findOne({ phone: cleanPhone });

// //     if (!user) {
// //       // Create new user
// //       user = new User({
// //         phone: cleanPhone,
// //         role: 'farmer',
// //         name: `User ${cleanPhone}`,
// //         state: '',
// //         district: '',
// //         isVerified: false,
// //       });
// //       await user.save();
// //       logger.info(`✅ New user created: ${user._id}`);
// //     } else {
// //       logger.info(`✅ Existing user: ${user._id}`);
// //     }

// //     // Generate JWT token
// //     const token = generateToken(user._id, user.phone, user.role);

// //     // Delete OTP after successful verification
// //     await OTP.deleteOne({ phone: cleanPhone });

// //     return res.status(200).json({
// //       success: true,
// //       message: 'OTP verified successfully',
// //       data: {
// //         token,
// //         user: {
// //           _id: user._id,
// //           name: user.name,
// //           phone: user.phone,
// //           role: user.role,
// //           avatar: user.avatar || null,
// //           isVerified: user.isVerified,
// //         },
// //       },
// //     });
// //   } catch (error) {
// //     logger.error('❌ Verify OTP error:', {
// //       message: error.message,
// //       stack: error.stack,
// //       isConnectionError: error.message.includes('connection') || error.message.includes('connect'),
// //     });
    
// //     return res.status(503).json({
// //       success: false,
// //       message: error.message.includes('connection') 
// //         ? 'Database connection error. Please try again later.' 
// //         : error.message || 'Failed to verify OTP',
// //       error: process.env.NODE_ENV === 'development' ? error.message : undefined,
// //     });
// //   }
// // };

// // ─── Register (Optional - for additional info) ──────────────────────────
// /**
//  * POST /api/v1/auth/register
//  */
// const register = async (req, res) => {
//   try {
//     // Check database connection
//     await checkDatabaseConnection();

//     const { phone, name, role, state, district } = req.body;

//     if (!phone || !name) {
//       return res.status(400).json({
//         success: false,
//         message: 'Phone and name are required',
//       });
//     }

//     const cleanPhone = phone.toString().replace(/^\+?91|^0/, '').slice(-10);

//     let user = await User.findOne({ phone: cleanPhone });

//     if (user) {
//       return res.status(400).json({
//         success: false,
//         message: 'User already exists',
//       });
//     }

//     user = new User({
//       phone: cleanPhone,
//       name,
//       role: role || 'farmer',
//       state: state || '',
//       district: district || '',
//       isVerified: false,
//     });

//     await user.save();
//     logger.info(`✅ User registered: ${user._id}`);

//     const token = generateToken(user._id, user.phone, user.role);

//     return res.status(201).json({
//       success: true,
//       message: 'User registered successfully',
//       data: {
//         token,
//         user: {
//           _id: user._id,
//           name: user.name,
//           phone: user.phone,
//           role: user.role,
//           state: user.state,
//           district: user.district,
//           isVerified: user.isVerified,
//         },
//       },
//     });
//   } catch (error) {
//     logger.error('❌ Register error:', {
//       message: error.message,
//       stack: error.stack,
//       isConnectionError: error.message.includes('connection') || error.message.includes('connect'),
//     });
    
//     return res.status(503).json({
//       success: false,
//       message: error.message.includes('connection') 
//         ? 'Database connection error. Please check your connection and try again.' 
//         : error.message || 'Registration failed',
//       error: process.env.NODE_ENV === 'development' ? error.message : undefined,
//     });
//   }
// };

// // ─── Google Auth ───────────────────────────────────────────────────────
// /**
//  * POST /api/v1/auth/google
//  */
// const googleAuth = async (req, res) => {
//   try {
//     const { idToken } = req.body;

//     if (!idToken) {
//       return res.status(400).json({
//         success: false,
//         message: 'ID token is required',
//       });
//     }

//     // TODO: Verify Google ID token
//     logger.info('🔐 Google auth not fully implemented');

//     return res.status(501).json({
//       success: false,
//       message: 'Google authentication not yet implemented',
//     });
//   } catch (error) {
//     logger.error('❌ Google auth error:', error);
//     return res.status(500).json({
//       success: false,
//       message: error.message || 'Google authentication failed',
//     });
//   }
// };

// // ─── Refresh Token ─────────────────────────────────────────────────────
// /**
//  * POST /api/v1/auth/refresh-token
//  */
// const refreshToken = async (req, res) => {
//   try {
//     const { refreshToken: oldToken } = req.body;

//     if (!oldToken) {
//       return res.status(400).json({
//         success: false,
//         message: 'Refresh token is required',
//       });
//     }

//     // TODO: Implement refresh token logic
//     logger.info('🔄 Refresh token not fully implemented');

//     return res.status(501).json({
//       success: false,
//       message: 'Refresh token not yet implemented',
//     });
//   } catch (error) {
//     logger.error('❌ Refresh token error:', error);
//     return res.status(500).json({
//       success: false,
//       message: error.message || 'Token refresh failed',
//     });
//   }
// };

// // ─── Logout ────────────────────────────────────────────────────────────
// /**
//  * POST /api/v1/auth/logout
//  */
// const logout = async (req, res) => {
//   try {
//     logger.info(`👤 User ${req.user?.id} logged out`);

//     return res.status(200).json({
//       success: true,
//       message: 'Logged out successfully',
//     });
//   } catch (error) {
//     logger.error('❌ Logout error:', error);
//     return res.status(500).json({
//       success: false,
//       message: error.message || 'Logout failed',
//     });
//   }
// };

// // ─── Get Profile ───────────────────────────────────────────────────────
// /**
//  * GET /api/v1/auth/profile
//  */
// const getProfile = async (req, res) => {
//   try {
//     const user = await User.findById(req.user?.id).select('-password');

//     if (!user) {
//       return res.status(404).json({
//         success: false,
//         message: 'User not found',
//       });
//     }

//     return res.status(200).json({
//       success: true,
//       data: user,
//     });
//   } catch (error) {
//     logger.error('❌ Get profile error:', error);
//     return res.status(500).json({
//       success: false,
//       message: error.message || 'Failed to get profile',
//     });
//   }
// };

// // ─── Update Profile ────────────────────────────────────────────────────
// /**
//  * PUT /api/v1/auth/profile
//  */
// const updateProfile = async (req, res) => {
//   try {
//     const { name, avatar, state, district, address } = req.body;
//     const userId = req.user?.id;

//     if (!userId) {
//       return res.status(401).json({
//         success: false,
//         message: 'Unauthorized',
//       });
//     }

//     const user = await User.findByIdAndUpdate(
//       userId,
//       {
//         ...(name && { name }),
//         ...(avatar && { avatar }),
//         ...(state && { state }),
//         ...(district && { district }),
//         ...(address && { address }),
//       },
//       { new: true }
//     ).select('-password');

//     if (!user) {
//       return res.status(404).json({
//         success: false,
//         message: 'User not found',
//       });
//     }

//     logger.info(`✅ Profile updated: ${user._id}`);

//     return res.status(200).json({
//       success: true,
//       message: 'Profile updated successfully',
//       data: user,
//     });
//   } catch (error) {
//     logger.error('❌ Update profile error:', error);
//     return res.status(500).json({
//       success: false,
//       message: error.message || 'Failed to update profile',
//     });
//   }
// };

// module.exports = {
//   sendOtp,
//   verifyOtp,
//   register,
//   googleAuth,
//   refreshToken,
//   logout,
//   getProfile,
//   updateProfile,
// };

'use strict';
/**
 * authController.js
 * Handles OTP-based phone authentication.
 * No email/password required — phone is the sole identity anchor.
 */

const crypto  = require('crypto');
const User    = require('../models/User');
const OTP     = require('../models/OTP');
const logger  = require('../utils/logger');
const { sendOTP }             = require('../config/sms');
const { generateTokenPair, verifyRefreshToken } = require('../utils/jwt');
const { TokenBlacklist }      = require('../models/TokenBlacklist');
const { sanitizePhone }       = require('../utils/helpers');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically secure 6-digit OTP.
 * Uses crypto.randomInt (not Math.random) — safe for authentication.
 */
const generateSecureOTP = () => crypto.randomInt(100_000, 999_999).toString();

/**
 * Hash an OTP before DB storage so a DB breach doesn't expose live codes.
 */
const hashOTP = (otp) => crypto.createHash('sha256').update(otp).digest('hex');

// ─── POST /api/v1/auth/send-otp ───────────────────────────────────────────────
const sendOtp = async (req, res) => {
  try {
    const { phone } = req.body;

    if (!phone) {
      return res.status(400).json({ success: false, message: 'Phone number is required' });
    }

    // Normalise to 10-digit local format
    const cleanPhone = sanitizePhone(phone).replace('+91', '');
    if (!/^[6-9]\d{9}$/.test(cleanPhone)) {
      return res.status(400).json({ success: false, message: 'Invalid Indian mobile number' });
    }

    const otp       = generateSecureOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Upsert OTP record — store hashed value
    await OTP.findOneAndUpdate(
      { phone: cleanPhone },
      { phone: cleanPhone, otp: hashOTP(otp), expiresAt, attempts: 0 },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Send SMS
    await sendOTP(`+91${cleanPhone}`, otp);

    logger.info(`📱 OTP dispatched → ${cleanPhone}`);

    return res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
      data: { phone: cleanPhone, expiresIn: 600 },
    });
  } catch (err) {
    logger.error('sendOtp error:', err);
    return res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'development' ? err.message : 'Failed to send OTP',
    });
  }
};

// ─── POST /api/v1/auth/verify-otp ────────────────────────────────────────────
const verifyOtp = async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({ success: false, message: 'Phone and OTP are required' });
    }

    const cleanPhone = sanitizePhone(phone).replace('+91', '');

    const otpRecord = await OTP.findOne({ phone: cleanPhone });

    if (!otpRecord) {
      return res.status(401).json({ success: false, message: 'No OTP found. Please request a new one.' });
    }

    if (new Date() > otpRecord.expiresAt) {
      await OTP.deleteOne({ phone: cleanPhone });
      return res.status(401).json({ success: false, message: 'OTP has expired. Please request a new one.' });
    }

    if (otpRecord.otp !== hashOTP(otp.toString())) {
      otpRecord.attempts += 1;
      if (otpRecord.attempts >= 5) {
        await OTP.deleteOne({ phone: cleanPhone });
        return res.status(429).json({ success: false, message: 'Too many failed attempts. Please request a new OTP.' });
      }
      await otpRecord.save();
      return res.status(401).json({
        success: false,
        message: `Invalid OTP. ${5 - otpRecord.attempts} attempts remaining.`,
      });
    }

    // OTP is valid — clean it up
    await OTP.deleteOne({ phone: cleanPhone });

    // Upsert user (create on first login)
    let user = await User.findOne({ phone: cleanPhone });
    const isNewUser = !user;

    if (isNewUser) {
      user = await User.create({
        phone: cleanPhone,
        name: `User ${cleanPhone.slice(-4)}`,  // placeholder; app prompts profile completion
        role: 'farmer',                          // default role; changed during registration step
        isPhoneVerified: true,
      });
      logger.info(`✅ New user created: ${user._id}`);
    } else {
      user.isPhoneVerified = true;
      user.metadata = user.metadata || {};
      user.metadata.lastLogin  = new Date();
      user.metadata.loginCount = (user.metadata.loginCount || 0) + 1;
      await user.save();
      logger.info(`✅ Existing user logged in: ${user._id}`);
    }

    const { accessToken, refreshToken, expiresIn } = generateTokenPair(user);

    // Persist refresh token hash on the user document
    user.refreshToken = hashOTP(refreshToken); // reuse SHA-256 helper
    await user.save();

    return res.status(200).json({
      success: true,
      message: isNewUser ? 'Account created successfully' : 'Login successful',
      data: {
        token: accessToken,          // short-lived (15 min)
        refreshToken,                // long-lived (7 days) — store in SecureStore
        expiresIn,
        isNewUser,
        user: {
          _id:        user._id,
          name:       user.name,
          phone:      user.phone,
          role:       user.role,
          avatar:     user.avatar   || null,
          isVerified: user.isVerified,
          farmerId:   user.farmerId || null,
          gstNumber:  user.gstNumber || null,
        },
      },
    });
  } catch (err) {
    logger.error('verifyOtp error:', err);
    return res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'development' ? err.message : 'Verification failed',
    });
  }
};

// ─── POST /api/v1/auth/register ──────────────────────────────────────────────
/**
 * Called AFTER successful OTP verification to complete the user profile.
 * Accepts name, role, and role-specific fields (farmerId / gstNumber etc.).
 * Does NOT require email or password.
 */
const register = async (req, res) => {
  try {
    const { phone, name, role, farmerId, govtId, companyName, gstNumber, businessAddress, email } = req.body;

    if (!phone || !name) {
      return res.status(400).json({ success: false, message: 'Phone and name are required' });
    }
    if (!['farmer', 'buyer'].includes(role)) {
      return res.status(400).json({ success: false, message: 'Role must be farmer or buyer' });
    }

    const cleanPhone = sanitizePhone(phone).replace('+91', '');

    // The user record must already exist (created during verifyOtp)
    const user = await User.findOne({ phone: cleanPhone });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Phone number not verified. Please complete OTP verification first.',
      });
    }

    // Update profile fields
    user.name = name.trim();
    user.role = role;

    if (email)           user.email           = email.toLowerCase().trim();
    if (farmerId)        user.farmerId        = farmerId.trim();
    if (govtId)          user.govtId          = govtId.trim();
    if (companyName)     user.companyName     = companyName.trim();
    if (gstNumber)       user.gstNumber       = gstNumber.trim();
    if (businessAddress) user.businessAddress = businessAddress.trim();

    await user.save();
    logger.info(`✅ Profile registered for user ${user._id} as ${role}`);

    const { accessToken, refreshToken, expiresIn } = generateTokenPair(user);
    user.refreshToken = hashOTP(refreshToken);
    await user.save();

    return res.status(201).json({
      success: true,
      message: 'Registration complete',
      data: {
        token: accessToken,
        refreshToken,
        expiresIn,
        user: {
          _id:        user._id,
          name:       user.name,
          phone:      user.phone,
          email:      user.email   || null,
          role:       user.role,
          avatar:     user.avatar  || null,
          isVerified: user.isVerified,
          farmerId:   user.farmerId  || null,
          gstNumber:  user.gstNumber || null,
        },
      },
    });
  } catch (err) {
    logger.error('register error:', err);
    if (err.code === 11000) {
      const field = Object.keys(err.keyValue)[0];
      return res.status(409).json({ success: false, message: `${field} is already in use` });
    }
    return res.status(500).json({
      success: false,
      message: process.env.NODE_ENV === 'development' ? err.message : 'Registration failed',
    });
  }
};

// ─── POST /api/v1/auth/refresh-token ─────────────────────────────────────────
const refreshToken = async (req, res) => {
  try {
    const { refreshToken: token } = req.body;
    if (!token) {
      return res.status(400).json({ success: false, message: 'Refresh token is required' });
    }

    // Verify the JWT signature
    let decoded;
    try {
      decoded = verifyRefreshToken(token);
    } catch {
      return res.status(401).json({ success: false, message: 'Invalid or expired refresh token' });
    }

    // Check blacklist
    const blacklisted = await TokenBlacklist.findOne({ token });
    if (blacklisted) {
      return res.status(401).json({ success: false, message: 'Token has been revoked' });
    }

    // Verify stored hash matches
    const user = await User.findById(decoded.id).select('+refreshToken');
    if (!user || user.refreshToken !== hashOTP(token)) {
      return res.status(401).json({ success: false, message: 'Refresh token mismatch' });
    }

    // Issue new token pair (rotation)
    const newPair = generateTokenPair(user);
    user.refreshToken = hashOTP(newPair.refreshToken);
    await user.save();

    // Blacklist the old refresh token
    await TokenBlacklist.create({
      token,
      tokenType: 'refresh',
      userId: user._id,
      reason: 'rotation',
      expiresAt: new Date(decoded.exp * 1000),
    });

    return res.status(200).json({
      success: true,
      message: 'Token refreshed',
      data: {
        token:        newPair.accessToken,
        refreshToken: newPair.refreshToken,
        expiresIn:    newPair.expiresIn,
      },
    });
  } catch (err) {
    logger.error('refreshToken error:', err);
    return res.status(500).json({ success: false, message: 'Token refresh failed' });
  }
};

// ─── POST /api/v1/auth/logout ─────────────────────────────────────────────────
const logout = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (userId) {
      await User.findByIdAndUpdate(userId, { refreshToken: null });
    }

    // Optionally blacklist the current access token
    const token = req.headers.authorization?.split(' ')[1];
    if (token && userId) {
      const { verifyAccessToken } = require('../utils/jwt');
      try {
        const decoded = verifyAccessToken(token);
        await TokenBlacklist.create({
          token,
          tokenType: 'access',
          userId,
          reason: 'logout',
          expiresAt: new Date(decoded.exp * 1000),
        });
      } catch {
        // Token already expired — no need to blacklist
      }
    }

    logger.info(`👤 User ${userId} logged out`);
    return res.status(200).json({ success: true, message: 'Logged out successfully' });
  } catch (err) {
    logger.error('logout error:', err);
    return res.status(500).json({ success: false, message: 'Logout failed' });
  }
};

// ─── GET /api/v1/auth/profile ─────────────────────────────────────────────────
const getProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    return res.status(200).json({ success: true, data: user });
  } catch (err) {
    logger.error('getProfile error:', err);
    return res.status(500).json({ success: false, message: 'Failed to fetch profile' });
  }
};

// ─── PUT /api/v1/auth/profile ─────────────────────────────────────────────────
const updateProfile = async (req, res) => {
  try {
    const { name, email, avatar, companyName, gstNumber, farmerId, businessAddress, preferences, fcmToken } = req.body;

    const allowedUpdates = {};
    if (name)            allowedUpdates.name            = name.trim();
    if (email)           allowedUpdates.email           = email.toLowerCase().trim();
    if (avatar)          allowedUpdates.avatar          = avatar;
    if (companyName)     allowedUpdates.companyName     = companyName.trim();
    if (gstNumber)       allowedUpdates.gstNumber       = gstNumber.trim();
    if (farmerId)        allowedUpdates.farmerId        = farmerId.trim();
    if (businessAddress) allowedUpdates.businessAddress = businessAddress.trim();
    if (preferences)     allowedUpdates.preferences     = preferences;
    if (fcmToken)        allowedUpdates.fcmToken        = fcmToken;

    const user = await User.findByIdAndUpdate(req.user.id, allowedUpdates, {
      new: true,
      runValidators: true,
    });

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    logger.info(`✅ Profile updated: ${user._id}`);
    return res.status(200).json({ success: true, message: 'Profile updated', data: user });
  } catch (err) {
    logger.error('updateProfile error:', err);
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Email is already in use' });
    }
    return res.status(500).json({ success: false, message: 'Profile update failed' });
  }
};

// ─── POST /api/v1/auth/google ─────────────────────────────────────────────────
const googleAuth = async (req, res) => {
  return res.status(501).json({ success: false, message: 'Google auth not yet available' });
};

module.exports = { sendOtp, verifyOtp, register, googleAuth, refreshToken, logout, getProfile, updateProfile };