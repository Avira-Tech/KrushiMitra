const Crop = require('../models/Crop');
const User = require('../models/User');
const { uploadToCloudinary, deleteFromCloudinary } = require('../config/cloudinary');
const NotificationService = require('../services/notificationService');
const AIService = require('../services/aiService');
const { parsePagination, buildSort } = require('../utils/helpers');
const { sendSuccess, sendCreated, sendError, sendNotFound, sendPaginated } = require('../utils/apiResponse');
const logger = require('../utils/logger');

// ─── CREATE CROP ─────────────────────────────────────────────────────────────────────────
const createCrop = async (req, res) => {
  const farmer = req.user;
  const cropData = { ...req.body, farmer: farmer._id };

  // Parse location
  if (cropData.location) {
    const loc = typeof cropData.location === 'string' ? JSON.parse(cropData.location) : cropData.location;
    cropData.location = {
      type: 'Point',
      coordinates: [parseFloat(loc.lng), parseFloat(loc.lat)],
      address: loc.address,
      city: loc.city,
      state: loc.state,
      pincode: loc.pincode,
    };
  } else if (farmer.location?.coordinates) {
    cropData.location = farmer.location;
  }

  // Handle image uploads
  if (req.files?.length > 0) {
    const uploadPromises = req.files.map((file, index) =>
      uploadToCloudinary(file.buffer, `krushimitra/crops/${farmer._id}`)
        .then((result) => ({ ...result, isPrimary: index === 0 }))
    );
    cropData.images = await Promise.all(uploadPromises);
  }

  // Get AI price recommendation
  const aiRec = await AIService.getPriceRecommendation(cropData.name, cropData.quality);
  if (aiRec.success) {
    cropData.aiRecommendedPrice = {
      price: aiRec.recommendedPrice,
      confidence: aiRec.confidence,
      generatedAt: new Date(),
    };
  }

  const crop = await Crop.create(cropData);
  await crop.populate('farmer', 'name phone rating location');

  // Notify nearby buyers
  const radius = 50 * 1000; // 50km in meters
  const nearbyBuyers = await User.find({
    role: 'buyer',
    isActive: true,
    location: {
      $near: {
        $geometry: { type: 'Point', coordinates: crop.location.coordinates },
        $maxDistance: radius,
      },
    },
  }).select('_id').limit(50);

  if (nearbyBuyers.length > 0) {
    NotificationService.notifyNewCropToNearbyBuyers(
      crop,
      farmer.name,
      nearbyBuyers.map((b) => b._id)
    ).catch(() => {});
  }

  logger.info(`Crop created: ${crop._id} by farmer ${farmer._id}`);

  return sendCreated(res, {
    message: 'Crop listed successfully! Nearby buyers have been notified.',
    data: { crop },
  });
};

// ─── GET ALL CROPS (Marketplace) ───────────────────────────────────────────────────────
const getCrops = async (req, res) => {
  const { lat, lng, radius = 50, name, category, quality, minPrice, maxPrice, deliveryAvailable, sortBy, order, search } = req.query;
  const { page, limit, skip } = parsePagination(req.query);

  const query = { status: 'active', isAvailable: true };

  // Geo-based filtering
  if (lat && lng) {
    query.location = {
      $near: {
        $geometry: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
        $maxDistance: parseFloat(radius) * 1000,
      },
    };
  }

  // Filters
  if (name) query.name = new RegExp(name, 'i');
  if (category) query.category = category;
  if (quality) query.quality = quality;
  if (deliveryAvailable !== undefined) query.deliveryAvailable = deliveryAvailable === 'true';
  if (minPrice || maxPrice) {
    query.pricePerKg = {};
    if (minPrice) query.pricePerKg.$gte = parseFloat(minPrice);
    if (maxPrice) query.pricePerKg.$lte = parseFloat(maxPrice);
  }

  // Full-text search
  if (search) {
    query.$text = { $search: search };
  }

  const sort = query.location ? {} : buildSort(sortBy, order); // Can't sort with $near

  const [crops, total] = await Promise.all([
    Crop.find(query)
      .populate('farmer', 'name phone rating location isVerified avatar')
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    Crop.countDocuments(query),
  ]);

  // Add distance if geo query
  const cropsWithDistance = crops.map((crop) => {
    if (lat && lng) {
      const { calculateDistance } = require('../utils/helpers');
      const dist = calculateDistance(
        parseFloat(lat), parseFloat(lng),
        crop.location.coordinates[1], crop.location.coordinates[0]
      );
      return { ...crop, distance: dist };
    }
    return crop;
  });

  return sendPaginated(res, { data: { crops: cropsWithDistance }, page, limit, total });
};

// ─── GET CROP BY ID ──────────────────────────────────────────────────────────────────────
const getCropById = async (req, res) => {
  const crop = await Crop.findById(req.params.id)
    .populate('farmer', 'name phone rating location isVerified avatar companyName farmerId');

  if (!crop) return sendNotFound(res, 'Crop not found');

  // Increment view count
  await Crop.findByIdAndUpdate(req.params.id, { $inc: { viewCount: 1 } });

  // Get AI recommendation if not present
  let aiRecommendation = crop.aiRecommendedPrice;
  if (!aiRecommendation?.price) {
    const rec = await AIService.getPriceRecommendation(crop.name, crop.quality);
    if (rec.success) aiRecommendation = rec;
  }

  return sendSuccess(res, { data: { crop, aiRecommendation } });
};

// ─── UPDATE CROP ─────────────────────────────────────────────────────────────────────────
const updateCrop = async (req, res) => {
  const crop = await Crop.findOne({ _id: req.params.id, farmer: req.user._id });
  if (!crop) return sendNotFound(res, 'Crop not found or unauthorized');

  // Handle new image uploads
  if (req.files?.length > 0) {
    const newImages = await Promise.all(
      req.files.map((file) => uploadToCloudinary(file.buffer, `krushimitra/crops/${req.user._id}`))
    );
    req.body.images = [...(crop.images || []), ...newImages];
  }

  const updated = await Crop.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
    .populate('farmer', 'name phone rating');

  return sendSuccess(res, { message: 'Crop updated', data: { crop: updated } });
};

// ─── DELETE CROP ─────────────────────────────────────────────────────────────────────────
const deleteCrop = async (req, res) => {
  const crop = await Crop.findOne({ _id: req.params.id, farmer: req.user._id });
  if (!crop) return sendNotFound(res, 'Crop not found or unauthorized');

  // Delete images from Cloudinary
  if (crop.images?.length > 0) {
    await Promise.allSettled(crop.images.map((img) => deleteFromCloudinary(img.publicId)));
  }

  await crop.deleteOne();
  return sendSuccess(res, { message: 'Crop listing deleted' });
};

// ─── GET MY CROPS ────────────────────────────────────────────────────────────────────────
const getMyCrops = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { status } = req.query;

  const query = { farmer: req.user._id };
  if (status) query.status = status;

  const [crops, total] = await Promise.all([
    Crop.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Crop.countDocuments(query),
  ]);

  const stats = await Crop.aggregate([
    { $match: { farmer: req.user._id } },
    { $group: {
      _id: '$status',
      count: { $sum: 1 },
      totalQuantity: { $sum: '$quantity' },
    }},
  ]);

  return sendPaginated(res, { data: { crops, stats }, page, limit, total });
};

// ─── GET AI PRICE RECOMMENDATION ────────────────────────────────────────────────────────
const getAIPriceRecommendation = async (req, res) => {
  const { cropName, quality = 'A' } = req.query;
  if (!cropName) return sendError(res, { message: 'cropName is required', statusCode: 400 });

  const recommendation = await AIService.getPriceRecommendation(cropName, quality);
  return sendSuccess(res, { data: { recommendation } });
};

// ─── DETECT CROP QUALITY ─────────────────────────────────────────────────────────────────────
const detectCropQuality = async (req, res) => {
  const { cropName } = req.body;
  if (!req.file) return sendError(res, { message: 'Image is required', statusCode: 400 });

  // Upload image to Cloudinary
  const uploaded = await uploadToCloudinary(req.file.buffer, 'krushimitra/quality-checks');

  const result = await AIService.detectCropQuality(uploaded.url, cropName);
  return sendSuccess(res, { data: { ...result, imageUrl: uploaded.url } });
};

module.exports = { createCrop, getCrops, getCropById, updateCrop, deleteCrop, getMyCrops, getAIPriceRecommendation, detectCropQuality };
