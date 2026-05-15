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

const Contract = require('../models/Contract');
const Payment = require('../models/Payment');
const Offer = require('../models/Offer');
const razorpayConfig = require('../config/razorpay');
const PorterService = require('../services/porterService');
const NotificationService = require('../services/notificationService');
const { parsePagination } = require('../utils/helpers');
const {
  sendSuccess,
  sendError,
  sendNotFound,
  sendForbidden,
  sendPaginated,
} = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { sendEmail } = require('../utils/emailService');
const User = require('../models/User');
const BlackBuckService = require('../services/blackbuckService');
const ULIPService = require('../services/ulipService');
const { calculateDistance } = require('../utils/helpers');

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
    } else if (role === 'logistics') {
      query = { 'transport.logisticsPartner': userId };
    }
    // Admin sees all by default with query = {}

    if (status) query.status = status;
    if (req.query.hasTransport === 'true') {
      query['transport.provider'] = { $ne: 'none' };
    }

    const [contracts, total] = await Promise.all([
      Contract.find(query)
        .populate('farmer', 'name phone rating avatar location')
        .populate('buyer', 'name phone companyName gstNumber avatar rating location')
        .populate('crop', 'name images pricePerKg')
        .populate('offer')
        .populate('transport.logisticsPartner', 'name phone avatar')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Contract.countDocuments(query),
    ]);

    const normalized = contracts.map((c) => {
      const obj = c.toObject();
      return {
        ...obj,
        cropName: obj.terms?.cropName || obj.crop?.name || '',
        farmerName: obj.terms?.farmerName || obj.farmer?.name || '',
        buyerName: obj.terms?.buyerName || obj.buyer?.name || '',
        quantity: obj.terms?.quantity || 0,
        pricePerKg: obj.terms?.pricePerKg || 0,
        totalAmount: obj.terms?.totalAmount || 0,
        platformFee: obj.terms?.platformFee || 0,
        netAmount: obj.terms?.netAmount || 0,
        deliveryDate: obj.terms?.deliveryDate,
        paymentTerms: obj.terms?.paymentTerms,
        paymentStatus: obj.payment?.status || 'pending',
        deliveryStatus: obj.delivery?.status || 'pending',
        trackingId: obj.delivery?.trackingId,
        distance: obj.transport?.distance || obj.transport?.distanceKm || 0,
        logisticsFee: obj.terms?.logisticsFee || obj.transport?.estimatedCost || 0,
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
    const userId = req.user._id || req.user.id;
    const contract = await Contract.findById(req.params.id)
      .populate('farmer', 'name phone rating avatar location')
      .populate('buyer', 'name phone companyName gstNumber avatar rating')
      .populate('crop', 'name images pricePerKg quality')
      .populate('offer')
      .populate('transport.logisticsPartner', 'name phone avatar');

    if (!contract) return sendNotFound(res, 'Contract not found');

    const hasAccess =
      contract.farmer._id.toString() === userId.toString() ||
      contract.buyer._id.toString() === userId.toString() ||
      req.user.role === 'admin';

    if (!hasAccess) return sendForbidden(res, 'Not authorized');

    const obj = contract.toObject();
    return sendSuccess(res, {
      data: {
        contract: {
          ...obj,
          cropName: obj.terms?.cropName || obj.crop?.name || '',
          farmerName: obj.terms?.farmerName || obj.farmer?.name || '',
          buyerName: obj.terms?.buyerName || obj.buyer?.name || '',
          quantity: obj.terms?.quantity || 0,
          pricePerKg: obj.terms?.pricePerKg || 0,
          totalAmount: obj.terms?.totalAmount || 0,
          platformFee: obj.terms?.platformFee || 0,
          netAmount: obj.terms?.netAmount || 0,
          deliveryDate: obj.terms?.deliveryDate,
          paymentStatus: obj.payment?.status || 'pending',
          deliveryStatus: obj.delivery?.status || 'pending',
          trackingId: obj.delivery?.trackingId,
          logisticsFee: obj.terms?.logisticsFee || obj.transport?.estimatedCost || 0,
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
      return sendError(res, {
        message: "Only 'advance' payment is currently supported",
        statusCode: 400,
      });
    }

    const contract = await Contract.findById(req.params.id)
      .populate('farmer', 'name phone')
      .populate('buyer', 'name phone')
      .populate('crop', 'name');

    if (!contract) return sendNotFound(res, 'Contract not found');
    if (contract.buyer._id.toString() !== userId.toString()) {
      return sendForbidden(res, 'Only the buyer can choose payment type');
    }
    if (!['awaiting_buyer', 'pending'].includes(contract.payment.status)) {
      return sendError(res, {
        message: `Cannot choose payment — status is already ${contract.payment.status}`,
        statusCode: 400,
      });
    }

    // Advance payment choice - update status
    const updatedContract = await Contract.findByIdAndUpdate(
      contract._id,
      {
        'payment.type': 'advance',
        'payment.status': 'awaiting_payment',
      },
      { new: true },
    );

    return sendSuccess(res, {
      message: 'Advance payment selected. Proceed to payment.',
      data: { paymentType: 'advance', nextStep: 'initiate_payment', contract: updatedContract },
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
    const grandTotal = contract.terms.totalAmount + (contract.terms.logisticsFee || 0);

    const order = await razorpayConfig.createOrder({
      amount: grandTotal,
      receipt: `contract_${contract._id}`,
      notes: { contractId: contract._id.toString() },
    });

    const payment = await Payment.create({
      contract: contract._id,
      payer: contract.buyer._id,
      payee: contract.farmer._id,
      amount: grandTotal,
      type: 'razorpay',
      status: 'initiated',
      razorpay: { orderId: order.id },
    });

    await Contract.findByIdAndUpdate(contract._id, {
      'payment.status': 'awaiting_payment',
      'payment.razorpayOrderId': order.id,
    });

    return sendSuccess(res, {
      data: { orderId: order.id, keyId: process.env.RAZORPAY_KEY_ID, amount: order.amount / 100 },
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

    const isValid = razorpayConfig.verifyPaymentSignature({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    });
    if (!isValid) return sendError(res, { message: 'Invalid signature', statusCode: 400 });

    const payment = await Payment.findOneAndUpdate(
      { 'razorpay.orderId': razorpay_order_id },
      {
        status: 'captured',
        'razorpay.paymentId': razorpay_payment_id,
        processedAt: new Date(),
      },
      { new: true },
    ).populate('contract');

    await Contract.findByIdAndUpdate(payment.contract._id, {
      status: 'confirmed',
      'payment.status': 'in_escrow',
      'payment.paidAt': new Date(),
    });

    // Auto-book Transport after payment confirmation
    const contract = await Contract.findById(payment.contract._id).populate('farmer buyer');
    if (
      contract &&
      contract.transport.provider !== 'none' &&
      contract.transport.status === 'confirmed'
    ) {
      // For local transport, we already have details.
      // For porter/blackbuck, we would call their APIs here if not already booked.
      await Contract.findByIdAndUpdate(contract._id, {
        'delivery.status': 'scheduled',
      });
    }

    return sendSuccess(res, { message: 'Payment confirmed', data: { paymentId: payment._id } });
  } catch (err) {
    logger.error('confirmPayment error:', err);
    return sendError(res, { message: 'Confirmation failed', statusCode: 500 });
  }
};

// ─── POST /api/v1/contracts/:id/payment/release ───────────────────────────────
const releasePayment = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const contract = await Contract.findById(req.params.id);
    if (!contract) return sendNotFound(res, 'Contract not found');

    const isBuyer = contract.buyer.toString() === userId.toString();
    const isAdmin = req.user.role === 'admin';
    if (!isBuyer && !isAdmin) return sendForbidden(res, 'Only buyer or admin can release payment');

    if (contract.payment.status !== 'in_escrow') {
      return sendError(res, {
        message: `Payment status is ${contract.payment.status}`,
        statusCode: 400,
      });
    }

    await Contract.findByIdAndUpdate(contract._id, {
      status: 'completed',
      'payment.status': 'released',
      'payment.releasedAt': new Date(),
      'delivery.status': 'delivered',
      'delivery.actualDelivery': new Date(),
      completedAt: new Date(),
    });

    await Payment.findOneAndUpdate(
      { contract: contract._id },
      { status: 'released', releasedAt: new Date() },
    );

    // Notify Farmer
    NotificationService.create({
      recipientId: contract.farmer,
      type: 'payment_released',
      title: '✅ Payment Released!',
      body: `₹${contract.terms.netAmount?.toLocaleString('en-IN')} has been released to your account.`,
      refModel: 'Contract',
      refId: contract._id,
      priority: 'urgent',
    }).catch(logger.error);

    // Notify Logistics Partner if applicable
    if (contract.transport.logisticsPartner) {
      NotificationService.create({
        recipientId: contract.transport.logisticsPartner,
        type: 'logistics_payment_released',
        title: '🚚 Logistics Payment Released!',
        body: `₹${contract.terms.logisticsFee?.toLocaleString('en-IN')} has been released for your transport service.`,
        refModel: 'Contract',
        refId: contract._id,
        priority: 'urgent',
      }).catch(logger.error);
    }

    if (global.io) {
      global.io.to(`user:${contract.farmer}`).emit('payment_released', {
        contractId: contract._id,
        amount: contract.terms.netAmount,
      });
      if (contract.transport.logisticsPartner) {
        global.io.to(`user:${contract.transport.logisticsPartner}`).emit('payment_released', {
          contractId: contract._id,
          amount: contract.terms.logisticsFee,
        });
      }
    }

    logger.info(`Payment released for contract ${contract.contractId}`);
    const totalReleased = (contract.terms.netAmount || 0) + (contract.terms.logisticsFee || 0);
    return sendSuccess(res, {
      message: `₹${totalReleased.toLocaleString('en-IN')} released!`,
      data: {
        contractId: contract.contractId,
        farmerAmount: contract.terms.netAmount,
        logisticsAmount: contract.terms.logisticsFee,
      },
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
    const userId = req.user._id || req.user.id;
    const contract = await Contract.findById(req.params.id);
    if (!contract) return sendNotFound(res, 'Contract not found');

    const isParty =
      contract.farmer.toString() === userId.toString() ||
      contract.buyer.toString() === userId.toString();
    if (!isParty) return sendForbidden(res, 'Not authorized');

    await Contract.findByIdAndUpdate(contract._id, {
      status: 'disputed',
      'dispute.isDisputed': true,
      'dispute.reason': reason,
      'dispute.raisedBy': userId,
      'dispute.raisedAt': new Date(),
    });

    const User = require('../models/User');
    const admins = await User.find({ role: 'admin' }).select('_id');
    NotificationService.createBulk(
      admins.map((a) => a._id),
      {
        type: 'dispute_raised',
        title: '⚠️ Dispute Raised',
        body: `Contract #${contract.contractId}: ${reason?.substring(0, 100)}`,
        priority: 'urgent',
        refModel: 'Contract',
        refId: contract._id,
      },
    ).catch(() => {});

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
      trackingData = await PorterService.trackOrder(contract.delivery.porterOrderId).catch(() => ({
        status: contract.delivery.status,
      }));
    }

    return sendSuccess(res, {
      data: {
        contractId: contract.contractId,
        delivery: contract.delivery,
        tracking: trackingData,
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

    if (!['active', 'confirmed'].includes(contract.status)) {
      return sendError(res, {
        message: `Location can only be updated for active or confirmed contracts. Current status: ${contract.status}`,
        statusCode: 400,
      });
    }

    // Recalculate distance
    const farmer = await User.findById(contract.farmer).select('location');
    let distanceKm = contract.transport?.distanceKm || 0;

    if (farmer?.location?.coordinates) {
      const fLoc = farmer.location.coordinates;
      distanceKm = calculateDistance(fLoc[1], fLoc[0], lat, lng);
      logger.info(`📍 Recalculated distance for contract ${contract._id}: ${distanceKm} km`);
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
      'transport.distanceKm': distanceKm,
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
      data: { isLiked: index === -1 },
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
      return sendError(res, {
        message: 'User email not found. Cannot send email.',
        statusCode: 400,
      });
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

// u2500u2500u2500 POST /api/v1/contracts/:id/transport/quote u2500u2500u2500
const getTransportQuote = async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id)
      .populate('farmer', 'location')
      .populate('buyer', 'location');

    if (!contract) return sendNotFound(res, 'Contract not found');

    const farmerLoc = contract.farmer.location?.coordinates;
    const buyerLoc =
      contract.delivery?.buyerLocation?.coordinates || contract.buyer.location?.coordinates;

    if (!farmerLoc || !buyerLoc) {
      return sendError(res, {
        message: 'Location data missing for farmer or buyer',
        statusCode: 400,
      });
    }

    const distance = calculateDistance(farmerLoc[1], farmerLoc[0], buyerLoc[1], buyerLoc[0]);
    const weight = contract.terms.quantity || 100;

    let quote;
    let provider;

    if (distance < 50) {
      provider = 'porter';
      quote = await PorterService.getQuote({
        pickupLat: farmerLoc[1],
        pickupLng: farmerLoc[0],
        dropLat: buyerLoc[1],
        dropLng: buyerLoc[0],
        weight,
      });
    } else {
      provider = 'blackbuck';
      quote = await BlackBuckService.getQuote({
        pickupLat: farmerLoc[1],
        pickupLng: farmerLoc[0],
        dropLat: buyerLoc[1],
        dropLng: buyerLoc[0],
        weight,
        distance,
      });
    }

    const estimatedCost = quote.vehicles?.[0]?.fare?.minor_amount
      ? quote.vehicles[0].fare.minor_amount / 100
      : quote.vehicles?.[0]?.fare || 500;

    await Contract.findByIdAndUpdate(contract._id, {
      'transport.provider': provider,
      'transport.distanceKm': distance,
      'transport.estimatedCost': estimatedCost,
    });

    return sendSuccess(res, {
      message: 'Transport quote generated',
      data: {
        provider,
        distance,
        estimatedCost,
        quote,
      },
    });
  } catch (err) {
    logger.error('getTransportQuote error:', err);
    return sendError(res, { message: 'Failed to get transport quote', statusCode: 500 });
  }
};

// ─── POST /api/v1/contracts/:id/transport/request ──────────────────────────
const requestTransport = async (req, res) => {
  try {
    const { truckId } = req.body;
    const userId = req.user._id || req.user.id;

    const contract = await Contract.findById(req.params.id);
    if (!contract) return sendNotFound(res, 'Contract not found');
    if (contract.buyer.toString() !== userId.toString())
      return sendForbidden(res, 'Only buyer can request transport');

    const Truck = require('../models/Truck');
    const truck = await Truck.findById(truckId).populate('owner');
    if (!truck) return sendNotFound(res, 'Truck not found');

    const farmer = await User.findById(contract.farmer).select('location');
    const buyer = await User.findById(contract.buyer).select('location');

    let distanceKm = 0;
    const buyerLoc = contract.delivery?.buyerLocation?.coordinates || buyer?.location?.coordinates;
    const farmerLoc = farmer?.location?.coordinates;

    if (farmerLoc && farmerLoc.length >= 2 && buyerLoc && buyerLoc.length >= 2) {
      const fLat = farmerLoc[1];
      const fLng = farmerLoc[0];
      const bLat = buyerLoc[1];
      const bLng = buyerLoc[0];

      if (!isNaN(fLat) && !isNaN(fLng) && !isNaN(bLat) && !isNaN(bLng)) {
        distanceKm = calculateDistance(fLat, fLng, bLat, bLng);
      } else {
        logger.warn(`Invalid coordinates for distance calculation. Contract: ${contract._id}`);
      }
    } else {
      logger.warn(`Missing coordinates for distance calculation. Contract: ${contract._id}`);
    }

    const estimatedCost = Math.round(distanceKm * (truck.pricePerKm || 20));

    await Contract.findByIdAndUpdate(contract._id, {
      'transport.provider': 'local',
      'transport.status': 'requested',
      'transport.truck': truckId,
      'transport.logisticsPartner': truck.owner._id,
      'transport.estimatedCost': estimatedCost,
      'transport.distanceKm': distanceKm,
    });

    NotificationService.create({
      recipientId: truck.owner._id,
      type: 'transport_request',
      title: '🚚 New Transport Request',
      body: `Request for ${contract.terms.cropName} transport. Estimated earning: ₹${estimatedCost}`,
      refModel: 'Contract',
      refId: contract._id,
      priority: 'high',
    }).catch(logger.error);

    return sendSuccess(res, {
      message: 'Transport requested. Waiting for partner confirmation.',
      data: { estimatedCost },
    });
  } catch (err) {
    logger.error('requestTransport error:', err);
    return sendError(res, { message: 'Failed to request transport', statusCode: 500 });
  }
};

// ─── POST /api/v1/contracts/:id/transport/respond ──────────────────────────
const respondTransport = async (req, res) => {
  try {
    const { action } = req.body; // 'approve' or 'reject'
    const userId = req.user._id || req.user.id;

    const contract = await Contract.findById(req.params.id).populate('buyer');
    if (!contract) return sendNotFound(res, 'Contract not found');

    if (contract.transport.logisticsPartner.toString() !== userId.toString()) {
      return sendForbidden(res, 'Only the assigned logistics partner can respond');
    }

    if (action === 'approve') {
      const truck = await require('../models/Truck').findById(contract.transport.truck);

      await Contract.findByIdAndUpdate(contract._id, {
        'transport.status': 'confirmed',
        'transport.driverName': truck?.driverName,
        'transport.driverPhone': truck?.driverPhone,
        'transport.vehicleNumber': truck?.plateNumber,
        'transport.vehicleType': truck?.vehicleType,
        'transport.pickupOtp': Math.floor(100000 + Math.random() * 900000).toString(),
        'transport.deliveryOtp': Math.floor(100000 + Math.random() * 900000).toString(),
        'terms.logisticsFee': contract.transport.estimatedCost,
        // Update grand total is usually handled in frontend or on payment initiation
      });

      NotificationService.create({
        recipientId: contract.buyer._id,
        type: 'transport_confirmed',
        title: '✅ Transport Confirmed',
        body: `Logistics partner has confirmed the truck for ${contract.terms.cropName}. You can now proceed to payment.`,
        refModel: 'Contract',
        refId: contract._id,
        priority: 'high',
      }).catch(logger.error);
    } else {
      await Contract.findByIdAndUpdate(contract._id, {
        'transport.status': 'rejected',
        'transport.provider': 'none',
        'transport.truck': null,
        'transport.logisticsPartner': null,
      });

      NotificationService.create({
        recipientId: contract.buyer._id,
        type: 'transport_rejected',
        title: '❌ Transport Rejected',
        body: `Logistics partner declined the transport request for ${contract.terms.cropName}. Please select another truck.`,
        refModel: 'Contract',
        refId: contract._id,
      }).catch(logger.error);
    }

    return sendSuccess(res, { message: `Transport ${action}d successfully` });
  } catch (err) {
    logger.error('respondTransport error:', err);
    return sendError(res, { message: 'Failed to respond to transport', statusCode: 500 });
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
  getTransportQuote,
  requestTransport,
  respondTransport,
};
