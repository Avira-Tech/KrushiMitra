const axios = require('axios');
const MandiPrice = require('../models/MandiPrice');
const logger = require('../utils/logger');

const AGMARKNET_BASE = process.env.AGMARKNET_BASE_URL || 'https://api.data.gov.in/resource';
const AGMARKNET_RESOURCE_ID = '35985678-0d79-46b4-9ed6-6f13308a1d24'; // Updated ID
const API_KEY = process.env.AGMARKNET_API_KEY;

class MandiService {
  /**
   * Fetch and cache mandi prices from AGMARKNET
   */
  static async fetchAndCachePrices(state = 'Gujarat', limit = 100) {
    try {
      const response = await axios.get(`${AGMARKNET_BASE}/${AGMARKNET_RESOURCE_ID}`, {
        params: {
          'api-key': API_KEY,
          format: 'json',
          limit,
          'filters[state]': state,
        },
        timeout: 15000,
      });

      const records = response.data?.records || [];

      // Filter out invalid records (e.g. schema mismatches)
      const validRecords = records.filter((r) => {
        const hasCommodity = !!(r.Commodity || r.commodity || r.Crop || r.crop);
        const hasPrice = !!(
          r.Modal_Price ||
          r.modal_price ||
          r.Modal_x0020_Price ||
          r.Max_Price ||
          r.Min_Price
        );
        return hasCommodity && hasPrice;
      });

      if (validRecords.length === 0 && records.length > 0) {
        logger.warn(
          `MandiService: Received ${records.length} records but 0 passed validation for ${state}`,
        );
        return { success: false, error: 'Source data schema mismatch' };
      }

      const bulkOps = validRecords.map((record) => ({
        updateOne: {
          filter: {
            commodity: record.Commodity || record.commodity || 'Unknown',
            market: record.Market || record.market || 'Unknown',
            priceDate: (() => {
              const raw = record.Arrival_Date || record.arrival_date;
              if (!raw) return new Date();
              const d = new Date(raw);
              return isNaN(d.getTime()) ? new Date() : d;
            })(),
          },
          update: {
            $set: {
              commodity: record.Commodity || record.commodity || '',
              crop: record.Commodity || record.commodity || '',
              variety: record.Variety || record.variety || '',
              market: record.Market || record.market || '',
              mandi: record.Market || record.market || '',
              state: record.State || record.state || record.state_name || '',
              district: record.District || record.district || record.district_name || '',
              minPrice: parseFloat(
                record.Min_x0020_Price || record.Min_Price || record.min_price || 0,
              ),
              maxPrice: parseFloat(
                record.Max_x0020_Price || record.Max_Price || record.max_price || 0,
              ),
              modalPrice: parseFloat(
                record.Modal_x0020_Price || record.Modal_Price || record.modal_price || 0,
              ),
              unit: record.Unit || record.unit || 'Quintal',
              priceDate: (() => {
                const raw = record.Arrival_Date || record.arrival_date;
                if (!raw) return new Date();
                const d = new Date(raw);
                return isNaN(d.getTime()) ? new Date() : d;
              })(),
              source: 'AGMARKNET',
            },
          },
          upsert: true,
        },
      }));

      if (bulkOps.length > 0) {
        await MandiPrice.bulkWrite(bulkOps);
        logger.info(`✅ MandiService: Cached ${bulkOps.length} valid records for ${state}`);
      }

      return { success: true, count: bulkOps.length };
    } catch (error) {
      logger.error('MandiService.fetchAndCachePrices error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get latest mandi prices with filters
   */
  static async getPrices({ commodity, market, state, page = 1, limit = 50 }) {
    try {
      const query = {};
      if (commodity) query.commodity = new RegExp(commodity, 'i');
      if (market) query.market = new RegExp(market, 'i');
      if (state) query.state = new RegExp(state, 'i');

      // Get latest prices per commodity-market combination
      const prices = await MandiPrice.find(query)
        .sort({ priceDate: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

      const total = await MandiPrice.countDocuments(query);

      if (prices.length === 0) {
        return { prices: this.getMockMandiPrices(commodity), total: 8, isMock: true };
      }

      return { prices, total, isMock: false };
    } catch (error) {
      logger.error('MandiService.getPrices error:', error.message);
      return { prices: this.getMockMandiPrices(commodity), total: 8, isMock: true };
    }
  }

  /**
   * Get price history for a commodity
   */
  static async getPriceHistory(commodity, market, days = 30) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const history = await MandiPrice.find({
        commodity: new RegExp(commodity, 'i'),
        ...(market && { market: new RegExp(market, 'i') }),
        priceDate: { $gte: startDate },
      })
        .sort({ priceDate: 1 })
        .select('priceDate modalPrice minPrice maxPrice market')
        .lean();

      return history;
    } catch (error) {
      logger.error('MandiService.getPriceHistory error:', error.message);
      return [];
    }
  }

  /**
   * Get AI price recommendation for a crop
   */
  static async getAIPriceRecommendation(cropName, qualityGrade = 'A') {
    try {
      const { prices } = await this.getPrices({ commodity: cropName });
      const { generateAIPriceRecommendation } = require('../utils/helpers');
      const recommendation = generateAIPriceRecommendation(cropName, prices, qualityGrade);

      if (!recommendation) {
        return {
          recommendedPrice: null,
          message: 'Insufficient mandi data for recommendation',
          confidence: 'none',
        };
      }

      return {
        ...recommendation,
        cropName,
        qualityGrade,
        generatedAt: new Date().toISOString(),
        disclaimer: 'AI recommendation based on recent mandi trends. Actual prices may vary.',
      };
    } catch (error) {
      logger.error('MandiService.getAIPriceRecommendation error:', error.message);
      return null;
    }
  }

  static getMockMandiPrices(commodity) {
    const prices = [
      {
        commodity: 'Wheat',
        market: 'Ahmedabad',
        state: 'Gujarat',
        minPrice: 2100,
        maxPrice: 2300,
        modalPrice: 2200,
        unit: 'Quintal',
      },
      {
        commodity: 'Tomato',
        market: 'Ahmedabad',
        state: 'Gujarat',
        minPrice: 1500,
        maxPrice: 2000,
        modalPrice: 1800,
        unit: 'Quintal',
      },
      {
        commodity: 'Cotton',
        market: 'Rajkot',
        state: 'Gujarat',
        minPrice: 6000,
        maxPrice: 6800,
        modalPrice: 6500,
        unit: 'Quintal',
      },
      {
        commodity: 'Onion',
        market: 'Anand',
        state: 'Gujarat',
        minPrice: 2200,
        maxPrice: 2800,
        modalPrice: 2500,
        unit: 'Quintal',
      },
      {
        commodity: 'Rice',
        market: 'Mehsana',
        state: 'Gujarat',
        minPrice: 5000,
        maxPrice: 5800,
        modalPrice: 5500,
        unit: 'Quintal',
      },
      {
        commodity: 'Groundnut',
        market: 'Junagadh',
        state: 'Gujarat',
        minPrice: 8000,
        maxPrice: 9000,
        modalPrice: 8500,
        unit: 'Quintal',
      },
      {
        commodity: 'Potato',
        market: 'Surat',
        state: 'Gujarat',
        minPrice: 1200,
        maxPrice: 1600,
        modalPrice: 1400,
        unit: 'Quintal',
      },
      {
        commodity: 'Cumin',
        market: 'Unjha',
        state: 'Gujarat',
        minPrice: 18000,
        maxPrice: 22000,
        modalPrice: 20000,
        unit: 'Quintal',
      },
    ];
    if (commodity)
      return prices.filter((p) => p.commodity.toLowerCase().includes(commodity.toLowerCase()));
    return prices.map((p) => ({ ...p, priceDate: new Date(), source: 'MOCK', isMock: true }));
  }
}

module.exports = MandiService;
