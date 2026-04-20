'use strict';
/**
 * contractController.js
 *
 * Key flows:
 *  1. getMyContracts        — fetches from DB, fully populated, correct user filter
 *  2. choosePaymentType     — Buyer chooses 'advance' or 'on_delivery'
 *  3. initiatePayment       — creates Razorpay order
 *  4. confirmPayment        — verify signature, confirm contract
 *  5. releasePayment        — after delivery, release escrow to farmer
 *  6. raiseDispute / trackDelivery
 */

const Contract  = require('../models/Contract');
const Payment   = require('../models/Payment');
const Offer     = require('../models/Offer');
const razorpayConfig = require('../config/razorpay');
const PorterService       = require('../services/porterService');
const NotificationService = require('../services/notificationService');
const { parsePagination } = require('../utils/helpers');
const { sendSuccess, sendError, sendNotFound, sendForbidden, sendPaginated } = require('../utils/apiResponse');
const logger = require('../utils/logger');

// ─── GET /api/v1/contracts ────────────────────────────────────────────────────
const getMyContracts = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { status } = req.query;
    const userId = req.user._id || req.user.id;

    const query = { $or: [{ farmer: userId }, { buyer: userId }] };
    if (status) query.status = status;

    const [contracts, total] = await Promise.all([
      Contract.find(query)
        .populate('farmer', 'name phone rating avatar')
        .populate('buyer',  'name phone companyName gstNumber avatar')
        .populate('crop',   'name images pricePerKg')
        .populate('offer')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Contract.countDocuments(query),
    ]);

    const normalized = contracts.map((c) => {
      const obj = c.toObject();
      return {
        ...obj,
        cropName:      obj.terms?.cropName    || obj.crop?.name || '',
        farmerName:    obj.terms?.farmerName  || obj.farmer?.name || '',
        buyerName:     obj.terms?.buyerName   || obj.buyer?.name || '',
        quantity:      obj.terms?.quantity    || 0,
        pricePerKg:    obj.terms?.pricePerKg  || 0,
        totalAmount:   obj.terms?.totalAmount || 0,
        platformFee:   obj.terms?.platformFee || 0,
        netAmount:     obj.terms?.netAmount   || 0,
        deliveryDate:  obj.terms?.deliveryDate,
        paymentTerms:  obj.terms?.paymentTerms,
        paymentStatus: obj.payment?.status    || 'pending',
        deliveryStatus:obj.delivery?.status   || 'pending',
        trackingId:    obj.delivery?.trackingId,
      };
    });

    return sendPaginated(res, { data: { contracts: normalized }, page, limit, total });
  } catch (err) {
    logger.error('getMyContracts error:', err);
    return sendError(res, { message: 'Failed to fetch contracts', statusCode: 500 });
  }
};

// ─── GET /api/v1/contracts/:id ────────────────────────────────────────────────
const getContractById = async (req, res) => {
  try {
    const userId   = req.user._id || req.user.id;
    const contract = await Contract.findById(req.params.id)
      .populate('farmer', 'name phone rating avatar location')
      .populate('buyer',  'name phone companyName gstNumber avatar')
      .populate('crop',   'name images pricePerKg quality')
      .populate('offer');

    if (!contract) return sendNotFound(res, 'Contract not found');

    const hasAccess =
      contract.farmer._id.toString() === userId.toString() ||
      contract.buyer._id.toString()  === userId.toString() ||
      req.user.role === 'admin';

    if (!hasAccess) return sendForbidden(res, 'Not authorized');

    const obj = contract.toObject();
    return sendSuccess(res, {
      data: {
        contract: {
          ...obj,
          cropName:      obj.terms?.cropName    || obj.crop?.name || '',
          farmerName:    obj.terms?.farmerName  || obj.farmer?.name || '',
          buyerName:     obj.terms?.buyerName   || obj.buyer?.name || '',
          quantity:      obj.terms?.quantity    || 0,
          pricePerKg:    obj.terms?.pricePerKg  || 0,
          totalAmount:   obj.terms?.totalAmount || 0,
          platformFee:   obj.terms?.platformFee || 0,
          netAmount:     obj.terms?.netAmount   || 0,
          deliveryDate:  obj.terms?.deliveryDate,
          paymentStatus: obj.payment?.status    || 'pending',
          deliveryStatus:obj.delivery?.status   || 'pending',
          trackingId:    obj.delivery?.trackingId,
        },
      },
    });
  } catch (err) {
    logger.error('getContractById error:', err);
    return sendError(res, { message: 'Failed to fetch contract', statusCode: 500 });
  }
};

// ─── POST /api/v1/contracts/:id/payment/choose ──────────────────────────────
const choosePaymentType = async (req, res) => {
  try {
    const { paymentType } = req.body;
    const userId = req.user._id || req.user.id;

    if (!['advance', 'on_delivery'].includes(paymentType)) {
      return sendError(res, { message: "paymentType must be 'advance' or 'on_delivery'", statusCode: 400 });
    }

    const contract = await Contract.findById(req.params.id)
      .populate('farmer', 'name phone')
      .populate('buyer',  'name phone')
      .populate('crop',   'name');

    if (!contract) return sendNotFound(res, 'Contract not found');
    if (contract.buyer._id.toString() !== userId.toString()) {
      return sendForbidden(res, 'Only the buyer can choose payment type');
    }
    if (!['awaiting_buyer'].includes(contract.payment.status)) {
      return sendError(res, { message: `Cannot choose payment — status is already ${contract.payment.status}`, statusCode: 400 });
    }

    await Contract.findByIdAndUpdate(contract._id, {
      'payment.type':   paymentType,
      'payment.status': paymentType === 'advance' ? 'awaiting_payment' : 'on_delivery',
    });

    if (paymentType === 'on_delivery') {
      await Contract.findByIdAndUpdate(contract._id, {
        status:           'confirmed',
        'delivery.status':'scheduled',
      });

      const farmer = await require('../models/User').findById(contract.farmer._id).select('phone location');
      const buyer  = await require('../models/User').findById(contract.buyer._id).select('phone location');

      const deliveryResult = await PorterService.createOrder({
        contract,
        pickupAddress: farmer?.location?.address || 'Farmer location',
        dropAddress:   buyer?.location?.address  || 'Buyer location',
        farmerPhone:   farmer?.phone ? `+91${farmer.phone}` : '+919999999999',
        buyerPhone:    buyer?.phone  ? `+91${buyer.phone}`  : '+919999999999',
      }).catch((e) => { logger.error('Porter error:', e); return { success: false }; });

      if (deliveryResult.success) {
        await Contract.findByIdAndUpdate(contract._id, {
          'delivery.porterOrderId': deliveryResult.orderId,
          'delivery.trackingId':    deliveryResult.trackingId,
          'delivery.estimatedDelivery': deliveryResult.estimatedTime,
        });
      }

      NotificationService.create({
        recipientId: contract.farmer._id,
        senderId:    userId,
        type:        'contract_created',
        title:       '📦 Contract Confirmed — Pay on Delivery',
        body:        `${contract.buyer.name} chose Pay on Delivery. Delivery scheduled. Prepare ${contract.terms.cropName}.`,
        refModel:    'Contract',
        refId:       contract._id,
        priority:    'high',
      }).catch(logger.error);

      if (global.io) {
        global.io.to(`user:${contract.farmer._id}`).emit('contract_confirmed', {
          contractId:  contract._id,
          paymentType: 'on_delivery',
        });
      }

      return sendSuccess(res, {
        message: 'Pay on Delivery confirmed. Delivery has been scheduled.',
        data: { paymentType: 'on_delivery', deliveryScheduled: deliveryResult.success },
      });
    }

    return sendSuccess(res, {
      message: 'Advance payment selected. Proceed to payment.',
      data: { paymentType: 'advance', nextStep: 'initiate_payment' },
    });
  } catch (err) {
    logger.error('choosePaymentType error:', err);
    return sendError(res, { message: 'Failed to process payment choice', statusCode: 500 });
  }
};

// ─── POST /api/v1/contracts/:id/payment/initiate ──────────────────────────────
const initiatePayment = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const contract = await Contract.findById(req.params.id).populate('farmer buyer');

    if (!contract) return sendNotFound(res, 'Contract not found');
    if (contract.buyer._id.toString() !== userId.toString()) return sendForbidden(res, 'Unauthorized');

    const order = await razorpayConfig.createOrder({
      amount: contract.terms.totalAmount,
      receipt: `contract_${contract._id}`,
      notes: { contractId: contract._id.toString() }
    });

    const payment = await Payment.create({
      contract: contract._id,
      payer: contract.buyer._id,
      payee: contract.farmer._id,
      amount: contract.terms.totalAmount,
      type: 'razorpay',
      status: 'initiated',
      razorpay: { orderId: order.id }
    });

    await Contract.findByIdAndUpdate(contract._id, {
      'payment.status': 'awaiting_payment',
      'payment.razorpayOrderId': order.id
    });

    return sendSuccess(res, {
      data: { orderId: order.id, keyId: process.env.RAZORPAY_KEY_ID, amount: order.amount / 100 }
    });
  } catch (err) {
    logger.error('initiatePayment error:', err);
    return sendError(res, { message: 'Payment initiation failed', statusCode: 500 });
  }
};

// ─── POST /api/v1/contracts/:id/payment/confirm ───────────────────────────────
const confirmPayment = async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const isValid = razorpayConfig.verifyPaymentSignature(razorpay_order_id, razorpay_payment_id, razorpay_signature);
    if (!isValid) return sendError(res, { message: 'Invalid signature', statusCode: 400 });

    const payment = await Payment.findOneAndUpdate(
      { 'razorpay.orderId': razorpay_order_id },
      { 
        status: 'captured', 
        'razorpay.paymentId': razorpay_payment_id,
        processedAt: new Date() 
      },
      { new: true }
    ).populate('contract');

    await Contract.findByIdAndUpdate(payment.contract._id, {
      status: 'confirmed',
      'payment.status': 'in_escrow',
      'payment.paidAt': new Date()
    });

    return sendSuccess(res, { message: 'Payment confirmed', data: { paymentId: payment._id } });
  } catch (err) {
    logger.error('confirmPayment error:', err);
    return sendError(res, { message: 'Confirmation failed', statusCode: 500 });
  }
};

// ─── POST /api/v1/contracts/:id/payment/release ───────────────────────────────
const releasePayment = async (req, res) => {
  try {
    const userId   = req.user._id || req.user.id;
    const contract = await Contract.findById(req.params.id);
    if (!contract) return sendNotFound(res, 'Contract not found');

    const isBuyer = contract.buyer.toString() === userId.toString();
    const isAdmin = req.user.role === 'admin';
    if (!isBuyer && !isAdmin) return sendForbidden(res, 'Only buyer or admin can release payment');

    if (!['in_escrow', 'on_delivery'].includes(contract.payment.status)) {
      return sendError(res, { message: `Payment status is ${contract.payment.status}`, statusCode: 400 });
    }

    await Contract.findByIdAndUpdate(contract._id, {
      status:                'completed',
      'payment.status':      'released',
      'payment.releasedAt':  new Date(),
      'delivery.status':     'delivered',
      'delivery.actualDelivery': new Date(),
      completedAt:           new Date(),
    });

    await Payment.findOneAndUpdate(
      { contract: contract._id },
      { status: 'released', releasedAt: new Date() }
    );

    NotificationService.create({
      recipientId: contract.farmer,
      type:        'payment_released',
      title:       '✅ Payment Released!',
      body:        `₹${contract.terms.netAmount?.toLocaleString('en-IN')} has been released to your account.`,
      refModel:    'Contract',
      refId:       contract._id,
      priority:    'urgent',
    }).catch(logger.error);

    if (global.io) {
      global.io.to(`user:${contract.farmer}`).emit('payment_released', {
        contractId: contract._id,
        amount:     contract.terms.netAmount,
      });
    }

    logger.info(`Payment released for contract ${contract.contractId}`);
    return sendSuccess(res, {
      message: `₹${contract.terms.netAmount?.toLocaleString('en-IN')} released to farmer!`,
      data:    { contractId: contract.contractId, amount: contract.terms.netAmount },
    });
  } catch (err) {
    logger.error('releasePayment error:', err);
    return sendError(res, { message: 'Failed to release payment', statusCode: 500 });
  }
};

// ─── POST /api/v1/contracts/:id/dispute ──────────────────────────────────────
const raiseDispute = async (req, res) => {
  try {
    const { reason } = req.body;
    const userId     = req.user._id || req.user.id;
    const contract   = await Contract.findById(req.params.id);
    if (!contract) return sendNotFound(res, 'Contract not found');

    const isParty =
      contract.farmer.toString() === userId.toString() ||
      contract.buyer.toString()  === userId.toString();
    if (!isParty) return sendForbidden(res, 'Not authorized');

    await Contract.findByIdAndUpdate(contract._id, {
      status:              'disputed',
      'dispute.isDisputed': true,
      'dispute.reason':     reason,
      'dispute.raisedBy':   userId,
      'dispute.raisedAt':   new Date(),
    });

    const User   = require('../models/User');
    const admins = await User.find({ role: 'admin' }).select('_id');
    NotificationService.createBulk(admins.map((a) => a._id), {
      type:     'dispute_raised',
      title:    '⚠️ Dispute Raised',
      body:     `Contract #${contract.contractId}: ${reason?.substring(0, 100)}`,
      priority: 'urgent',
      refModel: 'Contract',
      refId:    contract._id,
    }).catch(() => {});

    return sendSuccess(res, { message: 'Dispute raised. Admin will review within 24 hours.' });
  } catch (err) {
    logger.error('raiseDispute error:', err);
    return sendError(res, { message: 'Failed to raise dispute', statusCode: 500 });
  }
};

// ─── GET /api/v1/contracts/:id/delivery/track ────────────────────────────────
const trackDelivery = async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id);
    if (!contract) return sendNotFound(res, 'Contract not found');

    let trackingData = { status: contract.delivery?.status || 'pending' };
    if (contract.delivery?.porterOrderId) {
      trackingData = await PorterService.trackOrder(contract.delivery.porterOrderId)
        .catch(() => ({ status: contract.delivery.status }));
    }

    return sendSuccess(res, {
      data: {
        contractId: contract.contractId,
        delivery:   contract.delivery,
        tracking:   trackingData,
      },
    });
  } catch (err) {
    logger.error('trackDelivery error:', err);
    return sendError(res, { message: 'Failed to track delivery', statusCode: 500 });
  }
};

module.exports = {
  getMyContracts,
  getContractById,
  choosePaymentType,
  initiatePayment,
  confirmPayment,
  releasePayment,
  raiseDispute,
  trackDelivery,
};