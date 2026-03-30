const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
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
      trim: true,
      match: [/^\+?[1-9]\d{9,14}$/, 'Please enter a valid phone number'],
    },
    email: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Please enter a valid email'],
    },
    password: {
      type: String,
      minlength: [6, 'Password must be at least 6 characters'],
      select: false,
    },
    role: {
      type: String,
      enum: ['farmer', 'buyer', 'admin'],
      required: [true, 'Role is required'],
      default: 'farmer',
    },
    avatar: {
      url: String,
      publicId: String,
    },
    // Farmer-specific fields
    farmerId: {
      type: String,
      sparse: true,
      trim: true,
    },
    governmentId: {
      type: String,
      trim: true,
      select: false,
    },
    landDocuments: [{
      type: String, // Cloudinary URLs
    }],
    // Buyer-specific fields
    companyName: {
      type: String,
      trim: true,
    },
    gstNumber: {
      type: String,
      trim: true,
      match: [/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Invalid GST number format'],
    },
    businessAddress: {
      type: String,
      trim: true,
    },
    // Location
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
      address: String,
      city: String,
      state: String,
      pincode: String,
    },
    // Verification
    isVerified: {
      type: Boolean,
      default: false,
    },
    verificationStatus: {
      type: String,
      enum: ['pending', 'under_review', 'approved', 'rejected'],
      default: 'pending',
    },
    verificationNote: String,
    verifiedAt: Date,
    verifiedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    // OTP
    otp: {
      code: { type: String, select: false },
      expiresAt: { type: Date, select: false },
      attempts: { type: Number, default: 0, select: false },
    },
    // Auth
    refreshToken: {
      type: String,
      select: false,
    },
    googleId: String,
    fcmToken: String, // Firebase push notification token
    // Ratings
    rating: {
      average: { type: Number, default: 0, min: 0, max: 5 },
      count: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
    },
    // Language preference
    language: {
      type: String,
      enum: ['en', 'hi', 'gu', 'mr'],
      default: 'en',
    },
    // Account status
    isActive: {
      type: Boolean,
      default: true,
    },
    isBanned: {
      type: Boolean,
      default: false,
    },
    banReason: String,
    // Stats
    totalTransactions: { type: Number, default: 0 },
    totalRevenue: { type: Number, default: 0 },
    lastLoginAt: Date,
    lastActiveAt: Date,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
userSchema.index({ location: '2dsphere' });
userSchema.index({ phone: 1 });
userSchema.index({ email: 1 });
userSchema.index({ role: 1, isVerified: 1 });
userSchema.index({ verificationStatus: 1 });
userSchema.index({ createdAt: -1 });

// Hash password before save
userSchema.pre('save', async function (next) {
  if (!this.isModified('password') || !this.password) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// Update rating
userSchema.methods.updateRating = function (newRating) {
  this.rating.total += newRating;
  this.rating.count += 1;
  this.rating.average = parseFloat((this.rating.total / this.rating.count).toFixed(1));
};

// Virtual: full location string
userSchema.virtual('locationString').get(function () {
  if (!this.location?.city) return '';
  return [this.location.city, this.location.state].filter(Boolean).join(', ');
});

// Remove sensitive fields from JSON output
userSchema.methods.toSafeObject = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.otp;
  delete obj.refreshToken;
  delete obj.governmentId;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
