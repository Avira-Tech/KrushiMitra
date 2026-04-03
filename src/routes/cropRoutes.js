const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth');
const { validate } = require('../middlewares/validate');
const { addCropSchema } = require('../validators/cropValidators');
const { addCrop, updateCrop, deleteCrop, getCrops, getCropDetail, getFarmerCrops } = require('../controllers/cropController');

// Public routes
router.get('/', getCrops);
router.get('/:id', getCropDetail);

// Protected routes (farmer only)
router.use(protect); // All routes below require auth
router.get('/farmer/my-listings', getFarmerCrops);
router.post('/', validate(addCropSchema), addCrop);
router.put('/:id', validate(addCropSchema), updateCrop);
router.delete('/:id', deleteCrop);

module.exports = router;
