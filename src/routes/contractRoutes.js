'use strict';
const express  = require('express');
const router   = express.Router();
const { protect, restrictTo } = require('../middlewares/auth');
const {
  getMyContracts,
  getContractById,
  choosePaymentType,
  initiatePayment,
  confirmPayment,
  releasePayment,
  raiseDispute,
  trackDelivery,
  updateDeliveryLocation,
} = require('../controllers/contractController');

router.use(protect);

router.get('/',                                   getMyContracts);
router.get('/:id',                                getContractById);
router.post('/:id/payment/choose',  restrictTo('buyer'), choosePaymentType);
router.post('/:id/payment/initiate', restrictTo('buyer'), initiatePayment);
router.post('/:id/payment/confirm',  restrictTo('buyer'), confirmPayment);
router.post('/:id/payment/release',               releasePayment);
router.post('/:id/dispute',                       raiseDispute);
router.get('/:id/delivery/track',                 trackDelivery);
router.patch('/:id/delivery/location', restrictTo('buyer'), updateDeliveryLocation);

module.exports = router;