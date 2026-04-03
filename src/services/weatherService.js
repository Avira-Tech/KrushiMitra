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

// module.exports = WeatherService;
const axios = require('axios');
const logger = require('../utils/logger');

// Weatherstack uses a different base URL and param structure
const WEATHERSTACK_BASE = 'http://api.weatherstack.com';
const API_KEY = process.env.WEATHERSTACK_API_KEY; 

class WeatherService {
  /**
   * Get weather by coordinates using Weatherstack
   */
  static async getWeatherByCoords(lat, lng) {
    try {
      const response = await axios.get(`${WEATHERSTACK_BASE}/current`, {
        params: {
          access_key: API_KEY,
          query: `${lat},${lng}`, // Weatherstack accepts "lat,lng" in the query param
          units: 'm'
        },
        timeout: 8000,
      });

      if (response.data.error) throw new Error(response.data.error.info);

      return this.formatWeatherstackData(response.data);
    } catch (error) {
      logger.error('WeatherService.getWeatherByCoords error:', error.message);
      return this.getMockWeatherData(lat, lng);
    }
  }

  static formatWeatherstackData(data) {
    const current = data.current;
    const location = data.location;

    // Weatherstack current icons are URLs, but your frontend expects OpenWeather codes
    // We map them or pass them through. Here we use a safe fallback.
    const weatherData = {
      city: location.name,
      country: location.country,
      coordinates: { lat: parseFloat(location.lat), lng: parseFloat(location.lon) },
      // Flat structure for your specific Frontend state requirements
      temperature: current.temperature,
      humidity: current.humidity,
      windSpeed: current.wind_speed,
      rainChance: current.precip > 0 ? 80 : 10, // Weatherstack basic gives precip mm, not %
      description: current.weather_descriptions[0],
      icon: '01d', // Weatherstack uses different icons; defaulting to sunny/clear
      
      // Ensure these arrays exist even if empty to prevent .map() errors
      alerts: this.generateFarmingAlerts(current),
      forecast: this.generateMockForecast(), // Weatherstack Free lacks forecast
      
      // Farming specific insights
      harvestSuggestion: current.precip > 0 ? "Postpone harvest due to rain." : "Clear skies: Good for harvesting.",
      pestAlert: current.humidity > 80 ? "High risk of fungal growth." : "Pest risk is low.",
      updatedAt: new Date().toISOString(),
    };

    return weatherData;
  }

  static generateFarmingAlerts(current) {
    const alerts = [];
    if (current.temperature > 35) {
      alerts.push({
        severity: 'warning',
        message: "High temperature detected. Increase irrigation frequency."
      });
    }
    if (current.precip > 5) {
      alerts.push({
        severity: 'danger',
        message: "Heavy precipitation expected. Protect sensitive seedlings."
      });
    }
    return alerts;
  }

  static generateMockForecast() {
    // Weatherstack Basic/Standard doesn't give 7-day data easily
    // Generating dummy forecast so UI doesn't look empty
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return days.map(day => ({
      day,
      temp: 25 + Math.floor(Math.random() * 10),
      rain: Math.floor(Math.random() * 20),
      icon: '02d'
    }));
  }

  static getMockWeatherData(lat, lng, city = 'Ahmedabad') {
     // Ensure this returns the exact same object structure as formatWeatherstackData
     return {
        city: city,
        temperature: 30,
        humidity: 50,
        windSpeed: 10,
        rainChance: 5,
        description: "Clear Sky",
        icon: '01d',
        alerts: [],
        forecast: this.generateMockForecast(),
        harvestSuggestion: "Conditions are optimal for harvesting.",
        pestAlert: "No immediate pest threats detected.",
        updatedAt: new Date().toISOString()
     };
  }
}

module.exports = WeatherService;