const mongoose = require('mongoose');

const cropSchema = new mongoose.Schema(
  {
    farmer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: [true, 'Farmer reference is required'],
    },
    name: {
      type: String,
      required: [true, 'Crop name is required'],
      trim: true,
      maxlength: [100, 'Crop name too long'],
    },
    category: {
      type: String,
      enum: ['grain', 'vegetable', 'fruit', 'spice', 'oilseed', 'fiber', 'pulse', 'other'],
      default: 'other',
    },
    images: [{
      url: { type: String, required: true },
      publicId: String,
      isPrimary: { type: Boolean, default: false },
    }],
    quantity: {
      type: Number,
      required: [true, 'Quantity is required'],
      min: [1, 'Quantity must be at least 1 kg'],
    },
    quantityUnit: {
      type: String,
      enum: ['kg', 'quintal', 'ton'],
      default: 'kg',
    },
    availableQuantity: {
      type: Number,
    },
    pricePerKg: {
      type: Number,
      required: [true, 'Price per kg is required'],
      min: [0.01, 'Price must be positive'],
    },
    minimumOrder: {
      type: Number,
      default: 100, // kg
    },
    quality: {
      type: String,
      enum: ['A', 'B', 'C'],
      required: [true, 'Quality grade is required'],
    },
    qualityDetails: {
      moisture: Number,      // %
      protein: Number,       // %
      foreignMatter: Number, // %
      description: String,
    },
    aiQualityScore: {
      grade: String,
      confidence: Number,
      analyzedAt: Date,
    },
    harvestDate: {
      type: Date,
      required: [true, 'Harvest date is required'],
    },
    expiryDate: Date,
    description: {
      type: String,
      maxlength: [1000, 'Description too long'],
    },
    // Location (GeoJSON)
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true,
      },
      address: String,
      city: String,
      state: String,
      pincode: String,
    },
    // Delivery
    deliveryAvailable: {
      type: Boolean,
      default: false,
    },
    deliveryRadius: {
      type: Number,
      default: 50, // km
    },
    deliveryCharge: {
      type: Number,
      default: 0,
    },
    // Status
    status: {
      type: String,
      enum: ['active', 'sold', 'expired', 'draft', 'suspended'],
      default: 'active',
    },
    isAvailable: {
      type: Boolean,
      default: true,
    },
    // AI Price Recommendation
    aiRecommendedPrice: {
      price: Number,
      confidence: String,
      generatedAt: Date,
    },
    // Stats
    viewCount: { type: Number, default: 0 },
    offerCount: { type: Number, default: 0 },
    inquiryCount: { type: Number, default: 0 },
    // Tags for search
    tags: [String],
    // Certifications
    certifications: [{
      name: String,
      issuedBy: String,
      validUntil: Date,
      documentUrl: String,
    }],
    // Boost/Featured
    isFeatured: { type: Boolean, default: false },
    featuredUntil: Date,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
cropSchema.index({ "location.coordinates": "2dsphere" });
cropSchema.index({ farmer: 1, status: 1 });
cropSchema.index({ name: 'text', description: 'text', tags: 'text' });
cropSchema.index({ pricePerKg: 1 });
cropSchema.index({ quality: 1 });
cropSchema.index({ status: 1, isAvailable: 1 });
cropSchema.index({ createdAt: -1 });
cropSchema.index({ category: 1 });

// Pre-save: set availableQuantity
cropSchema.pre('save', function (next) {
  if (this.isNew) {
    this.availableQuantity = this.quantity;
  }
  next();
});

// Virtual: primary image
cropSchema.virtual('primaryImage').get(function () {
  if (!this.images?.length) return null;
  return this.images.find((img) => img.isPrimary)?.url || this.images[0]?.url;
});

// Virtual: is expired
cropSchema.virtual('isExpired').get(function () {
  if (!this.expiryDate) return false;
  return new Date() > this.expiryDate;
});

module.exports = mongoose.model('Crop', cropSchema);
