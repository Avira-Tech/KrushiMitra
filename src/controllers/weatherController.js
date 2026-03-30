const WeatherService = require('../services/weatherService');
const { sendSuccess, sendError } = require('../utils/apiResponse');

const getWeatherByCoords = async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return sendError(res, { message: 'lat and lng are required', statusCode: 400 });
  const weather = await WeatherService.getWeatherByCoords(parseFloat(lat), parseFloat(lng));
  return sendSuccess(res, { data: { weather } });
};

const getWeatherByCity = async (req, res) => {
  const { city } = req.params;
  const weather = await WeatherService.getWeatherByCity(city);
  return sendSuccess(res, { data: { weather } });
};

module.exports = { getWeatherByCoords, getWeatherByCity };
