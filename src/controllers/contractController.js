// const Contract = require('../models/Contract');
// const Payment = require('../models/Payment');
// const Offer = require('../models/Offer');
// const { createPaymentIntent, capturePaymentIntent, cancelPaymentIntent } = require('../config/stripe');
// const PorterService = require('../services/porterService');
// const NotificationService = require('../services/notificationService');
// const { parsePagination, generateReceiptId } = require('../utils/helpers');
// const { sendSuccess, sendError, sendNotFound, sendForbidden, sendPaginated } = require('../utils/apiResponse');
// const logger = require('../utils/logger');

// // ─── GET MY CONTRACTS ────────────────────────────────────────────────────────────────────
// const getMyContracts = async (req, res) => {
//   const { page, limit, skip } = parsePagination(req.query);
//   const { status } = req.query;
//   const user = req.user;

//   const query = {
//     $or: [{ farmer: user._id }, { buyer: user._id }],
//   };
//   if (status) query.status = status;

//   const [contracts, total] = await Promise.all([
//     Contract.find(query)
//       .populate('farmer', 'name phone rating avatar')
//       .populate('buyer', 'name phone companyName avatar')
//       .populate('crop', 'name images')
//       .sort({ createdAt: -1 })
//       .skip(skip)
//       .limit(limit),
//     Contract.countDocuments(query),
//   ]);

//   return sendPaginated(res, { data: { contracts }, page, limit, total });
// };

// // ─── GET CONTRACT BY ID ────────────────────────────────────────────────────────────────────
// const getContractById = async (req, res) => {
//   const contract = await Contract.findById(req.params.id)
//     .populate('farmer', 'name phone rating avatar location')
//     .populate('buyer', 'name phone companyName gstNumber avatar')
//     .populate('crop', 'name images quality')
//     .populate('offer');

//   if (!contract) return sendNotFound(res, 'Contract not found');

//   const user = req.user;
//   const hasAccess =
//     contract.farmer._id.toString() === user._id.toString() ||
//     contract.buyer._id.toString() === user._id.toString() ||
//     user.role === 'admin';

//   if (!hasAccess) return sendForbidden(res, 'Not authorized');

//   return sendSuccess(res, { data: { contract } });
// };

// // ─── INITIATE PAYMENT (Stripe Escrow) ──────────────────────────────────────────────────────
// const initiatePayment = async (req, res) => {
//   const contract = await Contract.findById(req.params.id)
//     .populate('farmer', 'name')
//     .populate('buyer', 'name gstNumber');

//   if (!contract) return sendNotFound(res, 'Contract not found');
//   if (contract.buyer._id.toString() !== req.user._id.toString()) {
//     return sendForbidden(res, 'Only buyer can initiate payment');
//   }
//   if (contract.payment.status !== 'pending') {
//     return sendError(res, { message: `Payment already ${contract.payment.status}`, statusCode: 400 });
//   }

//   // Create Stripe Payment Intent (manual capture for escrow)
//   const paymentIntent = await createPaymentIntent({
//     amount: contract.terms.totalAmount,
//     currency: 'inr',
//     metadata: {
//       contractId: contract._id.toString(),
//       contractRef: contract.contractId,
//       farmerId: contract.farmer._id.toString(),
//       buyerId: contract.buyer._id.toString(),
//     },
//   });

//   // Create payment record
//   const payment = await Payment.create({
//     contract: contract._id,
//     payer: contract.buyer._id,
//     payee: contract.farmer._id,
//     amount: contract.terms.totalAmount,
//     type: 'escrow_deposit',
//     status: 'pending',
//     stripe: {
//       paymentIntentId: paymentIntent.id,
//       clientSecret: paymentIntent.client_secret,
//     },
//     receipt: {
//       farmerName: contract.farmer.name,
//       buyerName: contract.buyer.name,
//       cropName: contract.terms.cropName,
//       quantity: contract.terms.quantity,
//       pricePerKg: contract.terms.pricePerKg,
//       contractDate: contract.createdAt,
//       deliveryDate: contract.terms.deliveryDate,
//     },
//     description: `Escrow payment for ${contract.terms.cropName} - Contract ${contract.contractId}`,
//     ipAddress: req.ip,
//   });

//   await Contract.findByIdAndUpdate(contract._id, {
//     'payment.status': 'authorized',
//     'payment.stripePaymentIntentId': paymentIntent.id,
//     'payment.receiptId': payment.receiptId,
//   });

//   logger.info(`Payment initiated: ${payment._id} for contract ${contract.contractId}`);

//   return sendSuccess(res, {
//     message: 'Payment initiated. Complete payment using client secret.',
//     data: {
//       paymentIntentId: paymentIntent.id,
//       clientSecret: paymentIntent.client_secret,
//       amount: contract.terms.totalAmount,
//       currency: 'INR',
//       receiptId: payment.receiptId,
//     },
//   });
// };

// // ─── CONFIRM PAYMENT (Escrow) ───────────────────────────────────────────────────────────────────
// const confirmPayment = async (req, res) => {
//   const { paymentIntentId } = req.body;
//   const contract = await Contract.findById(req.params.id);
//   if (!contract) return sendNotFound(res, 'Contract not found');

//   await Contract.findByIdAndUpdate(contract._id, {
//     'payment.status': 'in_escrow',
//     'payment.paidAt': new Date(),
//   });

//   await Payment.findOneAndUpdate(
//     { 'stripe.paymentIntentId': paymentIntentId },
//     { status: 'authorized', processedAt: new Date() }
//   );

//   // Notify farmer
//   await NotificationService.notifyPaymentReceived(contract, contract.farmer, contract.terms.totalAmount);

//   // Auto-schedule delivery
//   const deliveryResult = await PorterService.createOrder({
//     contract,
//     pickupAddress: contract.terms.deliveryAddress || 'Farmer location',
//     dropAddress: contract.terms.deliveryAddress || 'Buyer location',
//     farmerPhone: '+919999999999',
//     buyerPhone: '+919999999999',
//   });

//   if (deliveryResult.success) {
//     await Contract.findByIdAndUpdate(contract._id, {
//       'delivery.status': 'scheduled',
//       'delivery.porterOrderId': deliveryResult.orderId,
//       'delivery.trackingId': deliveryResult.trackingId,
//       'delivery.estimatedDelivery': deliveryResult.estimatedTime,
//     });
//   }

//   if (global.io) {
//     global.io.to(`user:${contract.farmer}`).emit('payment_in_escrow', {
//       contractId: contract._id,
//       amount: contract.terms.totalAmount,
//     });
//   }

//   return sendSuccess(res, {
//     message: 'Payment confirmed and held in escrow. Delivery scheduled.',
//     data: { paymentStatus: 'in_escrow', delivery: deliveryResult },
//   });
// };

// // ─── RELEASE PAYMENT (after delivery) ────────────────────────────────────────────────────────
// const releasePayment = async (req, res) => {
//   const contract = await Contract.findById(req.params.id);
//   if (!contract) return sendNotFound(res, 'Contract not found');
//   if (contract.buyer._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
//     return sendForbidden(res, 'Only buyer or admin can release payment');
//   }
//   if (contract.payment.status !== 'in_escrow') {
//     return sendError(res, { message: 'Payment is not in escrow', statusCode: 400 });
//   }

//   // Capture the payment (release from escrow)
//   if (contract.payment.stripePaymentIntentId) {
//     await capturePaymentIntent(contract.payment.stripePaymentIntentId);
//   }

//   await Contract.findByIdAndUpdate(contract._id, {
//     'payment.status': 'released',
//     'payment.releasedAt': new Date(),
//     'delivery.status': 'delivered',
//     'delivery.actualDelivery': new Date(),
//     status: 'completed',
//     completedAt: new Date(),
//   });

//   await Payment.findOneAndUpdate(
//     { contract: contract._id, type: 'escrow_deposit' },
//     { status: 'released', releasedAt: new Date() }
//   );

//   await NotificationService.notifyPaymentReleased(contract, contract.farmer, contract.terms.netAmount);

//   if (global.io) {
//     global.io.to(`user:${contract.farmer}`).emit('payment_released', {
//       contractId: contract._id,
//       amount: contract.terms.netAmount,
//     });
//   }

//   logger.info(`Payment released for contract ${contract.contractId}`);

//   return sendSuccess(res, {
//     message: `Payment of ₹${contract.terms.netAmount.toLocaleString('en-IN')} released to farmer!`,
//     data: { contractId: contract.contractId, amount: contract.terms.netAmount },
//   });
// };

// // ─── RAISE DISPUTE ─────────────────────────────────────────────────────────────────────────
// const raiseDispute = async (req, res) => {
//   const { reason } = req.body;
//   const contract = await Contract.findById(req.params.id);
//   if (!contract) return sendNotFound(res, 'Contract not found');

//   const isParty =
//     contract.farmer.toString() === req.user._id.toString() ||
//     contract.buyer.toString() === req.user._id.toString();
//   if (!isParty) return sendForbidden(res, 'Not authorized');

//   await Contract.findByIdAndUpdate(contract._id, {
//     status: 'disputed',
//     'dispute.isDisputed': true,
//     'dispute.reason': reason,
//     'dispute.raisedBy': req.user._id,
//     'dispute.raisedAt': new Date(),
//   });

//   // Notify admin
//   const User = require('../models/User');
//   const admins = await User.find({ role: 'admin' }).select('_id');
//   NotificationService.createBulk(admins.map((a) => a._id), {
//     type: 'dispute_raised',
//     title: '⚠️ Dispute Raised',
//     body: `Dispute on contract #${contract.contractId}: ${reason.substring(0, 100)}`,
//     priority: 'urgent',
//     refModel: 'Contract',
//     refId: contract._id,
//   }).catch(() => {});

//   return sendSuccess(res, { message: 'Dispute raised. Admin will review within 24 hours.' });
// };

// // ─── TRACK DELIVERY ────────────────────────────────────────────────────────────────────────
// const trackDelivery = async (req, res) => {
//   const contract = await Contract.findById(req.params.id);
//   if (!contract) return sendNotFound(res, 'Contract not found');

//   let trackingData = { status: contract.delivery.status };
//   if (contract.delivery.porterOrderId) {
//     trackingData = await PorterService.trackOrder(contract.delivery.porterOrderId);
//   }

//   return sendSuccess(res, {
//     data: {
//       contractId: contract.contractId,
//       delivery: contract.delivery,
//       tracking: trackingData,
//     },
//   });
// };

// module.exports = { getMyContracts, getContractById, initiatePayment, confirmPayment, releasePayment, raiseDispute, trackDelivery };

'use strict';
/**
 * contractController.js
 *
 * Key flows:
 *  1. getMyContracts        — fetches from DB, fully populated, correct user filter
 *  2. choosePaymentType     — NEW: buyer chooses 'advance' or 'on_delivery'
 *  3. initiatePayment       — creates Stripe intent based on chosen payment type
 *  4. confirmPayment        — server confirms payment, contract → 'confirmed'
 *  5. releasePayment        — after delivery, buyer releases escrow to farmer
 *  6. raiseDispute / trackDelivery
 */

const Contract  = require('../models/Contract');
const Payment   = require('../models/Payment');
const Offer     = require('../models/Offer');
const { createPaymentIntent, capturePaymentIntent } = require('../config/stripe');
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

    // Match both farmer and buyer side
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

    // Flatten terms into top-level fields so frontend Contract interface works
    const normalized = contracts.map((c) => {
      const obj = c.toObject();
      return {
        ...obj,
        // Flat fields the frontend expects
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
/**
 * NEW — Buyer chooses payment mode after farmer accepts.
 * paymentType: 'advance' | 'on_delivery'
 *
 * 'advance'     → Stripe escrow, full amount upfront, released after delivery
 * 'on_delivery' → No upfront payment, buyer pays when goods arrive;
 *                 contract marked confirmed, delivery scheduled immediately
 */
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

    // Store the buyer's payment preference
    await Contract.findByIdAndUpdate(contract._id, {
      'payment.type':   paymentType,
      'payment.status': paymentType === 'advance' ? 'awaiting_payment' : 'on_delivery',
    });

    if (paymentType === 'on_delivery') {
      // No upfront payment — confirm contract, schedule delivery
      await Contract.findByIdAndUpdate(contract._id, {
        status:           'confirmed',
        'delivery.status':'scheduled',
      });

      // Schedule delivery with Porter
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

    // paymentType === 'advance' → tell frontend to call /payment/initiate
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
    const userId   = req.user._id || req.user.id;
    const contract = await Contract.findById(req.params.id)
      .populate('farmer', 'name')
      .populate('buyer',  'name gstNumber');

    if (!contract) return sendNotFound(res, 'Contract not found');
    if (contract.buyer._id.toString() !== userId.toString()) {
      return sendForbidden(res, 'Only buyer can initiate payment');
    }
    if (!['awaiting_payment'].includes(contract.payment.status)) {
      return sendError(res, { message: `Cannot initiate — payment status: ${contract.payment.status}`, statusCode: 400 });
    }

    const paymentIntent = await createPaymentIntent({
      amount:   contract.terms.totalAmount,
      currency: 'inr',
      metadata: {
        contractId:  contract._id.toString(),
        farmerId:    contract.farmer._id.toString(),
        buyerId:     contract.buyer._id.toString(),
        paymentType: contract.payment.type || 'advance',
      },
    });

    const payment = await Payment.create({
      contract:    contract._id,
      payer:       contract.buyer._id,
      payee:       contract.farmer._id,
      amount:      contract.terms.totalAmount,
      type:        'escrow_deposit',
      status:      'pending',
      stripe: {
        paymentIntentId: paymentIntent.id,
        clientSecret:    paymentIntent.client_secret,
      },
      description: `Escrow — ${contract.terms.cropName} — Contract ${contract.contractId}`,
      ipAddress:   req.ip,
    });

    await Contract.findByIdAndUpdate(contract._id, {
      'payment.status':                'authorized',
      'payment.stripePaymentIntentId': paymentIntent.id,
    });

    logger.info(`Payment initiated: ${payment._id} for contract ${contract.contractId}`);

    return sendSuccess(res, {
      message: 'Payment initiated. Complete using clientSecret.',
      data: {
        paymentIntentId: paymentIntent.id,
        clientSecret:    paymentIntent.client_secret,
        amount:          contract.terms.totalAmount,
        currency:        'INR',
      },
    });
  } catch (err) {
    logger.error('initiatePayment error:', err);
    return sendError(res, { message: 'Failed to initiate payment', statusCode: 500 });
  }
};

// ─── POST /api/v1/contracts/:id/payment/confirm ───────────────────────────────
const confirmPayment = async (req, res) => {
  try {
    const { paymentIntentId } = req.body;
    const userId = req.user._id || req.user.id;
    const contract = await Contract.findById(req.params.id)
      .populate('farmer', 'name phone')
      .populate('buyer',  'name phone');

    if (!contract) return sendNotFound(res, 'Contract not found');
    if (contract.buyer._id.toString() !== userId.toString()) {
      return sendForbidden(res, 'Only buyer can confirm payment');
    }

    await Contract.findByIdAndUpdate(contract._id, {
      status:            'confirmed',
      'payment.status':  'in_escrow',
      'payment.paidAt':  new Date(),
    });

    await Payment.findOneAndUpdate(
      { 'stripe.paymentIntentId': paymentIntentId },
      { status: 'authorized', processedAt: new Date() }
    );

    // Schedule delivery
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
        'delivery.status':            'scheduled',
        'delivery.porterOrderId':     deliveryResult.orderId,
        'delivery.trackingId':        deliveryResult.trackingId,
        'delivery.estimatedDelivery': deliveryResult.estimatedTime,
      });
    }

    NotificationService.create({
      recipientId: contract.farmer._id,
      type:        'payment_received',
      title:       '💳 Payment in Escrow',
      body:        `₹${contract.terms.totalAmount?.toLocaleString('en-IN')} received for ${contract.terms.cropName}. Delivery scheduled.`,
      refModel:    'Contract',
      refId:       contract._id,
      priority:    'high',
    }).catch(logger.error);

    if (global.io) {
      global.io.to(`user:${contract.farmer._id}`).emit('payment_in_escrow', {
        contractId: contract._id,
        amount:     contract.terms.totalAmount,
      });
    }

    return sendSuccess(res, {
      message: 'Payment confirmed and held in escrow. Delivery scheduled.',
      data: { paymentStatus: 'in_escrow', delivery: deliveryResult },
    });
  } catch (err) {
    logger.error('confirmPayment error:', err);
    return sendError(res, { message: 'Failed to confirm payment', statusCode: 500 });
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

    // Capture from Stripe if advance payment
    if (contract.payment.stripePaymentIntentId) {
      await capturePaymentIntent(contract.payment.stripePaymentIntentId).catch(logger.error);
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