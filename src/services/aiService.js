const logger = require('../utils/logger');
const MandiService = require('./mandiService');

class AIService {
  /**
   * AI-powered price recommendation
   * Uses mandi trend analysis + quality multiplier + seasonality
   */
  static async getPriceRecommendation(cropName, qualityGrade = 'A', location = null) {
    try {
      const recommendation = await MandiService.getAIPriceRecommendation(cropName, qualityGrade);

      if (!recommendation?.recommendedPrice) {
        return { success: false, message: 'Insufficient data for recommendation' };
      }

      // Apply seasonality adjustment
      const seasonalMultiplier = this.getSeasonalMultiplier(cropName);
      const adjustedPrice = parseFloat((recommendation.recommendedPrice * seasonalMultiplier).toFixed(2));

      return {
        success: true,
        cropName,
        qualityGrade,
        recommendedPrice: adjustedPrice,
        priceRange: {
          min: parseFloat((adjustedPrice * 0.9).toFixed(2)),
          max: parseFloat((adjustedPrice * 1.1).toFixed(2)),
        },
        basedOnMandiPrice: recommendation.averageMandiPrice,
        confidence: recommendation.confidence,
        seasonalFactor: seasonalMultiplier,
        insights: this.generatePriceInsights(cropName, adjustedPrice, recommendation),
        generatedAt: new Date().toISOString(),
        disclaimer: 'AI recommendation based on mandi trends. Market prices may vary.',
      };
    } catch (error) {
      logger.error('AIService.getPriceRecommendation error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Simulate crop quality detection from image
   * In production: integrate with Google Vision API or custom ML model
   */
  static async detectCropQuality(imageUrl, cropName) {
    try {
      // Simulate ML processing delay
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Mock quality detection results
      const grades = ['A', 'B', 'C'];
      const weights = [0.5, 0.35, 0.15]; // Probability distribution
      const random = Math.random();
      let grade;
      if (random < weights[0]) grade = 'A';
      else if (random < weights[0] + weights[1]) grade = 'B';
      else grade = 'C';

      const confidence = 0.75 + Math.random() * 0.2;

      return {
        success: true,
        cropName,
        grade,
        confidence: parseFloat(confidence.toFixed(2)),
        details: {
          color: grade === 'A' ? 'Uniform, vibrant' : grade === 'B' ? 'Mostly uniform' : 'Some discoloration',
          texture: grade === 'A' ? 'Smooth, intact' : grade === 'B' ? 'Minor blemishes' : 'Visible defects',
          size: grade === 'A' ? 'Consistent sizing' : grade === 'B' ? 'Slight variation' : 'Inconsistent',
          foreignMatter: grade === 'A' ? 'None detected' : grade === 'B' ? 'Minimal (<2%)' : 'Present (>2%)',
          moistureEstimate: grade === 'A' ? '12-14%' : grade === 'B' ? '14-16%' : '>16%',
        },
        recommendations: this.getQualityRecommendations(grade, cropName),
        priceImpact: grade === 'A' ? '+10%' : grade === 'B' ? '0%' : '-10%',
        analyzedAt: new Date().toISOString(),
        model: 'KrushiMitra-QualityNet-v1.0',
        note: 'AI analysis is indicative. Physical inspection recommended for final grading.',
      };
    } catch (error) {
      logger.error('AIService.detectCropQuality error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate demand forecast for a crop
   */
  static async getDemandForecast(cropName, location) {
    const trends = {
      Wheat: { demand: 'High', trend: 'Stable', seasonalPeak: 'March-May' },
      Rice: { demand: 'Very High', trend: 'Rising', seasonalPeak: 'October-December' },
      Cotton: { demand: 'High', trend: 'Stable', seasonalPeak: 'October-January' },
      Tomato: { demand: 'Medium', trend: 'Volatile', seasonalPeak: 'November-February' },
      Onion: { demand: 'High', trend: 'Rising', seasonalPeak: 'Year-round' },
      Groundnut: { demand: 'High', trend: 'Stable', seasonalPeak: 'November-February' },
    };

    const data = trends[cropName] || { demand: 'Medium', trend: 'Stable', seasonalPeak: 'Varies' };

    return {
      cropName,
      ...data,
      nearbyBuyers: Math.floor(10 + Math.random() * 40),
      averageWaitTime: `${Math.floor(2 + Math.random() * 10)} days`,
      recommendation: data.demand === 'High' || data.demand === 'Very High'
        ? 'Good time to list. High buyer demand in your area.'
        : 'Moderate demand. Consider competitive pricing.',
    };
  }

  static getSeasonalMultiplier(cropName) {
    const month = new Date().getMonth() + 1;
    const seasonalData = {
      Wheat: { peak: [3, 4, 5], low: [9, 10, 11] },
      Rice: { peak: [10, 11, 12], low: [4, 5, 6] },
      Cotton: { peak: [10, 11, 12, 1], low: [5, 6, 7] },
      Tomato: { peak: [11, 12, 1, 2], low: [6, 7, 8] },
      Onion: { peak: [1, 2, 3], low: [7, 8, 9] },
    };
    const data = seasonalData[cropName];
    if (!data) return 1.0;
    if (data.peak.includes(month)) return 1.1;
    if (data.low.includes(month)) return 0.92;
    return 1.0;
  }

  static generatePriceInsights(cropName, price, recommendation) {
    return [
      `Based on ${recommendation.basedOn} mandi markets, average modal price is ₹${recommendation.averageMandiPrice}/quintal`,
      `Recommended ₹${price}/kg (${recommendation.confidence} confidence)`,
      `Grade ${recommendation.qualityGrade || 'A'} premium applied`,
      `Seasonal adjustment: ${this.getSeasonalMultiplier(cropName) > 1 ? 'Peak season (+10%)' : this.getSeasonalMultiplier(cropName) < 1 ? 'Off-season (-8%)' : 'Normal season'}`,
    ];
  }

  static getQualityRecommendations(grade, cropName) {
    const recs = {
      A: ['Store in cool, dry place to maintain premium grade', 'List immediately for best price', 'Target export/premium buyers'],
      B: ['Proper drying can improve grade', 'Competitive pricing recommended', 'Suitable for bulk buyers'],
      C: ['Consider processing/value addition', 'Price competitively', 'Target local markets'],
    };
    return recs[grade] || recs.B;
  }
}

module.exports = AIService;

