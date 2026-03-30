const express = require('express');
const router = express.Router();
const { protect, restrictTo } = require('../middlewares/auth');
const { validate } = require('../middlewares/validate');
const { disputeSchema } = require('../validators/contractValidators');
const {
  getMyContracts, getContractById, initiatePayment,
  confirmPayment, releasePayment, raiseDispute, trackDelivery,
} = require('../controllers/contractController');

router.use(protect);

router.get('/', getMyContracts);
router.get('/:id', getContractById);
router.post('/:id/payment/initiate', restrictTo('buyer'), initiatePayment);
router.post('/:id/payment/confirm', restrictTo('buyer'), confirmPayment);
router.post('/:id/payment/release', releasePayment);
router.post('/:id/dispute', validate(disputeSchema), raiseDispute);
router.get('/:id/delivery/track', trackDelivery);

module.exports = router;
