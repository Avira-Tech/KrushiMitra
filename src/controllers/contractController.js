const Contract = require('../models/Contract');
const Payment = require('../models/Payment');
const Offer = require('../models/Offer');
const { createPaymentIntent, capturePaymentIntent, cancelPaymentIntent } = require('../config/stripe');
const PorterService = require('../services/porterService');
const NotificationService = require('../services/notificationService');
const { parsePagination, generateReceiptId } = require('../utils/helpers');
const { sendSuccess, sendError, sendNotFound, sendForbidden, sendPaginated } = require('../utils/apiResponse');
const logger = require('../utils/logger');

// ─── GET MY CONTRACTS ────────────────────────────────────────────────────────────────────
const getMyContracts = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { status } = req.query;
  const user = req.user;

  const query = {
    $or: [{ farmer: user._id }, { buyer: user._id }],
  };
  if (status) query.status = status;

  const [contracts, total] = await Promise.all([
    Contract.find(query)
      .populate('farmer', 'name phone rating avatar')
      .populate('buyer', 'name phone companyName avatar')
      .populate('crop', 'name images')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Contract.countDocuments(query),
  ]);

  return sendPaginated(res, { data: { contracts }, page, limit, total });
};

// ─── GET CONTRACT BY ID ────────────────────────────────────────────────────────────────────
const getContractById = async (req, res) => {
  const contract = await Contract.findById(req.params.id)
    .populate('farmer', 'name phone rating avatar location')
    .populate('buyer', 'name phone companyName gstNumber avatar')
    .populate('crop', 'name images quality')
    .populate('offer');

  if (!contract) return sendNotFound(res, 'Contract not found');

  const user = req.user;
  const hasAccess =
    contract.farmer._id.toString() === user._id.toString() ||
    contract.buyer._id.toString() === user._id.toString() ||
    user.role === 'admin';

  if (!hasAccess) return sendForbidden(res, 'Not authorized');

  return sendSuccess(res, { data: { contract } });
};

// ─── INITIATE PAYMENT (Stripe Escrow) ──────────────────────────────────────────────────────
const initiatePayment = async (req, res) => {
  const contract = await Contract.findById(req.params.id)
    .populate('farmer', 'name')
    .populate('buyer', 'name gstNumber');

  if (!contract) return sendNotFound(res, 'Contract not found');
  if (contract.buyer._id.toString() !== req.user._id.toString()) {
    return sendForbidden(res, 'Only buyer can initiate payment');
  }
  if (contract.payment.status !== 'pending') {
    return sendError(res, { message: `Payment already ${contract.payment.status}`, statusCode: 400 });
  }

  // Create Stripe Payment Intent (manual capture for escrow)
  const paymentIntent = await createPaymentIntent({
    amount: contract.terms.totalAmount,
    currency: 'inr',
    metadata: {
      contractId: contract._id.toString(),
      contractRef: contract.contractId,
      farmerId: contract.farmer._id.toString(),
      buyerId: contract.buyer._id.toString(),
    },
  });

  // Create payment record
  const payment = await Payment.create({
    contract: contract._id,
    payer: contract.buyer._id,
    payee: contract.farmer._id,
    amount: contract.terms.totalAmount,
    type: 'escrow_deposit',
    status: 'pending',
    stripe: {
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
    },
    receipt: {
      farmerName: contract.farmer.name,
      buyerName: contract.buyer.name,
      cropName: contract.terms.cropName,
      quantity: contract.terms.quantity,
      pricePerKg: contract.terms.pricePerKg,
      contractDate: contract.createdAt,
      deliveryDate: contract.terms.deliveryDate,
    },
    description: `Escrow payment for ${contract.terms.cropName} - Contract ${contract.contractId}`,
    ipAddress: req.ip,
  });

  await Contract.findByIdAndUpdate(contract._id, {
    'payment.status': 'authorized',
    'payment.stripePaymentIntentId': paymentIntent.id,
    'payment.receiptId': payment.receiptId,
  });

  logger.info(`Payment initiated: ${payment._id} for contract ${contract.contractId}`);

  return sendSuccess(res, {
    message: 'Payment initiated. Complete payment using client secret.',
    data: {
      paymentIntentId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      amount: contract.terms.totalAmount,
      currency: 'INR',
      receiptId: payment.receiptId,
    },
  });
};

// ─── CONFIRM PAYMENT (Escrow) ───────────────────────────────────────────────────────────────────
const confirmPayment = async (req, res) => {
  const { paymentIntentId } = req.body;
  const contract = await Contract.findById(req.params.id);
  if (!contract) return sendNotFound(res, 'Contract not found');

  await Contract.findByIdAndUpdate(contract._id, {
    'payment.status': 'in_escrow',
    'payment.paidAt': new Date(),
  });

  await Payment.findOneAndUpdate(
    { 'stripe.paymentIntentId': paymentIntentId },
    { status: 'authorized', processedAt: new Date() }
  );

  // Notify farmer
  await NotificationService.notifyPaymentReceived(contract, contract.farmer, contract.terms.totalAmount);

  // Auto-schedule delivery
  const deliveryResult = await PorterService.createOrder({
    contract,
    pickupAddress: contract.terms.deliveryAddress || 'Farmer location',
    dropAddress: contract.terms.deliveryAddress || 'Buyer location',
    farmerPhone: '+919999999999',
    buyerPhone: '+919999999999',
  });

  if (deliveryResult.success) {
    await Contract.findByIdAndUpdate(contract._id, {
      'delivery.status': 'scheduled',
      'delivery.porterOrderId': deliveryResult.orderId,
      'delivery.trackingId': deliveryResult.trackingId,
      'delivery.estimatedDelivery': deliveryResult.estimatedTime,
    });
  }

  if (global.io) {
    global.io.to(`user:${contract.farmer}`).emit('payment_in_escrow', {
      contractId: contract._id,
      amount: contract.terms.totalAmount,
    });
  }

  return sendSuccess(res, {
    message: 'Payment confirmed and held in escrow. Delivery scheduled.',
    data: { paymentStatus: 'in_escrow', delivery: deliveryResult },
  });
};

// ─── RELEASE PAYMENT (after delivery) ────────────────────────────────────────────────────────
const releasePayment = async (req, res) => {
  const contract = await Contract.findById(req.params.id);
  if (!contract) return sendNotFound(res, 'Contract not found');
  if (contract.buyer._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
    return sendForbidden(res, 'Only buyer or admin can release payment');
  }
  if (contract.payment.status !== 'in_escrow') {
    return sendError(res, { message: 'Payment is not in escrow', statusCode: 400 });
  }

  // Capture the payment (release from escrow)
  if (contract.payment.stripePaymentIntentId) {
    await capturePaymentIntent(contract.payment.stripePaymentIntentId);
  }

  await Contract.findByIdAndUpdate(contract._id, {
    'payment.status': 'released',
    'payment.releasedAt': new Date(),
    'delivery.status': 'delivered',
    'delivery.actualDelivery': new Date(),
    status: 'completed',
    completedAt: new Date(),
  });

  await Payment.findOneAndUpdate(
    { contract: contract._id, type: 'escrow_deposit' },
    { status: 'released', releasedAt: new Date() }
  );

  await NotificationService.notifyPaymentReleased(contract, contract.farmer, contract.terms.netAmount);

  if (global.io) {
    global.io.to(`user:${contract.farmer}`).emit('payment_released', {
      contractId: contract._id,
      amount: contract.terms.netAmount,
    });
  }

  logger.info(`Payment released for contract ${contract.contractId}`);

  return sendSuccess(res, {
    message: `Payment of ₹${contract.terms.netAmount.toLocaleString('en-IN')} released to farmer!`,
    data: { contractId: contract.contractId, amount: contract.terms.netAmount },
  });
};

// ─── RAISE DISPUTE ─────────────────────────────────────────────────────────────────────────
const raiseDispute = async (req, res) => {
  const { reason } = req.body;
  const contract = await Contract.findById(req.params.id);
  if (!contract) return sendNotFound(res, 'Contract not found');

  const isParty =
    contract.farmer.toString() === req.user._id.toString() ||
    contract.buyer.toString() === req.user._id.toString();
  if (!isParty) return sendForbidden(res, 'Not authorized');

  await Contract.findByIdAndUpdate(contract._id, {
    status: 'disputed',
    'dispute.isDisputed': true,
    'dispute.reason': reason,
    'dispute.raisedBy': req.user._id,
    'dispute.raisedAt': new Date(),
  });

  // Notify admin
  const User = require('../models/User');
  const admins = await User.find({ role: 'admin' }).select('_id');
  NotificationService.createBulk(admins.map((a) => a._id), {
    type: 'dispute_raised',
    title: '⚠️ Dispute Raised',
    body: `Dispute on contract #${contract.contractId}: ${reason.substring(0, 100)}`,
    priority: 'urgent',
    refModel: 'Contract',
    refId: contract._id,
  }).catch(() => {});

  return sendSuccess(res, { message: 'Dispute raised. Admin will review within 24 hours.' });
};

// ─── TRACK DELIVERY ────────────────────────────────────────────────────────────────────────
const trackDelivery = async (req, res) => {
  const contract = await Contract.findById(req.params.id);
  if (!contract) return sendNotFound(res, 'Contract not found');

  let trackingData = { status: contract.delivery.status };
  if (contract.delivery.porterOrderId) {
    trackingData = await PorterService.trackOrder(contract.delivery.porterOrderId);
  }

  return sendSuccess(res, {
    data: {
      contractId: contract.contractId,
      delivery: contract.delivery,
      tracking: trackingData,
    },
  });
};

module.exports = { getMyContracts, getContractById, initiatePayment, confirmPayment, releasePayment, raiseDispute, trackDelivery };
