const express = require('express');
const router = express.Router();
const { protect, restrictTo, requireVerified } = require('../middlewares/auth');
const { uploadMultiple, uploadSingle } = require('../middlewares/upload');
const { validate } = require('../middlewares/validate');
const { createCropSchema, updateCropSchema, getCropsSchema } = require('../validators/cropValidators');
const {
  createCrop, getCrops, getCropById, updateCrop,
  deleteCrop, getMyCrops, getAIPriceRecommendation, detectCropQuality,
} = require('../controllers/cropController');

// Public routes
router.get('/', validate(getCropsSchema, 'query'), getCrops);
router.get('/ai-price', getAIPriceRecommendation);
router.get('/:id', getCropById);

// Protected routes
router.use(protect);
router.get('/my/listings', getMyCrops);
router.post('/', requireVerified, restrictTo('farmer'), uploadMultiple('images', 5), validate(createCropSchema), createCrop);
router.put('/:id', restrictTo('farmer'), uploadMultiple('images', 3), validate(updateCropSchema), updateCrop);
router.delete('/:id', restrictTo('farmer'), deleteCrop);
router.post('/detect-quality', restrictTo('farmer'), uploadSingle('image'), detectCropQuality);

module.exports = router;
