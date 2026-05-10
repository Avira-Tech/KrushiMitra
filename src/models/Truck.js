const mongoose = require('mongoose');

const truckSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    plateNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    vehicleType: {
      type: String,
      required: true,
      enum: ['Mini Truck', 'Pickup', 'Large Truck', 'Trailer'],
    },
    capacityKg: {
      type: Number,
      required: true,
    },
    driverName: {
      type: String,
      trim: true,
    },
    driverPhone: {
      type: String,
      trim: true,
    },
    pricePerKm: {
      type: Number,
      default: 0,
    },
    isApproved: {
      type: Boolean,
      default: false,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ['available', 'busy', 'maintenance'],
      default: 'available',
    },
    currentLocation: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: [0, 0],
      },
    },
    documents: {
      rcUrl: String,
      permitUrl: String,
      insuranceUrl: String,
      licenseUrl: String,
    },
  },
  {
    timestamps: true,
  }
);

truckSchema.index({ currentLocation: '2dsphere' });
truckSchema.index({ owner: 1 });

module.exports = mongoose.model('Truck', truckSchema);
