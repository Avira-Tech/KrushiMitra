const MandiPrice = require('../models/MandiPrice');
const logger = require('../utils/logger');

/**
 * Get mandi prices
 * GET /api/v1/mandi/prices
 */
const getPrices = async (req, res) => {
  try {
    const { crop, state, mandi, priceDate, limit = 20, skip = 0 } = req.query;

    // Build filter
    const filter = {};
    if (crop) filter.crop = { $regex: crop, $options: 'i' };
    if (state) filter.state = state;
    if (mandi) filter.mandi = { $regex: mandi, $options: 'i' };

    // Handle date filter - get prices from last N days
    if (priceDate) {
      const lastNDays = parseInt(priceDate);
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - lastNDays);
      startDate.setHours(0, 0, 0, 0);

      filter.priceDate = { $gte: startDate };
    } else {
      // Default: last 7 days
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);
      startDate.setHours(0, 0, 0, 0);

      filter.priceDate = { $gte: startDate };
    }

    const prices = await MandiPrice.find(filter)
      .sort({ priceDate: -1, crop: 1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit));

    const total = await MandiPrice.countDocuments(filter);

    // Group by crop for easy reading
    const groupedByDate = {};
    prices.forEach(price => {
      const dateKey = price.priceDate.toISOString().split('T')[0];
      if (!groupedByDate[dateKey]) {
        groupedByDate[dateKey] = [];
      }
      groupedByDate[dateKey].push(price);
    });

    return res.status(200).json({
      success: true,
      data: prices,
      grouped: groupedByDate,
      pagination: {
        total,
        skip: parseInt(skip),
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    logger.error('❌ Error fetching mandi prices:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch mandi prices',
    });
  }
};

/**
 * Get price trends for a crop
 * GET /api/v1/mandi/trends
 */
const getPriceTrends = async (req, res) => {
  try {
    const { crop, state, days = 30 } = req.query;

    if (!crop) {
      return res.status(400).json({
        success: false,
        error: 'Crop name is required',
      });
    }

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(days));
    startDate.setHours(0, 0, 0, 0);

    const prices = await MandiPrice.find({
      crop: { $regex: crop, $options: 'i' },
      ...(state && { state }),
      priceDate: { $gte: startDate },
    }).sort({ priceDate: 1 });

    // Calculate trends
    const trends = prices.map(p => ({
      date: p.priceDate.toISOString().split('T')[0],
      minPrice: p.minPrice,
      maxPrice: p.maxPrice,
      modalPrice: p.modalPrice,
      mandi: p.mandi,
    }));

    const avgPrice = prices.reduce((sum, p) => sum + p.modalPrice, 0) / prices.length;
    const maxPrice = Math.max(...prices.map(p => p.maxPrice));
    const minPrice = Math.min(...prices.map(p => p.minPrice));

    return res.status(200).json({
      success: true,
      data: {
        crop,
        state,
        trends,
        statistics: {
          averagePrice: avgPrice.toFixed(2),
          maxPrice,
          minPrice,
          daysAnalyzed: prices.length,
        },
      },
    });
  } catch (error) {
    logger.error('❌ Error fetching price trends:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch price trends',
    });
  }
};

module.exports = { getPrices, getPriceTrends };
