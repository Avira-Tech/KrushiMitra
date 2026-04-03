// const mongoose = require('mongoose');
// const bcrypt = require('bcrypt');

// const userSchema = new mongoose.Schema(
//   {
//     // ✅ Personal Info
//     name: {
//       type: String,
//       required: true,
//       trim: true,
//       minlength: 2,
//       maxlength: 100,
//     },
//     email: {
//       type: String,
//       required: true,
//       unique: true,
//       sparse: true,
//       lowercase: true,
//       match: /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
//     },
//     phone: {
//       type: String,
//       required: true,
//       unique: true,
//       sparse: true,
//       match: /^[0-9]{10}$/,
//     },
//     password: {
//       type: String,
//       required: true,
//       minlength: 8,
//       select: false, // Don't include in queries by default
//     },
//     role: {
//       type: String,
//       enum: ['farmer', 'buyer', 'admin'],
//       required: true,
//       index: true,
//     },
//     avatar: {
//       type: String,
//       default: null,
//     },

//     // ✅ Location Info
//     location: {
//       type: {
//         type: String,
//         enum: ['Point'],
//         default: 'Point',
//       },
//       coordinates: {
//         type: [Number], // [longitude, latitude]
//         default: [0, 0],
//       },
//       address: String,
//       state: String,
//       city: String,
//       pincode: String,
//     },

//     // ✅ Verification
//     isVerified: {
//       type: Boolean,
//       default: false,
//     },
//     isPhoneVerified: {
//       type: Boolean,
//       default: false,
//     },

//     // ✅ Rating
//     rating: {
//       average: {
//         type: Number,
//         default: 0,
//         min: 0,
//         max: 5,
//       },
//       count: {
//         type: Number,
//         default: 0,
//       },
//     },

//     // ✅ Account Status
//     status: {
//       type: String,
//       enum: ['active', 'inactive', 'suspended', 'banned'],
//       default: 'active',
//       index: true,
//     },

//     // ✅ Preferences
//     preferences: {
//       notifications: {
//         type: Boolean,
//         default: true,
//       },
//       emailNotifications: {
//         type: Boolean,
//         default: false,
//       },
//       pushNotifications: {
//         type: Boolean,
//         default: true,
//       },
//     },

//     // ✅ Metadata
//     metadata: {
//       lastLogin: Date,
//       loginCount: {
//         type: Number,
//         default: 0,
//       },
//       deviceTokens: [String],
//       ipAddresses: [String],
//     },

//     // ✅ KYC (Know Your Customer)
//     kyc: {
//       status: {
//         type: String,
//         enum: ['pending', 'verified', 'rejected'],
//         default: 'pending',
//       },
//       submittedAt: Date,
//       verifiedAt: Date,
//       rejectionReason: String,
//       documents: [
//         {
//           type: {
//             type: String,
//             enum: ['aadhar', 'pan', 'driving_license', 'passport'],
//           },
//           url: String,
//           uploadedAt: Date,
//         },
//       ],
//     },
//   },
//   {
//     timestamps: true,
//   }
// );

// // ─── Define indexes (✅ ONCE, not duplicate) ──────────────────────────────
// userSchema.index({ email: 1 }, { unique: true, sparse: true });
// userSchema.index({ phone: 1 }, { unique: true, sparse: true });
// userSchema.index({ role: 1 });
// userSchema.index({ status: 1 });
// userSchema.index({ 'location.coordinates': '2dsphere' }); // Geospatial queries
// userSchema.index({ createdAt: -1 });

// // ─── Middleware ────────────────────────────────────────────────────────────

// // Hash password before saving
// userSchema.pre('save', async function (next) {
//   if (!this.isModified('password')) return next();

//   try {
//     const salt = await bcrypt.genSalt(10);
//     this.password = await bcrypt.hash(this.password, salt);
//     next();
//   } catch (error) {
//     next(error);
//   }
// });

// // ─── Methods ───────────────────────────────────────────────────────────────

// /**
//  * Compare password
//  */
// userSchema.methods.matchPassword = async function (enteredPassword) {
//   return await bcrypt.compare(enteredPassword, this.password);
// };

// /**
//  * Get user JSON (without password)
//  */
// userSchema.methods.toJSON = function () {
//   const obj = this.toObject();
//   delete obj.password;
//   return obj;
// };

// module.exports = mongoose.model('User', userSchema);

'use strict';
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema(
  {
    // ─── Core Identity (phone is the primary identifier for OTP auth) ───────
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [100, 'Name cannot exceed 100 characters'],
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      unique: true,
      sparse: true,
      trim: true,
      match: [/^[6-9]\d{9}$/, 'Please provide a valid 10-digit Indian mobile number'],
    },
    // ─── Optional fields — not required for OTP-only registration ────────────
    email: {
      type: String,
      unique: true,
      sparse: true,          // sparse = unique index ignores null/undefined
      lowercase: true,
      trim: true,
      match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Invalid email format'],
      default: undefined,    // must be explicitly undefined so sparse index works
    },
    // Password is optional — OTP auth does not use it. Only set if the user
    // explicitly enables password login in the future.
    password: {
      type: String,
      minlength: [8, 'Password must be at least 8 characters'],
      select: false,         // never returned in queries unless explicitly projected
      default: undefined,
    },

    // ─── Role ────────────────────────────────────────────────────────────────
    role: {
      type: String,
      enum: ['farmer', 'buyer', 'admin'],
      required: [true, 'Role is required'],
      index: true,
    },

    // ─── Profile ─────────────────────────────────────────────────────────────
    avatar: { type: String, default: null },

    // Farmer-specific
    farmerId: { type: String, trim: true },
    govtId:   { type: String, trim: true },

    // Buyer-specific
    companyName:     { type: String, trim: true },
    gstNumber:       { type: String, trim: true },
    businessAddress: { type: String, trim: true },

    // ─── Location (GeoJSON) ──────────────────────────────────────────────────
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: [0, 0],
      },
      address: { type: String, trim: true },
      state:   { type: String, trim: true },
      city:    { type: String, trim: true },
      pincode: { type: String, trim: true },
    },

    // ─── Verification ────────────────────────────────────────────────────────
    isPhoneVerified: { type: Boolean, default: false },
    isVerified:      { type: Boolean, default: false },  // admin-verified KYC
    verificationStatus: {
      type: String,
      enum: ['pending', 'under_review', 'approved', 'rejected'],
      default: 'pending',
    },
    verificationNote: { type: String },
    verifiedAt:       { type: Date },
    verifiedBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // ─── Account Status ───────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['active', 'inactive', 'suspended', 'banned'],
      default: 'active',
      index: true,
    },
    isBanned:  { type: Boolean, default: false },
    banReason: { type: String },
    isActive:  { type: Boolean, default: true },

    // ─── Rating (updated by reviewService) ───────────────────────────────────
    rating: {
      average: { type: Number, default: 0, min: 0, max: 5 },
      count:   { type: Number, default: 0 },
      total:   { type: Number, default: 0 },
    },

    // ─── FCM Push Token ───────────────────────────────────────────────────────
    fcmToken: { type: String, select: false },

    // ─── Auth tokens ──────────────────────────────────────────────────────────
    refreshToken: { type: String, select: false },

    // ─── Preferences ──────────────────────────────────────────────────────────
    preferences: {
      language:           { type: String, enum: ['en', 'hi', 'gu'], default: 'en' },
      notifications:      { type: Boolean, default: true },
      emailNotifications: { type: Boolean, default: false },
      pushNotifications:  { type: Boolean, default: true },
    },

    // ─── Metadata ─────────────────────────────────────────────────────────────
    metadata: {
      lastLogin:   { type: Date },
      loginCount:  { type: Number, default: 0 },
      ipAddresses: [String],
    },
  },
  {
    timestamps: true,
    toJSON:   { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ─── Indexes ──────────────────────────────────────────────────────────────────
userSchema.index({ phone: 1 },                    { unique: true, sparse: true });
userSchema.index({ email: 1 },                    { unique: true, sparse: true });
userSchema.index({ role: 1 });
userSchema.index({ status: 1 });
userSchema.index({ isVerified: 1 });
userSchema.index({ verificationStatus: 1 });
userSchema.index({ 'location.coordinates': '2dsphere' });
userSchema.index({ createdAt: -1 });

// ─── Pre-save: hash password only when it is set and modified ─────────────────
userSchema.pre('save', async function (next) {
  if (!this.password || !this.isModified('password')) return next();
  try {
    const salt    = await bcrypt.genSalt(12);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (err) {
    next(err);
  }
});

// ─── Instance methods ─────────────────────────────────────────────────────────
userSchema.methods.matchPassword = async function (enteredPassword) {
  if (!this.password) return false;
  return bcrypt.compare(enteredPassword, this.password);
};

/**
 * Update rolling rating average atomically.
 * Call this from reviewService after creating a review.
 */
userSchema.methods.updateRating = function (newRating) {
  const current = this.rating;
  current.total   = (current.total || 0) + newRating;
  current.count   = (current.count || 0) + 1;
  current.average = parseFloat((current.total / current.count).toFixed(2));
};

// Strip sensitive fields from JSON output
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.refreshToken;
  delete obj.fcmToken;
  return obj;
};

// ─── Virtual: full address string ─────────────────────────────────────────────
userSchema.virtual('fullAddress').get(function () {
  const l = this.location;
  return [l?.address, l?.city, l?.state, l?.pincode].filter(Boolean).join(', ');
});

module.exports = mongoose.model('User', userSchema);