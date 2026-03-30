const Joi = require('joi');

const createCropSchema = Joi.object({
  name: Joi.string().min(2).max(100).required().trim(),
  category: Joi.string().valid('grain', 'vegetable', 'fruit', 'spice', 'oilseed', 'fiber', 'pulse', 'other').default('other'),
  quantity: Joi.number().positive().required(),
  quantityUnit: Joi.string().valid('kg', 'quintal', 'ton').default('kg'),
  pricePerKg: Joi.number().positive().required(),
  minimumOrder: Joi.number().positive().default(100),
  quality: Joi.string().valid('A', 'B', 'C').required(),
  qualityDetails: Joi.object({
    moisture: Joi.number().min(0).max(100).optional(),
    protein: Joi.number().min(0).max(100).optional(),
    foreignMatter: Joi.number().min(0).max(100).optional(),
    description: Joi.string().max(500).optional(),
  }).optional(),
  harvestDate: Joi.date().required(),
  expiryDate: Joi.date().greater(Joi.ref('harvestDate')).optional(),
  description: Joi.string().max(1000).optional().allow(''),
  location: Joi.object({
    lat: Joi.number().required(),
    lng: Joi.number().required(),
    address: Joi.string().optional(),
    city: Joi.string().optional(),
    state: Joi.string().optional(),
    pincode: Joi.string().optional(),
  }).required(),
  deliveryAvailable: Joi.boolean().default(false),
  deliveryRadius: Joi.number().positive().default(50),
  deliveryCharge: Joi.number().min(0).default(0),
  tags: Joi.array().items(Joi.string()).max(10).optional(),
});

const updateCropSchema = Joi.object({
  name: Joi.string().min(2).max(100).optional().trim(),
  quantity: Joi.number().positive().optional(),
  pricePerKg: Joi.number().positive().optional(),
  quality: Joi.string().valid('A', 'B', 'C').optional(),
  description: Joi.string().max(1000).optional(),
  deliveryAvailable: Joi.boolean().optional(),
  deliveryCharge: Joi.number().min(0).optional(),
  status: Joi.string().valid('active', 'sold', 'draft').optional(),
  isAvailable: Joi.boolean().optional(),
  minimumOrder: Joi.number().positive().optional(),
  tags: Joi.array().items(Joi.string()).max(10).optional(),
});

const getCropsSchema = Joi.object({
  lat: Joi.number().optional(),
  lng: Joi.number().optional(),
  radius: Joi.number().positive().max(200).default(50),
  name: Joi.string().optional(),
  category: Joi.string().optional(),
  quality: Joi.string().valid('A', 'B', 'C').optional(),
  minPrice: Joi.number().positive().optional(),
  maxPrice: Joi.number().positive().optional(),
  deliveryAvailable: Joi.boolean().optional(),
  sortBy: Joi.string().valid('price', 'createdAt', 'rating', 'distance').default('createdAt'),
  order: Joi.string().valid('asc', 'desc').default('desc'),
  page: Joi.number().positive().default(1),
  limit: Joi.number().positive().max(100).default(20),
  search: Joi.string().optional(),
});

module.exports = { createCropSchema, updateCropSchema, getCropsSchema };
