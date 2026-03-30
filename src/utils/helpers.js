const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

/**
 * Generate 6-digit OTP
 */
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Haversine formula for distance between two GPS coordinates (in km)
 */
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Earth's radius in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return parseFloat((R * c).toFixed(2));
};

const toRad = (value) => (value * Math.PI) / 180;

/**
 * Build MongoDB geo query for nearby crops
 */
const buildGeoQuery = (lat, lng, radiusKm = 50) => ({
  location: {
    $near: {
      $geometry: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] },
      $maxDistance: radiusKm * 1000, // meters
    },
  },
});

/**
 * Generate unique contract ID
 */
const generateContractId = () => {
  const year = new Date().getFullYear();
  const random = Math.floor(1000 + Math.random() * 9000);
  return `KM-CT-${year}-${random}`;
};

/**
 * Generate unique receipt ID
 */
const generateReceiptId = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `KM-RCP-${timestamp}-${random}`;
};

/**
 * Hash a string using SHA-256
 */
const hashString = (str) => {
  return crypto.createHash('sha256').update(str).digest('hex');
};

/**
 * Sanitize phone number to E.164 format
 */
const sanitizePhone = (phone) => {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('91') && cleaned.length === 12) return `+${cleaned}`;
  if (cleaned.length === 10) return `+91${cleaned}`;
  return `+${cleaned}`;
};

/**
 * Parse pagination params
 */
const parsePagination = (query) => {
  const page = Math.max(1, parseInt(query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit) || 20));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

/**
 * Build sort object from query string
 */
const buildSort = (sortBy, order = 'asc') => {
  const allowedFields = ['price', 'createdAt', 'quantity', 'rating', 'distance'];
  const field = allowedFields.includes(sortBy) ? sortBy : 'createdAt';
  return { [field]: order === 'desc' ? -1 : 1 };
};

/**
 * Format currency in INR
 */
const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: 0,
  }).format(amount);
};

/**
 * Calculate platform fee (2%)
 */
const calculatePlatformFee = (amount, feePercent = 2) => {
  return parseFloat(((amount * feePercent) / 100).toFixed(2));
};

/**
 * Validate Indian phone number
 */
const isValidIndianPhone = (phone) => {
  const cleaned = phone.replace(/\D/g, '');
  return /^[6-9]\d{9}$/.test(cleaned.slice(-10));
};

/**
 * Generate AI price recommendation based on mandi data
 */
const generateAIPriceRecommendation = (cropName, mandiPrices, qualityGrade) => {
  const relevantPrices = mandiPrices.filter(
    (p) => p.commodity.toLowerCase() === cropName.toLowerCase()
  );
  if (!relevantPrices.length) return null;
  const avgModal = relevantPrices.reduce((sum, p) => sum + p.modalPrice, 0) / relevantPrices.length;
  const pricePerKg = avgModal / 100; // Convert from per quintal to per kg
  const qualityMultiplier = { A: 1.1, B: 1.0, C: 0.9 };
  const recommendedPrice = pricePerKg * (qualityMultiplier[qualityGrade] || 1.0);
  return {
    recommendedPrice: parseFloat(recommendedPrice.toFixed(2)),
    basedOn: relevantPrices.length,
    averageMandiPrice: parseFloat(avgModal.toFixed(2)),
    confidence: relevantPrices.length > 3 ? 'high' : relevantPrices.length > 1 ? 'medium' : 'low',
  };
};

module.exports = {
  generateOTP,
  calculateDistance,
  buildGeoQuery,
  generateContractId,
  generateReceiptId,
  hashString,
  sanitizePhone,
  parsePagination,
  buildSort,
  formatCurrency,
  calculatePlatformFee,
  isValidIndianPhone,
  generateAIPriceRecommendation,
};
