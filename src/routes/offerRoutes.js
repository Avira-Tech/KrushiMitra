const express = require('express');
const router = express.Router();
const { protect, restrictTo, requireVerified } = require('../middlewares/auth');
const { validate } = require('../middlewares/validate');
const { createOfferSchema, updateOfferSchema } = require('../validators/offerValidators');
const { createOffer, updateOffer, getMyOffers, getOfferById } = require('../controllers/offerController');

router.use(protect);

router.get('/', getMyOffers);
router.get('/:id', getOfferById);
router.post('/', requireVerified, restrictTo('buyer'), validate(createOfferSchema), createOffer);
router.patch('/:id', validate(updateOfferSchema), updateOffer);

module.exports = router;
