const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth');
const { validate } = require('../middlewares/validate');
const { createCropSchema, updateCropSchema, getCropsSchema } = require('../validators/cropValidators');
const { addCrop, updateCrop, deleteCrop, getCrops, getCropDetail, getFarmerCrops } = require('../controllers/cropController');
const { predictPrice } = require('../controllers/aiController');

// Public routes
router.get('/', validate(getCropsSchema), getCrops);
router.get('/:id', getCropDetail);

// Protected routes (farmer only)
router.use(protect); // All routes below require auth

// AI prediction route
router.post('/predict-price', predictPrice);

router.get('/farmer/my-listings', getFarmerCrops);
router.post('/', validate(createCropSchema), addCrop);
router.put('/:id', validate(updateCropSchema), updateCrop);
router.delete('/:id', deleteCrop);

module.exports = router;
