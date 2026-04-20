const express = require('express');
const router = express.Router();
const { getPrices, getPriceTrends, getPriceRecommendation } = require('../controllers/mandiController');

// Public routes (no auth required)
router.get('/prices', getPrices);
router.get('/trends', getPriceTrends);
router.post('/recommendation', getPriceRecommendation);

module.exports = router;
