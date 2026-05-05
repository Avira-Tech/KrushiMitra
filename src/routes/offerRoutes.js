const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth');
const { validate } = require('../middlewares/validate');
const { paymentLimiter } = require('../middlewares/endpointRateLimiters');
const { makeOfferSchema, counterOfferSchema } = require('../validators/offerValidators');
const {
  getOffers,
  getOfferDetail,
  makeOffer,
  acceptOffer,
  rejectOffer,
  counterOffer,
  cancelOffer,
} = require('../controllers/offerController');

// ─── Public routes ───────────────────────────────────────────────────────
router.get('/:id', protect, getOfferDetail);

// ─── Protected routes ────────────────────────────────────────────────────
router.use(protect); // All routes below require auth

router.get('/', getOffers);
router.post('/', paymentLimiter, validate(makeOfferSchema), makeOffer);
router.post('/:id/accept', paymentLimiter, acceptOffer);
router.post('/:id/reject', rejectOffer);
router.post('/:id/counter', validate(counterOfferSchema), counterOffer);
router.post('/:id/cancel', cancelOffer);

module.exports = router;
