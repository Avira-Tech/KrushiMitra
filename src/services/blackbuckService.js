const logger = require('../utils/logger');

class BlackBuckService {
  /**
   * Get delivery quote for heavy/inter-city transport
   */
  static async getQuote({ pickupLat, pickupLng, dropLat, dropLng, weight, distance }) {
    try {
      // Mocking BlackBuck API response
      // Base rate for heavy trucks is higher, but rate per km might be lower for long distance
      const baseFare = 2000;
      const distanceCharge = distance * 15; // ₹15 per km
      const weightCharge = weight * 1.5;   // ₹1.5 per kg
      
      const totalFare = baseFare + distanceCharge + weightCharge;

      return {
        success: true,
        provider: 'blackbuck',
        vehicles: [{
          type: 'Full Truck (10 Ton)',
          fare: totalFare,
          eta: { pickup: 120, drop: Math.round(distance * 2) + 120 }, // ETA in minutes
        }],
        isMock: true
      };
    } catch (error) {
      logger.error('BlackBuckService.getQuote error:', error.message);
      throw error;
    }
  }

  /**
   * Create BlackBuck order
   */
  static async createOrder({ contract, distance }) {
    try {
      const orderId = `BB-${contract._id}-${Date.now()}`;
      logger.info(`BlackBuck order created: ${orderId} for distance ${distance}km`);
      
      return {
        success: true,
        orderId,
        trackingId: `TRK-BB-${Math.floor(Math.random() * 1000000)}`,
        status: 'scheduled',
        provider: 'blackbuck',
        driverName: 'Harpreet Singh',
        driverPhone: '+91 99887 76655',
        vehicleNumber: 'PB-10-XY-2026',
        vehicleType: '10 Ton Full Truck',
      };
    } catch (error) {
      logger.error('BlackBuckService.createOrder error:', error.message);
      throw error;
    }
  }
}

module.exports = BlackBuckService;
