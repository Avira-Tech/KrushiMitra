const MandiService = require('../services/mandiService');
const { sendSuccess, sendError } = require('../utils/apiResponse');

const getPrices = async (req, res) => {
  const { commodity, market, state, page, limit } = req.query;
  const result = await MandiService.getPrices({ commodity, market, state, page, limit });
  return sendSuccess(res, {
    message: result.isMock ? 'Mock data (API key not configured)' : 'Live mandi prices',
    data: { prices: result.prices, total: result.total, isMock: result.isMock },
  });
};

const getPriceHistory = async (req, res) => {
  const { commodity } = req.params;
  const { market, days = 30 } = req.query;
  const history = await MandiService.getPriceHistory(commodity, market, parseInt(days));
  return sendSuccess(res, { data: { history, commodity } });
};

const syncPrices = async (req, res) => {
  const { state = 'Gujarat' } = req.body;
  const result = await MandiService.fetchAndCachePrices(state);
  return sendSuccess(res, { message: 'Mandi prices synced', data: result });
};

module.exports = { getPrices, getPriceHistory, syncPrices };
