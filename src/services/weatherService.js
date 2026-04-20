'use strict';
/**
 * weatherService.js
 *
 * Uses Weatherstack API: https://api.weatherstack.com/current
 * API Key: from process.env.WEATHERSTACK_API_KEY
 *
 * Returns a flat object matching WeatherScreen's expectations:
 * { city, temperature, humidity, windSpeed, rainChance, description,
 *   icon, alerts[], forecast[], harvestSuggestion, pestAlert }
 */

const axios  = require('axios');
const logger = require('../utils/logger');

const BASE_URL = 'http://api.weatherstack.com';
const API_KEY  = process.env.WEATHERSTACK_API_KEY || '8023768e3ec3bbbccc6b3df1eec6ccc7';

class WeatherService {
  // ─── Get weather by lat/lng ─────────────────────────────────────────────────
  static async getWeatherByCoords(lat, lng) {
    try {
      const response = await axios.get(`${BASE_URL}/current`, {
        params: {
          access_key: API_KEY,
          query:      `${lat},${lng}`,
          units:      'm',
        },
        timeout: 10_000,
      });

      if (response.data?.error) {
        logger.warn(`Weatherstack error: ${JSON.stringify(response.data.error)}`);
        return WeatherService.getMockWeatherData(null, null, `${lat},${lng}`);
      }

      return WeatherService.format(response.data);
    } catch (err) {
      const msg = err?.message || err?.response?.data?.error?.info || String(err);
      // 429 = Weatherstack free-plan rate limit — log as warning, not error
      if (err?.response?.status === 429 || msg.includes('429')) {
        logger.warn('Weatherstack rate limit (429) — returning mock weather data');
      } else {
        logger.error('WeatherService.getWeatherByCoords error: ' + msg);
      }
      return WeatherService.getMockWeatherData(lat, lng);
    }
  }

  // ─── Get weather by city name ───────────────────────────────────────────────
  static async getWeatherByCity(city) {
    try {
      const response = await axios.get(`${BASE_URL}/current`, {
        params: {
          access_key: API_KEY,
          query:      city,
          units:      'm',
        },
        timeout: 10_000,
      });

      if (response.data?.error) {
        logger.warn(`Weatherstack city error: ${JSON.stringify(response.data.error)}`);
        return WeatherService.getMockWeatherData(null, null, city);
      }

      return WeatherService.format(response.data);
    } catch (err) {
      const msg = err?.message || err?.response?.data?.error?.info || String(err);
      if (err?.response?.status === 429 || msg.includes('429')) {
        logger.warn('Weatherstack rate limit (429) — returning mock weather data');
      } else {
        logger.error('WeatherService.getWeatherByCity error: ' + msg);
      }
      return WeatherService.getMockWeatherData(null, null, city);
    }
  }

  // ─── Format Weatherstack response into the app shape ───────────────────────
  static format(data) {
    const cur      = data.current  || {};
    const loc      = data.location || {};
    const precip   = parseFloat(cur.precip || 0);
    const temp     = parseFloat(cur.temperature || 25);
    const humidity = parseFloat(cur.humidity   || 50);
    const wind     = parseFloat(cur.wind_speed || 10);

    // Weatherstack free plan doesn't give forecast — generate plausible 7-day mock
    const forecast = WeatherService.generateForecast(temp, humidity);

    // Farming alerts
    const alerts = WeatherService.buildAlerts(temp, humidity, precip, wind);

    return {
      city:        loc.name    || 'Unknown',
      country:     loc.country || 'IN',
      region:      loc.region  || '',
      localtime:   loc.localtime || new Date().toISOString(),
      coordinates: {
        lat: parseFloat(loc.lat || 0),
        lng: parseFloat(loc.lon || 0),
      },

      // Flat fields WeatherScreen reads directly
      temperature:  Math.round(temp),
      feelsLike:    Math.round(parseFloat(cur.feelslike || temp)),
      humidity:     Math.round(humidity),
      windSpeed:    Math.round(wind),
      windDirection: cur.wind_dir || 'N',
      pressure:     parseFloat(cur.pressure   || 1013),
      visibility:   parseFloat(cur.visibility || 10),
      uvIndex:      parseFloat(cur.uv_index   || 3),
      cloudCover:   parseFloat(cur.cloudcover || 20),
      rainChance:   WeatherService.estimateRainChance(precip, humidity, cur.cloudcover),
      description:  (cur.weather_descriptions || ['Clear'])[0],
      icon:         WeatherService.mapIcon(cur.weather_code),

      // Farming intelligence
      alerts,
      forecast,
      harvestSuggestion: WeatherService.harvestTip(precip, humidity, temp),
      pestAlert:         WeatherService.pestTip(humidity, temp),
      irrigationAdvice:  WeatherService.irrigationTip(temp, humidity, precip),
      updatedAt:         new Date().toISOString(),
      source:            'weatherstack',
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────
  static estimateRainChance(precip, humidity, cloudcover = 20) {
    if (precip > 5)   return Math.min(100, 75 + precip * 2);
    if (precip > 0)   return Math.min(100, 60 + precip * 5);
    const fromHumid = humidity * 0.4;
    const fromCloud = parseFloat(cloudcover) * 0.25;
    return Math.round(Math.min(100, fromHumid + fromCloud));
  }

  // Map Weatherstack weather_code to OpenWeather-style icon codes the app uses
  static mapIcon(code) {
    if (!code) return '01d';
    const c = parseInt(code);
    if (c === 113)             return '01d'; // Sunny/Clear
    if ([116, 119].includes(c))return '02d'; // Partly cloudy
    if ([122, 143].includes(c))return '03d'; // Overcast / Mist
    if ([176, 263, 281, 296, 302, 308, 311, 314, 317, 320, 323, 326, 329, 332, 335, 338, 350, 353, 356, 359, 362, 365, 374, 377].includes(c)) return '10d'; // Rain
    if ([200, 386, 389, 392, 395].includes(c)) return '11d'; // Thunderstorm
    if ([179, 182, 185, 227, 230, 368, 371].includes(c)) return '13d'; // Snow
    if ([248, 260].includes(c)) return '50d'; // Fog
    return '02d';
  }

  static generateForecast(baseTemp, baseHumid) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const icons = ['01d', '02d', '01d', '10d', '02d', '01d', '03d'];
    return days.map((day, i) => ({
      day,
      date:      new Date(Date.now() + i * 86_400_000).toISOString().split('T')[0],
      temp:      Math.round(baseTemp + (Math.random() * 6 - 3)),
      tempMin:   Math.round(baseTemp - 4 + (Math.random() * 2)),
      tempMax:   Math.round(baseTemp + 4 + (Math.random() * 2)),
      humidity:  Math.round(baseHumid + (Math.random() * 10 - 5)),
      rain:      Math.random() > 0.7 ? Math.round(Math.random() * 20) : 0,
      rainChance:Math.floor(Math.random() * 50),
      icon:      icons[i],
      description: 'Partly cloudy',
    }));
  }

  static buildAlerts(temp, humidity, precip, wind) {
    const alerts = [];
    if (temp > 38)    alerts.push({ severity: 'danger',  message: `Extreme heat (${Math.round(temp)}°C). Water crops early morning. Avoid midday spraying.` });
    if (precip > 10)  alerts.push({ severity: 'danger',  message: 'Heavy rain detected. Harvest sensitive crops immediately and cover storage.' });
    if (humidity > 82) alerts.push({ severity: 'warning', message: `High humidity (${Math.round(humidity)}%). Risk of fungal disease. Monitor crops closely.` });
    if (wind > 40)    alerts.push({ severity: 'warning', message: `Strong winds (${Math.round(wind)} km/h). Secure greenhouse covers and delay spraying.` });
    return alerts;
  }

  static harvestTip(precip, humidity, temp) {
    if (precip > 5)  return 'Postpone harvest — rain reduces quality and causes spoilage.';
    if (humidity > 80) return 'High humidity present. Harvest and dry quickly to prevent mould.';
    if (temp > 38)   return 'Harvest early morning to avoid heat stress on produce.';
    return 'Clear skies and moderate humidity — ideal conditions for harvesting.';
  }

  static pestTip(humidity, temp) {
    if (humidity > 80 && temp > 25) return 'High risk of fungal growth and aphid infestation. Apply preventive fungicide.';
    if (humidity > 70)              return 'Moderate pest risk. Inspect undersides of leaves for early signs.';
    return 'Pest risk is low. Routine weekly monitoring is sufficient.';
  }

  static irrigationTip(temp, humidity, precip) {
    if (precip > 5)  return 'Skip irrigation — natural rainfall is sufficient.';
    if (temp > 35)   return 'Irrigate in early morning or after sunset to reduce evaporation.';
    if (humidity < 40) return 'Low humidity detected. Increase irrigation frequency.';
    return 'Normal irrigation schedule. Check soil moisture before watering.';
  }

  // ─── Mock (always same structure as real response) ──────────────────────────
  static getMockWeatherData(lat, lng, city = 'Ahmedabad') {
    const forecast = WeatherService.generateForecast(28, 45);
    return {
      city,
      country:    'IN',
      coordinates: { lat: lat || 23.0225, lng: lng || 72.5714 },
      temperature:  28,
      feelsLike:    30,
      humidity:     45,
      windSpeed:    12,
      windDirection:'NW',
      pressure:     1013,
      visibility:   10,
      uvIndex:      6,
      cloudCover:   20,
      rainChance:   10,
      description:  'Clear Sky',
      icon:         '01d',
      alerts:       [],
      forecast,
      harvestSuggestion: 'Clear skies — ideal harvesting conditions.',
      pestAlert:         'Pest risk is low.',
      irrigationAdvice:  'Normal irrigation schedule.',
      updatedAt:         new Date().toISOString(),
      source:            'mock',
    };
  }
}

module.exports = WeatherService;