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
const AIService  = require('../services/aiService');
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

  if (records.length > 0) {
    logger.debug(`🔍 Mandi RAW record keys: ${Object.keys(records[0]).join(', ')}`);
  }

  if (!records.length) return [];

  // Filter out obviously malformed records before upserting
  // A valid Agmarknet record MUST have a Commodity and some price info
  const validRecords = records.filter(r => {
    const hasCommodity = !!(r.Commodity || r.commodity || r.Crop || r.crop);
    const hasPrice = !!(r.Modal_Price || r.modal_price || r.Modal_x0020_Price || r.Max_Price || r.Min_Price);
    return hasCommodity && hasPrice;
  });

  if (validRecords.length === 0 && records.length > 0) {
    logger.warn(`⚠️ Mandi: Received ${records.length} records but 0 passed validation. Possible schema mismatch at source.`);
    return []; // Return empty so getPrices knows the live fetch was essentially a failure
  }

  // Upsert into MandiPrice collection for caching
  const bulkOps = validRecords.map((r) => ({
    updateOne: {
      filter: {
        commodity: r.Commodity || r.commodity || 'Unknown',
        market:    r.Market    || r.market    || 'Unknown',
        priceDate: (() => {
          const raw = r.Arrival_Date || r.arrival_date;
          if (!raw) return new Date();
          const d = new Date(raw);
          return isNaN(d.getTime()) ? new Date() : d;
        })(),
      },
      update: {
        $set: {
          commodity:  r.Commodity  || r.commodity  || '',
          crop:       r.Commodity  || r.commodity  || '',
          variety:    r.Variety    || r.variety     || '',
          market:     r.Market     || r.market      || '',
          mandi:      r.Market     || r.market      || '',
          state:      r.State      || r.state       || r.state_name || '',
          district:   r.District   || r.district    || r.district_name || '',
          minPrice:   parseFloat(r.Min_x0020_Price   || r.Min_Price   || r.min_price || 0),
          maxPrice:   parseFloat(r.Max_x0020_Price   || r.Max_Price   || r.max_price || 0),
          modalPrice: parseFloat(r.Modal_x0020_Price || r.Modal_Price || r.modal_price || 0),
          unit:       r.Unit || r.unit || 'Quintal',
          priceDate:  (() => {
            const raw = r.Arrival_Date || r.arrival_date;
            if (!raw) return new Date();
            const d = new Date(raw);
            return isNaN(d.getTime()) ? new Date() : d;
          })(),
          source:     'AGMARKNET',
        },
      },
      upsert: true,
    },
  }));

  if (bulkOps.length) {
    await MandiPrice.bulkWrite(bulkOps);
    logger.info(`✅ Mandi: Synced ${bulkOps.length} valid records to cache.`);
  }
  return validRecords;
};

/**
 * Normalize a raw API record or DB document to the frontend shape:
 * { commodity, market, state, minPrice, maxPrice, modalPrice, unit, priceDate }
 */
const normalize = (r, isDbRecord = false) => {
  if (isDbRecord) {
    return {
      id:         r._id,
      commodity:  r.commodity  || 'Unknown',
      variety:    r.variety    || '',
      market:     r.market     || 'Unknown',
      mandi:      r.mandi      || r.market || 'Unknown',
      state:      r.state      || '',
      district:   r.district   || '',
      minPrice:   r.minPrice   || 0,
      maxPrice:   r.maxPrice   || 0,
      modalPrice: r.modalPrice || 0,
      unit:       r.unit       || 'Quintal',
      priceDate:  r.priceDate,
      source:     r.source     || 'DB',
    };
  }

  // Raw API records have varying capitalizations and key names
  const commodity = r.Commodity || r.commodity || r.Crop || r.crop || 'Unknown';
  const market    = r.Market    || r.market    || r.Mandi || r.mandi || 'Unknown';
  const modal     = parseFloat(r.Modal_x0020_Price || r.Modal_Price || r.modal_price || 0);

  return {
    commodity,
    variety:    r.Variety    || r.variety     || '',
    market,
    mandi:      market,
    state:      r.State      || r.state       || r.state_name    || '',
    district:   r.District   || r.district    || r.district_name || '',
    minPrice:   parseFloat(r.Min_x0020_Price || r.Min_Price || r.min_price || 0),
    maxPrice:   parseFloat(r.Max_x0020_Price || r.Max_Price || r.max_price || 0),
    modalPrice: modal,
    unit:       r.Unit || r.unit || 'Quintal',
    priceDate:  r.Arrival_Date || r.arrival_date || new Date().toISOString(),
    source:     'AGMARKNET',
  };
};

// Global tracker for throttle
let lastSuccessfulFetch = 0;
const FETCH_COOLDOWN = 60 * 60 * 1000; // 1 hour

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

    const now = Date.now();
    const isCooldownActive = (now - lastSuccessfulFetch < FETCH_COOLDOWN);
    const forceLive = useCache !== 'true' && !isCooldownActive;

    // Helper to get DB records
    const getCachedData = async () => {
      const filter = {};
      if (commodity) filter.commodity = { $regex: commodity, $options: 'i' };
      if (state)     filter.state     = { $regex: state,     $options: 'i' };
      if (district)  filter.district  = { $regex: district,  $options: 'i' };
      
      // Expand window to 90 days as Agmarknet updates can be irregular
      filter.priceDate = { $gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) };

      const [dbPrices, total] = await Promise.all([
        MandiPrice.find(filter)
          .sort({ priceDate: -1 })
          .skip(parseInt(skip))
          .limit(parseInt(limit))
          .lean(),
        MandiPrice.countDocuments(filter),
      ]);
      return { dbPrices, total };
    };

    // Stale-While-Revalidate Strategy
    const { dbPrices, total } = await getCachedData();

    if (forceLive) {
      logger.info(`🔄 Mandi: Triggering background sync for ${state}${commodity ? ' - ' + commodity : ''}`);
      fetchAndSyncFromAPI({ commodity, state, district, limit: parseInt(limit) })
        .then((live) => {
          if (live.length > 0) {
            lastSuccessfulFetch = Date.now();
            logger.info(`✅ Mandi: Background sync completed (${live.length} records). First crop: ${live[0].Commodity || live[0].commodity}`);
          }
        })
        .catch((err) => {
          if (err.response?.status === 429) {
            lastSuccessfulFetch = Date.now() - (FETCH_COOLDOWN - 10 * 60 * 1000);
            logger.warn(`⚠️ Mandi API Rate Limited (429). Throttling background sync.`);
          } else {
            logger.warn(`⚠️ Mandi Background sync failed: ${err.message}`);
          }
        });
    }

    if (dbPrices.length > 0) {
      const normalized = dbPrices.map((r) => normalize(r, true));
      logger.info(`📦 Mandi: Returning ${normalized.length} records from cache.`);
      return res.status(200).json({
        success: true,
        data:    normalized,
        source:  'cache',
        total,
        isStale: forceLive,
        pagination: { total, skip: parseInt(skip), limit: parseInt(limit) },
      });
    }

    // If absolutely no cache, we MUST wait for live data (first time or empty DB)
    if (useCache !== 'true') {
      try {
        logger.info(`📡 Mandi: Cache empty, performing blocking live fetch for ${state}`);
        const liveData = await fetchAndSyncFromAPI({ commodity, state, district, limit: parseInt(limit) });
        
        // Validation: Ensure the records returned are actually usable (not Unknown/0)
        const validNormalized = liveData
          .map((r) => normalize(r, false))
          .filter(r => r.commodity !== 'Unknown' && r.modalPrice > 0);

        if (validNormalized.length > 0) {
          lastSuccessfulFetch = Date.now();
          logger.info(`✨ Mandi: Live fetch successful, returning ${validNormalized.length} records.`);
          return res.status(200).json({
            success: true,
            data:    validNormalized,
            source:  'live',
            total:   validNormalized.length,
          });
        } else {
          logger.warn(`⚠️ Mandi: Live fetch returned ${liveData.length} records but 0 passed final normalization for ${state}`);
        }
      } catch (err) {
        logger.warn(`⚠️ Mandi API fail on empty DB: ${err.message}`);
      }
    }

    // Absolute fallback: static mock
    logger.info(`⚠️ Mandi: All fetch methods failed or returned empty. Using mock data.`);
    const mocks = getMockPrices();
    return res.status(200).json({
      success: true,
      data:    mocks,
      source:  'mock',
      total:   mocks.length,
    });

  } catch (err) {
    logger.error('getPrices error:', err);
    return res.status(500).json({
      success: false,
      error:   'Failed to fetch mandi prices',
      data:    getMockPrices(),
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

// ─── POST /api/v1/mandi/recommendation ──────────────────────────────────────
const getPriceRecommendation = async (req, res) => {
  try {
    const { cropName, qualityGrade = 'A', location } = req.body;

    if (!cropName) {
      return res.status(400).json({ success: false, error: 'cropName is required' });
    }

    const recommendation = await AIService.getPriceRecommendation(cropName, qualityGrade, location);

    if (!recommendation || recommendation.success === false) {
      return res.status(400).json({ success: false, error: recommendation?.message || 'Unable to generate recommendation' });
    }

    return res.status(200).json({ success: true, data: recommendation });
  } catch (err) {
    logger.error('getPriceRecommendation error:', err);
    return res.status(500).json({ success: false, error: 'Failed to generate price recommendation' });
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

module.exports = { getPrices, getPriceTrends, getPriceRecommendation, syncMandiPrices };