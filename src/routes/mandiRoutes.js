const express = require('express');
const router = express.Router();
const { getPrices, getPriceTrends } = require('../controllers/mandiController');

// Public routes (no auth required)
router.get('/prices', getPrices);
router.get('/trends', getPriceTrends);

module.exports = router;
