const axios = require('axios');
const logger = require('../utils/logger');

const PORTER_BASE = process.env.PORTER_BASE_URL || 'https://pfe-apigw-uat.porter.in';
const PORTER_API_KEY = process.env.PORTER_API_KEY;

class PorterService {
  static getHeaders() {
    return {
      'x-api-key': PORTER_API_KEY,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Get delivery quote
   */
  static async getQuote({ pickupLat, pickupLng, dropLat, dropLng, weight }) {
    try {
      const response = await axios.post(
        `${PORTER_BASE}/v1/get_quote`,
        {
          pickup_details: { lat: pickupLat, lng: pickupLng },
          drop_details: { lat: dropLat, lng: dropLng },
          customer: { name: 'KrushiMitra', mobile: { country_code: '+91', number: '9999999999' } },
          order_payload: [{ size: { weight_in_grams: weight * 1000 } }],
        },
        { headers: this.getHeaders(), timeout: 10000 }
      );
      return response.data;
    } catch (error) {
      logger.error('PorterService.getQuote error:', error.message);
      return this.getMockQuote(weight);
    }
  }

  /**
   * Create delivery order
   */
  static async createOrder({ contract, pickupAddress, dropAddress, farmerPhone, buyerPhone }) {
    try {
      const response = await axios.post(
        `${PORTER_BASE}/v1/orders`,
        {
          request_id: `KM-${contract._id}-${Date.now()}`,
          pickup_details: {
            address: {
              apartment_address: pickupAddress,
              google_place_id: '',
              lat: contract.farmer?.location?.coordinates?.[1] || 23.0225,
              lng: contract.farmer?.location?.coordinates?.[0] || 72.5714,
            },
            contact: {
              name: contract.terms?.cropName || 'Farmer',
              mobile: { country_code: '+91', number: farmerPhone?.replace(/\D/g, '').slice(-10) },
            },
          },
          drop_details: {
            address: { apartment_address: dropAddress },
            contact: {
              name: contract.terms?.buyerName || 'Buyer',
              mobile: { country_code: '+91', number: buyerPhone?.replace(/\D/g, '').slice(-10) },
            },
          },
          customer: {
            name: 'KrushiMitra',
            mobile: { country_code: '+91', number: '9999999999' },
          },
          order_payload: [{
            description: `${contract.terms?.cropName} - ${contract.terms?.quantity}kg`,
            quantity: 1,
            size: { weight_in_grams: (contract.terms?.quantity || 100) * 1000 },
          }],
        },
        { headers: this.getHeaders(), timeout: 15000 }
      );

      return {
        success: true,
        orderId: response.data?.order_id,
        trackingId: response.data?.tracking_url,
        estimatedTime: response.data?.estimated_pickup_time,
        fare: response.data?.fare,
        data: response.data,
      };
    } catch (error) {
      logger.error('PorterService.createOrder error:', error.message);
      return this.getMockOrder(contract);
    }
  }

  /**
   * Track delivery order
   */
  static async trackOrder(orderId) {
    try {
      const response = await axios.get(
        `${PORTER_BASE}/v1/orders/${orderId}`,
        { headers: this.getHeaders(), timeout: 10000 }
      );
      return response.data;
    } catch (error) {
      logger.error('PorterService.trackOrder error:', error.message);
      return this.getMockTracking(orderId);
    }
  }

  /**
   * Cancel delivery order
   */
  static async cancelOrder(orderId, reason) {
    try {
      const response = await axios.post(
        `${PORTER_BASE}/v1/orders/${orderId}/cancel`,
        { reason },
        { headers: this.getHeaders(), timeout: 10000 }
      );
      return { success: true, data: response.data };
    } catch (error) {
      logger.error('PorterService.cancelOrder error:', error.message);
      return { success: false, error: error.message };
    }
  }

  static getMockQuote(weight) {
    const baseFare = 500;
    const weightCharge = weight * 2;
    return {
      isMock: true,
      vehicles: [{
        type: 'Mini Truck',
        fare: { minor_amount: (baseFare + weightCharge) * 100 },
        eta: { pickup: 60, drop: 180 },
      }],
    };
  }

  static getMockOrder(contract) {
    const orderId = `PTR-${Date.now()}`;
    return {
      success: true,
      orderId,
      trackingId: orderId,
      estimatedTime: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      fare: { minor_amount: 150000 }, // ₹1500
      isMock: true,
    };
  }

  static getMockTracking(orderId) {
    return {
      orderId,
      status: 'in_transit',
      driverName: 'Rajesh Kumar',
      driverPhone: '+91 98765 43210',
      vehicleNumber: 'GJ-01-AB-1234',
      currentLocation: { lat: 23.0225, lng: 72.5714 },
      estimatedDelivery: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      isMock: true,
    };
  }
}

module.exports = PorterService;
