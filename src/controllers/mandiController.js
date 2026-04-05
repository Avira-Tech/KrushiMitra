// const MandiPrice = require('../models/MandiPrice');
// const logger = require('../utils/logger');

// /**
//  * Get mandi prices
//  * GET /api/v1/mandi/prices
//  */
// const getPrices = async (req, res) => {
//   try {
//     const { crop, state, mandi, priceDate, limit = 20, skip = 0 } = req.query;

//     // Build filter
//     const filter = {};
//     if (crop) filter.crop = { $regex: crop, $options: 'i' };
//     if (state) filter.state = state;
//     if (mandi) filter.mandi = { $regex: mandi, $options: 'i' };

//     // Handle date filter - get prices from last N days
//     if (priceDate) {
//       const lastNDays = parseInt(priceDate);
//       const startDate = new Date();
//       startDate.setDate(startDate.getDate() - lastNDays);
//       startDate.setHours(0, 0, 0, 0);

//       filter.priceDate = { $gte: startDate };
//     } else {
//       // Default: last 7 days
//       const startDate = new Date();
//       startDate.setDate(startDate.getDate() - 7);
//       startDate.setHours(0, 0, 0, 0);

//       filter.priceDate = { $gte: startDate };
//     }

//     const prices = await MandiPrice.find(filter)
//       .sort({ priceDate: -1, crop: 1 })
//       .skip(parseInt(skip))
//       .limit(parseInt(limit));

//     const total = await MandiPrice.countDocuments(filter);

//     // Group by crop for easy reading
//     const groupedByDate = {};
//     prices.forEach(price => {
//       const dateKey = price.priceDate.toISOString().split('T')[0];
//       if (!groupedByDate[dateKey]) {
//         groupedByDate[dateKey] = [];
//       }
//       groupedByDate[dateKey].push(price);
//     });

//     return res.status(200).json({
//       success: true,
//       data: prices,
//       grouped: groupedByDate,
//       pagination: {
//         total,
//         skip: parseInt(skip),
//         limit: parseInt(limit),
//       },
//     });
//   } catch (error) {
//     logger.error('❌ Error fetching mandi prices:', error);
//     return res.status(500).json({
//       success: false,
//       error: 'Failed to fetch mandi prices',
//     });
//   }
// };

// /**
//  * Get price trends for a crop
//  * GET /api/v1/mandi/trends
//  */
// const getPriceTrends = async (req, res) => {
//   try {
//     const { crop, state, days = 30 } = req.query;

//     if (!crop) {
//       return res.status(400).json({
//         success: false,
//         error: 'Crop name is required',
//       });
//     }

//     const startDate = new Date();
//     startDate.setDate(startDate.getDate() - parseInt(days));
//     startDate.setHours(0, 0, 0, 0);

//     const prices = await MandiPrice.find({
//       crop: { $regex: crop, $options: 'i' },
//       ...(state && { state }),
//       priceDate: { $gte: startDate },
//     }).sort({ priceDate: 1 });

//     // Calculate trends
//     const trends = prices.map(p => ({
//       date: p.priceDate.toISOString().split('T')[0],
//       minPrice: p.minPrice,
//       maxPrice: p.maxPrice,
//       modalPrice: p.modalPrice,
//       mandi: p.mandi,
//     }));

//     const avgPrice = prices.reduce((sum, p) => sum + p.modalPrice, 0) / prices.length;
//     const maxPrice = Math.max(...prices.map(p => p.maxPrice));
//     const minPrice = Math.min(...prices.map(p => p.minPrice));

//     return res.status(200).json({
//       success: true,
//       data: {
//         crop,
//         state,
//         trends,
//         statistics: {
//           averagePrice: avgPrice.toFixed(2),
//           maxPrice,
//           minPrice,
//           daysAnalyzed: prices.length,
//         },
//       },
//     });
//   } catch (error) {
//     logger.error('❌ Error fetching price trends:', error);
//     return res.status(500).json({
//       success: false,
//       error: 'Failed to fetch price trends',
//     });
//   }
// };

// module.exports = { getPrices, getPriceTrends };

'use strict';
/**
 * mandiController.js
 *
 * Fetches live mandi prices from data.gov.in Agmarknet API:
 * GET https://api.data.gov.in/resource/35985678-0d79-46b4-9ed6-6f13308a1d24
 *
 * Falls back to cached DB records if API is unavailable.
 */

const axios      = require('axios');
const MandiPrice = require('../models/MandiPrice');
const logger     = require('../utils/logger');

const AGMARKNET_API_KEY = process.env.AGMARKNET_API_KEY || '579b464db66ec23bdd000001cdd3946e44ce4aad7209ff7b23ac571b';
const AGMARKNET_URL     = 'https://api.data.gov.in/resource/35985678-0d79-46b4-9ed6-6f13308a1d24';

/**
 * Fetch prices from data.gov.in and upsert into DB.
 * Called directly by getPrices (live fetch) and by cron job.
 */
const fetchAndSyncFromAPI = async ({ commodity, state, district, limit = 100 } = {}) => {
  const params = {
    'api-key': AGMARKNET_API_KEY,
    format:    'json',
    limit,
  };
  if (commodity) params['filters[Commodity]'] = commodity;
  if (state)     params['filters[State]']     = state;
  if (district)  params['filters[District]']  = district;

  const response = await axios.get(AGMARKNET_URL, { params, timeout: 15_000 });
  const records  = response.data?.records || [];

  if (!records.length) return [];

  // Upsert into MandiPrice collection for caching
  const bulkOps = records.map((r) => ({
    updateOne: {
      filter: {
        commodity: r.Commodity || r.commodity,
        market:    r.Market    || r.market,
        priceDate: new Date(r.Arrival_Date || r.arrival_date || Date.now()),
      },
      update: {
        $set: {
          commodity:  r.Commodity  || r.commodity  || '',
          variety:    r.Variety    || r.variety     || '',
          market:     r.Market     || r.market      || '',
          state:      r.State      || r.state       || '',
          district:   r.District   || r.district    || '',
          minPrice:   parseFloat(r.Min_x0020_Price || r.min_price || 0),
          maxPrice:   parseFloat(r.Max_x0020_Price || r.max_price || 0),
          modalPrice: parseFloat(r.Modal_x0020_Price || r.modal_price || 0),
          unit:       'Quintal',
          priceDate:  new Date(r.Arrival_Date || r.arrival_date || Date.now()),
          source:     'AGMARKNET',
        },
      },
      upsert: true,
    },
  }));

  if (bulkOps.length) await MandiPrice.bulkWrite(bulkOps);
  return records;
};

/**
 * Normalize a raw API record or DB document to the frontend shape:
 * { commodity, market, state, minPrice, maxPrice, modalPrice, unit, priceDate }
 */
const normalize = (r, isDbRecord = false) => {
  if (isDbRecord) {
    return {
      id:         r._id,
      commodity:  r.commodity,
      variety:    r.variety   || '',
      market:     r.market,
      state:      r.state,
      district:   r.district  || '',
      minPrice:   r.minPrice,
      maxPrice:   r.maxPrice,
      modalPrice: r.modalPrice,
      unit:       r.unit || 'Quintal',
      priceDate:  r.priceDate,
      source:     r.source || 'DB',
    };
  }
  return {
    commodity:  r.Commodity  || r.commodity  || '',
    variety:    r.Variety    || r.variety     || '',
    market:     r.Market     || r.market      || '',
    state:      r.State      || r.state       || '',
    district:   r.District   || r.district    || '',
    minPrice:   parseFloat(r.Min_x0020_Price  || r.min_price  || 0),
    maxPrice:   parseFloat(r.Max_x0020_Price  || r.max_price  || 0),
    modalPrice: parseFloat(r.Modal_x0020_Price|| r.modal_price|| 0),
    unit:       'Quintal',
    priceDate:  r.Arrival_Date || r.arrival_date || new Date().toISOString(),
    source:     'AGMARKNET',
  };
};

// ─── GET /api/v1/mandi/prices ─────────────────────────────────────────────────
const getPrices = async (req, res) => {
  try {
    const {
      commodity,
      state      = 'Gujarat',
      district,
      limit      = 50,
      skip       = 0,
      useCache,
    } = req.query;

    // Try live API first
    let liveData = [];
    let apiError  = null;

    if (useCache !== 'true') {
      try {
        liveData = await fetchAndSyncFromAPI({ commodity, state, district, limit: parseInt(limit) });
        logger.info(`✅ Mandi: fetched ${liveData.length} records from data.gov.in`);
      } catch (err) {
        apiError = err.message;
        logger.warn(`⚠️ Mandi API unavailable: ${err.message} — falling back to DB cache`);
      }
    }

    if (liveData.length > 0 && !apiError) {
      // Return live data normalized
      const normalized = liveData.map((r) => normalize(r, false));
      return res.status(200).json({
        success: true,
        data:    normalized,
        source:  'live',
        total:   normalized.length,
      });
    }

    // Fallback: read from DB cache
    const filter = {};
    if (commodity) filter.commodity = { $regex: commodity, $options: 'i' };
    if (state)     filter.state     = { $regex: state,     $options: 'i' };
    if (district)  filter.district  = { $regex: district,  $options: 'i' };

    // Last 30 days
    filter.priceDate = { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) };

    const [dbPrices, total] = await Promise.all([
      MandiPrice.find(filter)
        .sort({ priceDate: -1 })
        .skip(parseInt(skip))
        .limit(parseInt(limit))
        .lean(),
      MandiPrice.countDocuments(filter),
    ]);

    if (!dbPrices.length) {
      // Return static mock so the UI is never blank
      return res.status(200).json({
        success: true,
        data:    getMockPrices(),
        source:  'mock',
        total:   getMockPrices().length,
        warning: apiError ? `Live API unavailable: ${apiError}` : 'No cached data found',
      });
    }

    return res.status(200).json({
      success: true,
      data:    dbPrices.map((r) => normalize(r, true)),
      source:  'cache',
      total,
      pagination: { total, skip: parseInt(skip), limit: parseInt(limit) },
    });
  } catch (err) {
    logger.error('getPrices error:', err);
    return res.status(500).json({
      success: false,
      error:   'Failed to fetch mandi prices',
      data:    getMockPrices(),   // always return something so UI doesn't crash
    });
  }
};

// ─── GET /api/v1/mandi/trends ─────────────────────────────────────────────────
const getPriceTrends = async (req, res) => {
  try {
    const { commodity, state, days = 30 } = req.query;

    if (!commodity) {
      return res.status(400).json({ success: false, error: 'commodity is required' });
    }

    // Try live API for trend data
    let liveRecords = [];
    try {
      liveRecords = await fetchAndSyncFromAPI({ commodity, state, limit: 200 });
    } catch (err) {
      logger.warn(`Mandi trend API error: ${err.message}`);
    }

    // Read from DB (includes any freshly synced records)
    const startDate = new Date(Date.now() - parseInt(days) * 24 * 60 * 60 * 1000);
    const dbPrices  = await MandiPrice.find({
      commodity: { $regex: commodity, $options: 'i' },
      ...(state && { state: { $regex: state, $options: 'i' } }),
      priceDate:  { $gte: startDate },
    }).sort({ priceDate: 1 }).lean();

    if (!dbPrices.length) {
      return res.status(200).json({
        success: true,
        data: {
          commodity,
          trends:     [],
          statistics: { averagePrice: 0, maxPrice: 0, minPrice: 0, daysAnalyzed: 0 },
        },
      });
    }

    const avgPrice = dbPrices.reduce((s, p) => s + (p.modalPrice || 0), 0) / dbPrices.length;
    const maxPrice = Math.max(...dbPrices.map((p) => p.maxPrice || 0));
    const minPrice = Math.min(...dbPrices.map((p) => p.minPrice || 0));

    return res.status(200).json({
      success: true,
      data: {
        commodity,
        state,
        trends: dbPrices.map((p) => ({
          date:       p.priceDate,
          minPrice:   p.minPrice,
          maxPrice:   p.maxPrice,
          modalPrice: p.modalPrice,
          market:     p.market,
        })),
        statistics: {
          averagePrice: parseFloat(avgPrice.toFixed(2)),
          maxPrice,
          minPrice,
          daysAnalyzed: dbPrices.length,
        },
      },
    });
  } catch (err) {
    logger.error('getPriceTrends error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch price trends' });
  }
};

// ─── Cron helper — called by server.js every 6 hours ─────────────────────────
const syncMandiPrices = async (state = 'Gujarat') => {
  try {
    const records = await fetchAndSyncFromAPI({ state, limit: 500 });
    logger.info(`✅ Mandi cron: synced ${records.length} records for ${state}`);
    return records.length;
  } catch (err) {
    logger.error(`Mandi cron error for ${state}:`, err.message);
    return 0;
  }
};

// ─── Static mock data (last resort fallback) ──────────────────────────────────
const getMockPrices = () => [
  { commodity: 'Wheat',      market: 'Ahmedabad',  state: 'Gujarat',     minPrice: 2100, maxPrice: 2300, modalPrice: 2200, unit: 'Quintal', source: 'mock' },
  { commodity: 'Tomato',     market: 'Ahmedabad',  state: 'Gujarat',     minPrice: 1500, maxPrice: 2000, modalPrice: 1800, unit: 'Quintal', source: 'mock' },
  { commodity: 'Cotton',     market: 'Rajkot',     state: 'Gujarat',     minPrice: 6000, maxPrice: 6800, modalPrice: 6500, unit: 'Quintal', source: 'mock' },
  { commodity: 'Onion',      market: 'Anand',      state: 'Gujarat',     minPrice: 2200, maxPrice: 2800, modalPrice: 2500, unit: 'Quintal', source: 'mock' },
  { commodity: 'Rice',       market: 'Mehsana',    state: 'Gujarat',     minPrice: 5000, maxPrice: 5800, modalPrice: 5500, unit: 'Quintal', source: 'mock' },
  { commodity: 'Groundnut',  market: 'Junagadh',   state: 'Gujarat',     minPrice: 8000, maxPrice: 9000, modalPrice: 8500, unit: 'Quintal', source: 'mock' },
  { commodity: 'Potato',     market: 'Surat',      state: 'Gujarat',     minPrice: 1200, maxPrice: 1600, modalPrice: 1400, unit: 'Quintal', source: 'mock' },
  { commodity: 'Cumin',      market: 'Unjha',      state: 'Gujarat',     minPrice:18000, maxPrice:22000, modalPrice:20000, unit: 'Quintal', source: 'mock' },
  { commodity: 'Wheat',      market: 'Pune',       state: 'Maharashtra', minPrice: 2000, maxPrice: 2250, modalPrice: 2100, unit: 'Quintal', source: 'mock' },
  { commodity: 'Sugarcane',  market: 'Kolhapur',   state: 'Maharashtra', minPrice:  280, maxPrice:  310, modalPrice:  295, unit: 'Quintal', source: 'mock' },
];

module.exports = { getPrices, getPriceTrends, syncMandiPrices };