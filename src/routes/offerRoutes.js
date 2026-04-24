const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/auth');
const { validate } = require('../middlewares/validate');
const { makeOfferSchema } = require('../validators/offerValidators');
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
router.post('/', validate(makeOfferSchema), makeOffer);
router.post('/:id/accept', acceptOffer);
router.post('/:id/reject', rejectOffer);
router.post('/:id/counter', counterOffer);
router.post('/:id/cancel', cancelOffer);

module.exports = router;
