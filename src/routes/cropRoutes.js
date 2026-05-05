const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth');
const { validate } = require('../middlewares/validate');
const { aiLimiter } = require('../middlewares/rateLimiter');
const { searchLimiter } = require('../middlewares/endpointRateLimiters');
const { createCropSchema, updateCropSchema, getCropsSchema } = require('../validators/cropValidators');
const { addCrop, updateCrop, deleteCrop, getCrops, getCropDetail, getFarmerCrops, getFarmerAnalytics } = require('../controllers/cropController');
const { predictPrice } = require('../controllers/aiController');

// Public routes
router.get('/', searchLimiter, validate(getCropsSchema), getCrops);
router.get('/:id', getCropDetail);

// Protected routes (farmer only)
router.use(protect); // All routes below require auth

// AI prediction route
router.post('/predict-price', aiLimiter, predictPrice);

const { uploadMultiple } = require('../middlewares/upload');

router.get('/farmer/my-listings', getFarmerCrops);
router.get('/farmer/analytics', getFarmerAnalytics);
router.post('/', uploadMultiple('images', 5), validate(createCropSchema), addCrop);
router.put('/:id', validate(updateCropSchema), updateCrop);
router.delete('/:id', deleteCrop);

module.exports = router;
