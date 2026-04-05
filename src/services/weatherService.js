// const axios = require('axios');
// const logger = require('../utils/logger');

// const OPENWEATHER_BASE = 'https://api.openweathermap.org/data/2.5';
// const API_KEY = process.env.OPENWEATHER_API_KEY;

// class WeatherService {
//   /**
//    * Get current weather + 7-day forecast for coordinates
//    */
//   static async getWeatherByCoords(lat, lng) {
//     try {
//       const [currentRes, forecastRes, uvRes] = await Promise.allSettled([
//         axios.get(`${OPENWEATHER_BASE}/weather`, {
//           params: { lat, lon: lng, appid: API_KEY, units: 'metric', lang: 'en' },
//           timeout: 8000,
//         }),
//         axios.get(`${OPENWEATHER_BASE}/forecast`, {
//           params: { lat, lon: lng, appid: API_KEY, units: 'metric', cnt: 40 },
//           timeout: 8000,
//         }),
//         axios.get(`${OPENWEATHER_BASE}/uvi`, {
//           params: { lat, lon: lng, appid: API_KEY },
//           timeout: 5000,
//         }),
//       ]);

//       const current = currentRes.status === 'fulfilled' ? currentRes.value.data : null;
//       const forecast = forecastRes.status === 'fulfilled' ? forecastRes.value.data : null;
//       const uv = uvRes.status === 'fulfilled' ? uvRes.value.data : null;

//       if (!current) throw new Error('Weather data unavailable');

//       return this.formatWeatherData(current, forecast, uv);
//     } catch (error) {
//       logger.error('WeatherService.getWeatherByCoords error:', error.message);
//       return this.getMockWeatherData(lat, lng);
//     }
//   }

//   /**
//    * Get weather by city name
//    */
//   static async getWeatherByCity(city) {
//     try {
//       const [currentRes, forecastRes] = await Promise.all([
//         axios.get(`${OPENWEATHER_BASE}/weather`, {
//           params: { q: `${city},IN`, appid: API_KEY, units: 'metric' },
//           timeout: 8000,
//         }),
//         axios.get(`${OPENWEATHER_BASE}/forecast`, {
//           params: { q: `${city},IN`, appid: API_KEY, units: 'metric', cnt: 40 },
//           timeout: 8000,
//         }),
//       ]);
//       return this.formatWeatherData(currentRes.data, forecastRes.data, null);
//     } catch (error) {
//       logger.error('WeatherService.getWeatherByCity error:', error.message);
//       return this.getMockWeatherData(null, null, city);
//     }
//   }

//   static formatWeatherData(current, forecast, uv) {
//     const daily = this.aggregateDailyForecast(forecast?.list || []);

//     const weather = {
//       city: current.name,
//       country: current.sys?.country,
//       coordinates: { lat: current.coord?.lat, lng: current.coord?.lon },
//       current: {
//         temperature: Math.round(current.main.temp),
//         feelsLike: Math.round(current.main.feels_like),
//         humidity: current.main.humidity,
//         pressure: current.main.pressure,
//         windSpeed: Math.round(current.wind?.speed * 3.6), // m/s to km/h
//         windDirection: current.wind?.deg,
//         visibility: current.visibility ? Math.round(current.visibility / 1000) : null,
//         uvIndex: uv?.value || null,
//         description: current.weather[0]?.description,
//         icon: current.weather[0]?.icon,
//         main: current.weather[0]?.main,
//         cloudiness: current.clouds?.all,
//         rainChance: this.estimateRainChance(current),
//         sunrise: new Date(current.sys?.sunrise * 1000).toISOString(),
//         sunset: new Date(current.sys?.sunset * 1000).toISOString(),
//       },
//       forecast: daily,
//       alerts: this.generateFarmingAlerts(current, daily),
//       farmingInsights: this.generateFarmingInsights(current, daily),
//       updatedAt: new Date().toISOString(),
//     };

//     return weather;
//   }

//   static aggregateDailyForecast(list) {
//     const dailyMap = {};
//     list.forEach((item) => {
//       const date = item.dt_txt.split(' ')[0];
//       if (!dailyMap[date]) {
//         dailyMap[date] = { temps: [], humidity: [], rain: 0, icons: [], descriptions: [] };
//       }
//       dailyMap[date].temps.push(item.main.temp);
//       dailyMap[date].humidity.push(item.main.humidity);
//       dailyMap[date].rain += item.rain?.['3h'] || 0;
//       dailyMap[date].icons.push(item.weather[0]?.icon);
//       dailyMap[date].descriptions.push(item.weather[0]?.description);
//     });

//     return Object.entries(dailyMap).slice(0, 7).map(([date, data]) => ({
//       date,
//       day: new Date(date).toLocaleDateString('en-IN', { weekday: 'short' }),
//       tempMin: Math.round(Math.min(...data.temps)),
//       tempMax: Math.round(Math.max(...data.temps)),
//       humidity: Math.round(data.humidity.reduce((a, b) => a + b, 0) / data.humidity.length),
//       rain: parseFloat(data.rain.toFixed(1)),
//       rainChance: Math.min(100, Math.round((data.rain / 10) * 100)),
//       icon: data.icons[Math.floor(data.icons.length / 2)],
//       description: data.descriptions[Math.floor(data.descriptions.length / 2)],
//     }));
//   }

//   static estimateRainChance(current) {
//     const humidity = current.main?.humidity || 0;
//     const clouds = current.clouds?.all || 0;
//     const hasRain = current.rain || current.weather[0]?.main === 'Rain';
//     if (hasRain) return Math.min(100, 70 + humidity / 10);
//     return Math.min(100, Math.round((humidity * 0.4) + (clouds * 0.3)));
//   }

//   static generateFarmingAlerts(current, daily) {
//     const alerts = [];
//     const temp = current.main?.temp;
//     const humidity = current.main?.humidity;
//     const windSpeed = (current.wind?.speed || 0) * 3.6;

//     // Rain alert
//     const rainDays = daily.filter((d) => d.rainChance > 60).slice(0, 3);
//     if (rainDays.length > 0) {
//       alerts.push({
//         type: 'rain',
//         severity: rainDays[0].rainChance > 80 ? 'high' : 'medium',
//         message: `Heavy rain expected on ${rainDays.map((d) => d.day).join(', ')}. Harvest crops early and cover storage.`,
//         icon: '🌧️',
//       });
//     }

//     // Heat alert
//     if (temp > 40) {
//       alerts.push({
//         type: 'heat',
//         severity: 'high',
//         message: `Extreme heat (${Math.round(temp)}°C). Irrigate crops in early morning. Avoid pesticide application.`,
//         icon: '🌡️',
//       });
//     }

//     // High humidity - pest risk
//     if (humidity > 80) {
//       alerts.push({
//         type: 'pest',
//         severity: 'medium',
//         message: `High humidity (${humidity}%) increases risk of fungal diseases and pests. Monitor crops closely.`,
//         icon: '🐛',
//       });
//     }

//     // Wind alert
//     if (windSpeed > 40) {
//       alerts.push({
//         type: 'wind',
//         severity: 'high',
//         message: `Strong winds (${Math.round(windSpeed)} km/h). Secure loose structures and avoid spraying.`,
//         icon: '💨',
//       });
//     }

//     return alerts;
//   }

//   static generateFarmingInsights(current, daily) {
//     const temp = current.main?.temp;
//     const humidity = current.main?.humidity;
//     const rainDays = daily.filter((d) => d.rainChance > 50);

//     return {
//       harvestWindow: rainDays.length < 2 ? 'Good harvest window for next 3 days' : `Harvest before ${rainDays[0]?.day || 'rain'}`,
//       irrigationAdvice: temp > 30 ? 'Irrigate in early morning or evening to reduce evaporation' : 'Normal irrigation schedule',
//       pestRisk: humidity > 75 ? 'High' : humidity > 60 ? 'Medium' : 'Low',
//       pestAdvice: humidity > 75 ? 'Apply fungicide preventively. Monitor for aphids and whiteflies.' : 'Pest risk is low. Routine monitoring sufficient.',
//       fertilizerTiming: rainDays.length > 0 ? `Apply fertilizer 2 days before ${rainDays[0]?.day} rain for better absorption` : 'Apply fertilizer with irrigation for best results',
//       soilMoistureStatus: humidity > 70 ? 'Adequate' : 'Check soil moisture before irrigation',
//     };
//   }

//   static getMockWeatherData(lat, lng, city = 'Ahmedabad') {
//     return {
//       city,
//       country: 'IN',
//       coordinates: { lat: lat || 23.0225, lng: lng || 72.5714 },
//       current: {
//         temperature: 28,
//         feelsLike: 30,
//         humidity: 45,
//         pressure: 1013,
//         windSpeed: 12,
//         windDirection: 180,
//         visibility: 10,
//         uvIndex: 6,
//         description: 'Partly cloudy',
//         icon: '02d',
//         main: 'Clouds',
//         cloudiness: 40,
//         rainChance: 20,
//         sunrise: new Date().toISOString(),
//         sunset: new Date().toISOString(),
//       },
//       forecast: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => ({
//         date: new Date(Date.now() + i * 86400000).toISOString().split('T')[0],
//         day,
//         tempMin: 22 + Math.floor(Math.random() * 5),
//         tempMax: 30 + Math.floor(Math.random() * 8),
//         humidity: 40 + Math.floor(Math.random() * 30),
//         rain: Math.random() > 0.7 ? parseFloat((Math.random() * 20).toFixed(1)) : 0,
//         rainChance: Math.floor(Math.random() * 60),
//         icon: ['01d', '02d', '03d', '10d'][Math.floor(Math.random() * 4)],
//         description: 'Partly cloudy',
//       })),
//       alerts: [],
//       farmingInsights: {
//         harvestWindow: 'Good harvest window for next 3 days',
//         irrigationAdvice: 'Normal irrigation schedule',
//         pestRisk: 'Low',
//         pestAdvice: 'Pest risk is low. Routine monitoring sufficient.',
//         fertilizerTiming: 'Apply fertilizer with irrigation for best results',
//         soilMoistureStatus: 'Adequate',
//       },
//       updatedAt: new Date().toISOString(),
//       isMock: true,
//     };
//   }
// }

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
      logger.error('WeatherService.getWeatherByCoords error:', err.message);
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
      logger.error('WeatherService.getWeatherByCity error:', err.message);
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