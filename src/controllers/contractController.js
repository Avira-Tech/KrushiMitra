'use strict';
/**
 * contractController.js
 *
 * Key flows:
 *  1. getMyContracts        — fetches from DB, fully populated, correct user filter
 *  2. choosePaymentType     — Buyer chooses 'advance' payment
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
const { sendEmail } = require('../utils/emailService');
const User = require('../models/User');

// ─── GET /api/v1/contracts ────────────────────────────────────────────────────
const getMyContracts = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const { status } = req.query;
    const userId = req.user._id || req.user.id;
    const role = req.user.role;

    let query = {};
    if (role === 'farmer' || role === 'buyer') {
      query = { $or: [{ farmer: userId }, { buyer: userId }] };
    }
    // Admin sees all by default with query = {}
    
    if (status) query.status = status;

    const [contracts, total] = await Promise.all([
      Contract.find(query)
        .populate('farmer', 'name phone rating avatar')
        .populate('buyer',  'name phone companyName gstNumber avatar rating')
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
      .populate('buyer',  'name phone companyName gstNumber avatar rating')
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

    if (paymentType !== 'advance') {
      return sendError(res, { message: "Only 'advance' payment is currently supported", statusCode: 400 });
    }

    const contract = await Contract.findById(req.params.id)
      .populate('farmer', 'name phone')
      .populate('buyer',  'name phone')
      .populate('crop',   'name');

    if (!contract) return sendNotFound(res, 'Contract not found');
    if (contract.buyer._id.toString() !== userId.toString()) {
      return sendForbidden(res, 'Only the buyer can choose payment type');
    }
    if (!['awaiting_buyer', 'pending'].includes(contract.payment.status)) {
      return sendError(res, { message: `Cannot choose payment — status is already ${contract.payment.status}`, statusCode: 400 });
    }

    // Advance payment choice - update status
    await Contract.findByIdAndUpdate(contract._id, {
      'payment.type':   'advance',
      'payment.status': 'awaiting_payment',
    });

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

    if (contract.payment.status !== 'in_escrow') {
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

// ─── PATCH /api/v1/contracts/:id/delivery/location ─────────────────────────
const updateDeliveryLocation = async (req, res) => {
  try {
    const { lat, lng, address } = req.body;
    const userId = req.user._id || req.user.id;

    if (!lat || !lng) {
      return sendError(res, { message: 'Coordinates (lat, lng) are required', statusCode: 400 });
    }

    const contract = await Contract.findById(req.params.id);
    if (!contract) return sendNotFound(res, 'Contract not found');

    if (contract.buyer.toString() !== userId.toString()) {
      return sendForbidden(res, 'Only the buyer can update the delivery location');
    }

    if (contract.status !== 'active') {
      return sendError(res, { message: 'Location can only be updated for active contracts before payment confirmed', statusCode: 400 });
    }

    await Contract.findByIdAndUpdate(contract._id, {
      'delivery.buyerLocation': {
        type: 'Point',
        coordinates: [lng, lat],
        address: address || '',
        capturedAt: new Date(),
      },
      'delivery.locationCaptured': true,
      'terms.deliveryAddress': address || contract.terms.deliveryAddress,
    });

    return sendSuccess(res, { message: 'Delivery location updated successfully' });
  } catch (err) {
    logger.error('updateDeliveryLocation error:', err);
    return sendError(res, { message: 'Failed to update delivery location', statusCode: 500 });
  }
};

// ─── POST /api/v1/contracts/:id/like ──────────────────────────────────────────
const toggleLikeContract = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const contract = await Contract.findById(req.params.id);

    if (!contract) return sendNotFound(res, 'Contract not found');

    const index = contract.likedBy.indexOf(userId);
    if (index === -1) {
      contract.likedBy.push(userId);
    } else {
      contract.likedBy.splice(index, 1);
    }

    await contract.save();
    return sendSuccess(res, { 
      message: index === -1 ? 'Agreement liked' : 'Agreement unliked',
      data: { isLiked: index === -1 } 
    });
  } catch (err) {
    logger.error('toggleLikeContract error:', err);
    return sendError(res, { message: 'Failed to toggle like', statusCode: 500 });
  }
};

// ─── POST /api/v1/contracts/:id/email ─────────────────────────────────────────
const sendContractEmail = async (req, res) => {
  try {
    const { pdfBase64 } = req.body;
    const userId = req.user._id || req.user.id;
    const contract = await Contract.findById(req.params.id)
      .populate('farmer', 'name email')
      .populate('buyer', 'name email');

    if (!contract) return sendNotFound(res, 'Contract not found');

    const user = await User.findById(userId);
    if (!user || !user.email) {
      return sendError(res, { message: 'User email not found. Cannot send email.', statusCode: 400 });
    }

    const htmlContent = `
      <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e0e0e0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
        <div style="background: linear-gradient(135deg, #2E7D32, #1B5E20); padding: 30px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 24px; letter-spacing: 1px;">Digital Agreement</h1>
          <p style="color: rgba(255,255,255,0.8); margin-top: 5px; font-size: 14px;">KrushiMitra Trust-Engine™ Certified</p>
        </div>
        <div style="padding: 30px; line-height: 1.6; color: #444;">
          <p style="font-size: 16px;">Hello <strong>${user.name}</strong>,</p>
          <p>Your digital agreement for the trade of <strong>${contract.terms.cropName}</strong> has been successfully generated. Please find the official PDF copy attached to this email.</p>
          
          <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 0; font-size: 14px; color: #666;">Agreement Details:</p>
            <p style="margin: 5px 0; font-size: 15px;"><strong>ID:</strong> ${contract.contractId}</p>
            <p style="margin: 5px 0; font-size: 15px;"><strong>Seller:</strong> ${contract.farmer.name}</p>
            <p style="margin: 5px 0; font-size: 15px;"><strong>Buyer:</strong> ${contract.buyer.name}</p>
          </div>

          <p style="font-size: 14px; color: #777;">This is a legally binding digital instrument generated on KrushiMitra. You can also view and manage this agreement anytime within the app under the 'Contracts' section.</p>
          
          <div style="text-align: center; margin-top: 30px;">
            <p style="font-size: 12px; color: #999;">&copy; 2026 KrushiMitra Verified Agri-Network. All rights reserved.</p>
          </div>
        </div>
      </div>
    `;

    const attachments = [];
    if (pdfBase64) {
      attachments.push({
        filename: `Agreement_${contract.contractId}.pdf`,
        content: pdfBase64,
        encoding: 'base64',
      });
    }

    try {
      await sendEmail({
        to: user.email,
        subject: `KrushiMitra Agreement: ${contract.contractId}`,
        html: htmlContent,
        attachments,
      });
      return sendSuccess(res, { message: `Email sent to ${user.email}` });
    } catch (emailErr) {
      logger.error('📧 SMTP Error:', emailErr);
      return sendSuccess(res, { message: 'Agreement downloaded, but email failed (Check SMTP).' });
    }
  } catch (err) {
    logger.error('sendContractEmail error:', err);
    return sendError(res, { message: 'Failed to send email', statusCode: 500 });
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
  updateDeliveryLocation,
  toggleLikeContract,
  sendContractEmail,
};