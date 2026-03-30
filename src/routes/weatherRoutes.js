const express = require('express');
const router = express.Router();
const { optionalAuth } = require('../middlewares/auth');
const { getWeatherByCoords, getWeatherByCity } = require('../controllers/weatherController');

router.get('/', optionalAuth, getWeatherByCoords);
router.get('/city/:city', optionalAuth, getWeatherByCity);

module.exports = router;
