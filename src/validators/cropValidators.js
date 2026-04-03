const Joi = require('joi');
const { body, validationResult } = require('express-validator');

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

// const addCropSchema = [
//   body('name')
//     .trim()
//     .notEmpty().withMessage('Crop name is required')
//     .isLength({ min: 2, max: 100 }).withMessage('Crop name must be 2-100 characters'),
  
//   body('category')
//     .trim()
//     .notEmpty().withMessage('Category is required')
//     .isIn(['Cereals', 'Pulses', 'Oilseeds', 'Cash Crops', 'Vegetables', 'Fruits', 'Spices'])
//     .withMessage('Invalid category'),
  
//   body('quantity')
//     .isFloat({ min: 0.1 }).withMessage('Quantity must be greater than 0'),
  
//   body('unit')
//     .trim()
//     .notEmpty().withMessage('Unit is required')
//     .isIn(['kg', 'quintal', 'ton', 'liter', 'piece'])
//     .withMessage('Invalid unit'),
  
//   body('pricePerUnit')
//     .isFloat({ min: 0.1 }).withMessage('Price must be greater than 0'),
  
//   body('description')
//     .trim()
//     .isLength({ max: 1000 }).withMessage('Description cannot exceed 1000 characters'),
  
//   body('harvestDate')
//     .isISO8601().withMessage('Invalid harvest date format'),
  
//   body('images')
//     .isArray({ min: 1, max: 5 }).withMessage('At least 1 image required, max 5'),
  
//   body('location.latitude')
//     .isFloat({ min: -90, max: 90 }).withMessage('Invalid latitude'),
  
//   body('location.longitude')
//     .isFloat({ min: -180, max: 180 }).withMessage('Invalid longitude'),
  
//   body('soilType')
//     .optional()
//     .trim()
//     .isIn(['Black', 'Red', 'Laterite', 'Alluvial', 'Rocky'])
//     .withMessage('Invalid soil type'),
  
//   body('pesticides')
//     .optional()
//     .isBoolean().withMessage('Pesticides must be boolean'),
// ];
const addCropSchema = [
  body('name')
    .trim()
    .notEmpty().withMessage('Crop name is required'),
  
  body('category')
    .trim()
    .notEmpty().withMessage('Category is required')
    // MUST MATCH MONGOOSE ENUM:
    .isIn(['grain', 'vegetable', 'fruit', 'spice', 'oilseed', 'fiber', 'pulse', 'other'])
    .withMessage('Invalid category'),
  
  body('quantity')
    .isFloat({ min: 0.1 }).withMessage('Quantity must be greater than 0'),
  
  // Change 'pricePerUnit' to 'pricePerKg' to match your payload
  body('pricePerKg')
    .isFloat({ min: 0.1 }).withMessage('Price must be greater than 0'),
  
  body('quality')
    .isIn(['A', 'B', 'C']).withMessage('Invalid quality grade'),

  body('harvestDate')
    .isISO8601().withMessage('Invalid harvest date format'),
  
  body('images')
    .isArray({ min: 1 }).withMessage('At least 1 image required'),
  
  body('location.latitude')
    .isFloat().withMessage('Invalid latitude'),
  
  body('location.longitude')
    .isFloat().withMessage('Invalid longitude'),
];
module.exports = { createCropSchema, updateCropSchema, getCropsSchema, addCropSchema };
