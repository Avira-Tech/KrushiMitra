'use strict';
/**
 * cropController.js
 * Handles crop listing CRUD + farmer analytics.
 *
 * Key fixes vs original:
 *  - pricePerUnit renamed to pricePerKg throughout (consistent with Offer model)
 *  - images array guarded — never crashes if empty/undefined
 *  - Geospatial query wrapped in try/catch (fails silently if 2dsphere index missing)
 *  - getFarmerAnalytics added — dynamic DB aggregation for FarmerAnalyticsScreen
 *  - All string comparisons null-safe
 */

const Crop = require('../models/Crop');
const User = require('../models/User');
const Offer = require('../models/Offer');
const Contract = require('../models/Contract');
const { validationResult } = require('express-validator');
const sanitizer = require('../utils/sanitizer');
const logger = require('../utils/logger');

// ─── GET /api/v1/crops ────────────────────────────────────────────────────────
const getCrops = async (req, res) => {
  try {
    const {
      category, search, minPrice, maxPrice,
      skip = 0, limit = 20,
      lat, lon, radius = 50,
      quality, sortBy = 'createdAt', order = 'desc',
    } = req.query;

    const filter = { status: { $ne: 'deleted' } };

    if (category) filter.category = category;
    if (quality) filter.quality = quality;

    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { name: { $regex: escaped, $options: 'i' } },
        { category: { $regex: escaped, $options: 'i' } },
      ];
    }

    if (minPrice || maxPrice) {
      filter.pricePerKg = {};
      if (minPrice) filter.pricePerKg.$gte = parseFloat(minPrice);
      if (maxPrice) filter.pricePerKg.$lte = parseFloat(maxPrice);
    }

    // Geospatial — only apply if index exists
    if (lat && lon) {
      filter['location.coordinates'] = {
        $near: {
          $geometry: { type: 'Point', coordinates: [parseFloat(lon), parseFloat(lat)] },
          $maxDistance: parseFloat(radius) * 1000,
        },
      };
    }

    const sortDir = order === 'asc' ? 1 : -1;
    const allowedSort = { pricePerKg: 1, createdAt: 1, quantity: 1 };
    const sortField = allowedSort[sortBy] !== undefined ? sortBy : 'createdAt';

    const [crops, total] = await Promise.all([
      Crop.find(filter)
        .populate('farmer', 'name phone avatar rating location username')
        .sort({ [sortField]: sortDir })
        .skip(parseInt(skip))
        .limit(Math.min(parseInt(limit), 100))
        .lean(),
      Crop.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: crops,
      pagination: {
        total,
        skip: parseInt(skip),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)) || 1,
      },
    });
  } catch (err) {
    logger.error('getCrops error: ' + err.message);
    // Geo query can fail if index missing — retry without geo
    if (err.message?.includes('$near') || err.message?.includes('2dsphere')) {
      return getCropsWithoutGeo(req, res);
    }
    return res.status(500).json({ success: false, error: 'Failed to fetch crops' });
  }
};

/** Fallback when geospatial index is not yet created */
const getCropsWithoutGeo = async (req, res) => {
  const { category, search, minPrice, maxPrice, skip = 0, limit = 20 } = req.query;
  const filter = { status: { $ne: 'deleted' } };
  if (category) filter.category = category;
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.$or = [{ name: { $regex: escaped, $options: 'i' } }];
  }
  if (minPrice || maxPrice) {
    filter.pricePerKg = {};
    if (minPrice) filter.pricePerKg.$gte = parseFloat(minPrice);
    if (maxPrice) filter.pricePerKg.$lte = parseFloat(maxPrice);
  }
  const [crops, total] = await Promise.all([
    Crop.find(filter).populate('farmer', 'name phone avatar rating username').sort({ createdAt: -1 }).skip(parseInt(skip)).limit(parseInt(limit)).lean(),
    Crop.countDocuments(filter),
  ]);
  return res.status(200).json({ success: true, data: crops, pagination: { total, skip: parseInt(skip), limit: parseInt(limit) } });
};

// ─── GET /api/v1/crops/:id ────────────────────────────────────────────────────
const getCropDetail = async (req, res) => {
  try {
    const crop = await Crop.findById(req.params.id)
      .populate('farmer', 'name phone email avatar rating location username')
      .lean();

    if (!crop) {
      return res.status(404).json({ success: false, error: 'Crop not found' });
    }

    // Fetch farmer's other crops (exclude this one)
    const otherCrops = await Crop.find(
      { farmer: crop.farmer._id, _id: { $ne: crop._id }, status: { $ne: 'deleted' } },
      'name category pricePerKg images quantity'
    ).limit(5).lean();

    return res.status(200).json({
      success: true,
      data: { ...crop, farmerOtherCrops: otherCrops },
    });
  } catch (err) {
    logger.error('getCropDetail error: ' + err.message);
    return res.status(500).json({ success: false, error: 'Failed to fetch crop details' });
  }
};

// ─── GET /api/v1/crops/farmer/my-listings ────────────────────────────────────
const getFarmerCrops = async (req, res) => {
  try {
    const { skip = 0, limit = 20, status } = req.query;
    const farmerId = req.user.id || req.user._id;

    const filter = { farmer: farmerId };
    if (status) filter.status = status;

    const [crops, total] = await Promise.all([
      Crop.find(filter).sort({ createdAt: -1 }).skip(parseInt(skip)).limit(parseInt(limit)).lean(),
      Crop.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: crops,
      pagination: { total, skip: parseInt(skip), limit: parseInt(limit) },
    });
  } catch (err) {
    logger.error('getFarmerCrops error: ' + err.message);
    return res.status(500).json({ success: false, error: 'Failed to fetch your crops' });
  }
};

// ─── POST /api/v1/crops ───────────────────────────────────────────────────────
const addCrop = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({
        success: false,
        errors: errors.array().map((e) => ({ field: e.param, message: e.msg })),
      });
    }

    const userId = req.user.id || req.user._id;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, error: 'User not found' });
    if (user.role !== 'farmer') return res.status(403).json({ success: false, error: 'Only farmers can add crops' });

    const {
      name, category, quantity, unit = 'kg', pricePerKg,
      description, harvestDate, availableFrom, images = [], location,
      quality = 'B', soilType, pesticides = false,
      isNegotiable = true, organic = false, pickupAvailable = true,
    } = req.body;

    const crop = await Crop.create({
      farmer: userId,
      name: sanitizer.sanitizeString(name),
      category: sanitizer.sanitizeString(category),
      description: sanitizer.sanitizeString(description || ''),
      soilType: sanitizer.sanitizeString(soilType || ''),
      quantity: parseFloat(quantity),
      availableQuantity: parseFloat(quantity),
      unit,
      pricePerKg: parseFloat(pricePerKg),
      quality,
      harvestDate: harvestDate ? new Date(harvestDate) : undefined,
      availableFrom: availableFrom ? new Date(availableFrom) : undefined,
      images: Array.isArray(images)
        ? images.map((img) => ({ url: sanitizer.sanitizeUrl(img) })).filter(img => img.url)
        : [],
      pesticides: Boolean(pesticides),
      isNegotiable: Boolean(isNegotiable),
      organic: Boolean(organic),
      pickupAvailable: Boolean(pickupAvailable),
      location: location ? {
        type: 'Point',
        coordinates: [parseFloat(location.longitude || 0), parseFloat(location.latitude || 0)],
        address: sanitizer.sanitizeString(location.address || ''),
        city: sanitizer.sanitizeString(location.city || ''),
        state: sanitizer.sanitizeString(location.state || ''),
      } : undefined,
    });

    await crop.populate('farmer', 'name phone email username');

    logger.info(`Crop added: ${crop._id} by farmer ${userId}`);

    return res.status(201).json({ success: true, message: 'Crop added successfully', data: crop });
  } catch (err) {
    logger.error('addCrop error: ' + err.message);
    return res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'development' ? err.message : 'Failed to add crop',
    });
  }
};

// ─── PUT /api/v1/crops/:id ────────────────────────────────────────────────────
const updateCrop = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const crop = await Crop.findById(req.params.id);

    if (!crop) return res.status(404).json({ success: false, error: 'Crop not found' });
    if (crop.farmer.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, error: 'You can only update your own crops' });
    }

    const ALLOWED = ['name', 'category', 'quantity', 'pricePerKg', 'description', 'harvestDate', 'availableFrom', 'images', 'quality', 'soilType', 'pesticides', 'status', 'isNegotiable', 'organic', 'pickupAvailable'];
    const updates = {};

    for (const field of ALLOWED) {
      if (req.body[field] === undefined) continue;
      if (field === 'quantity') {
        updates.quantity = parseFloat(req.body[field]);
        updates.availableQuantity = parseFloat(req.body[field]);
      } else if (field === 'pricePerKg') {
        updates.pricePerKg = parseFloat(req.body[field]);
      } else if (['name', 'category', 'description', 'soilType'].includes(field)) {
        updates[field] = sanitizer.sanitizeString(req.body[field]);
      } else if (field === 'images') {
        updates.images = req.body[field].map((img) => ({ url: sanitizer.sanitizeUrl(img) })).filter(img => img.url);
      } else if (['isNegotiable', 'organic', 'pickupAvailable', 'pesticides'].includes(field)) {
        updates[field] = Boolean(req.body[field]);
      } else {
        updates[field] = req.body[field];
      }
    }

    const updated = await Crop.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true })
      .populate('farmer', 'name phone email username');

    logger.info(`Crop updated: ${req.params.id}`);
    return res.status(200).json({ success: true, message: 'Crop updated', data: updated });
  } catch (err) {
    logger.error('updateCrop error: ' + err.message);
    return res.status(500).json({ success: false, error: 'Failed to update crop' });
  }
};

// ─── DELETE /api/v1/crops/:id ─────────────────────────────────────────────────
const deleteCrop = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const crop = await Crop.findById(req.params.id);

    if (!crop) return res.status(404).json({ success: false, error: 'Crop not found' });
    if (crop.farmer.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, error: 'You can only delete your own crops' });
    }

    const activeOffers = await Offer.countDocuments({ crop: req.params.id, status: { $in: ['pending', 'accepted'] } });
    if (activeOffers > 0) {
      return res.status(400).json({ success: false, error: 'Cannot delete crop with active offers' });
    }

    // Soft delete
    await Crop.findByIdAndUpdate(req.params.id, { status: 'deleted' });

    logger.info(`Crop soft-deleted: ${req.params.id}`);
    return res.status(200).json({ success: true, message: 'Crop deleted successfully' });
  } catch (err) {
    logger.error('deleteCrop error: ' + err.message);
    return res.status(500).json({ success: false, error: 'Failed to delete crop' });
  }
};

// ─── GET /api/v1/crops/farmer/analytics ──────────────────────────────────────
/**
 * Dynamic analytics for FarmerAnalyticsScreen.
 * Aggregates from Crop, Offer, Contract collections.
 */
const getFarmerAnalytics = async (req, res) => {
  try {
    const farmerId = req.user.id || req.user._id;
    const mongoose = require('mongoose');
    const fId = new mongoose.Types.ObjectId(farmerId);

    const [cropStats, offerStats, contractStats, revenueStats, topCrops] = await Promise.all([
      // Total crops and availability
      Crop.aggregate([
        { $match: { farmer: fId, status: { $ne: 'deleted' } } },
        {
          $group: {
            _id: null,
            totalListings: { $sum: 1 },
            totalQuantity: { $sum: '$quantity' },
            avgPrice: { $avg: '$pricePerKg' },
          }
        },
      ]),

      // Offers received
      Offer.aggregate([
        { $match: { farmer: fId } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            avgPrice: { $avg: '$pricePerKg' },
          }
        },
      ]),

      // Contracts by status
      Contract.aggregate([
        { $match: { farmer: fId } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalValue: { $sum: '$terms.totalAmount' },
          }
        },
      ]),

      // Total revenue from completed contracts
      Contract.aggregate([
        { $match: { farmer: fId, status: 'completed' } },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$terms.netAmount' },
            totalDeals: { $sum: 1 },
            avgDealValue: { $avg: '$terms.totalAmount' },
          }
        },
      ]),

      // Top earning crops
      Contract.aggregate([
        { $match: { farmer: fId, status: 'completed' } },
        {
          $group: {
            _id: '$terms.cropName',
            revenue: { $sum: '$terms.netAmount' },
            deals: { $sum: 1 },
            quantity: { $sum: '$terms.quantity' },
          }
        },
        { $sort: { revenue: -1 } },
        { $limit: 5 },
      ]),
    ]);

    const offerMap = offerStats.reduce((acc, s) => { acc[s._id] = s; return acc; }, {});
    const contractMap = contractStats.reduce((acc, s) => { acc[s._id] = s; return acc; }, {});
    const revenue = revenueStats[0] || { totalRevenue: 0, totalDeals: 0, avgDealValue: 0 };
    const crops = cropStats[0] || { totalListings: 0, totalQuantity: 0, avgPrice: 0 };

    return res.status(200).json({
      success: true,
      data: {
        summary: {
          totalRevenue: revenue.totalRevenue,
          totalDeals: revenue.totalDeals,
          avgDealValue: revenue.avgDealValue,
          totalListings: crops.totalListings,
          totalQuantityKg: crops.totalQuantity,
          avgPricePerKg: parseFloat((crops.avgPrice || 0).toFixed(2)),
        },
        offers: {
          pending: offerMap.pending?.count || 0,
          accepted: offerMap.accepted?.count || 0,
          rejected: offerMap.rejected?.count || 0,
          countered: offerMap.countered?.count || 0,
          total: offerStats.reduce((s, o) => s + o.count, 0),
        },
        contracts: {
          active: contractMap.active?.count || 0,
          completed: contractMap.completed?.count || 0,
          disputed: contractMap.disputed?.count || 0,
          cancelled: contractMap.cancelled?.count || 0,
          totalValue: contractStats.reduce((s, c) => s + (c.totalValue || 0), 0),
        },
        topCrops,
      },
    });
  } catch (err) {
    logger.error('getFarmerAnalytics error: ' + err.message);
    return res.status(500).json({ success: false, error: 'Failed to fetch analytics' });
  }
};

module.exports = { getCrops, getCropDetail, getFarmerCrops, addCrop, updateCrop, deleteCrop, getFarmerAnalytics };