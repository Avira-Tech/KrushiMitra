'use strict';
/**
 * offerController.js
 *
 * Full offer lifecycle:
 *  1. Buyer makes offer  → status: 'pending'
 *  2. Farmer accepts     → status: 'accepted'  + contract created with paymentStatus:'awaiting_buyer'
 *  3. Buyer sees update  → can Pay (advance/on-delivery) OR Reject/Counter
 *  4. Buyer pays         → contract paymentStatus updated, delivery scheduled
 */

const Offer = require('../models/Offer');
const Crop = require('../models/Crop');
const User = require('../models/User');
const Contract = require('../models/Contract');
const Conversation = require('../models/Conversation');
const Message = require('../models/Message');
const { validationResult } = require('express-validator');
const logger = require('../utils/logger');
const sanitizer = require('../utils/sanitizer');
const NotificationService = require('../services/notificationService');
const { transactionOfferAcceptance } = require('../services/transactionService');

// ─── GET /api/v1/offers ───────────────────────────────────────────────────────
const getOffers = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const userRole = req.user.role;
    const { status, skip = 0, limit = 20 } = req.query;

    let filter = {};
    if (userRole === 'farmer') filter.farmer = userId;
    else if (userRole === 'buyer') filter.buyer = userId;
    if (status) filter.status = status;

    const [offers, total] = await Promise.all([
      Offer.find(filter)
        .populate('crop', 'name category images pricePerKg quantity availableQuantity')
        .populate('farmer', 'name phone email avatar rating')
        .populate('buyer', 'name phone email avatar rating')
        .populate('contract')
        .sort({ createdAt: -1 })
        .skip(parseInt(skip))
        .limit(parseInt(limit)),
      Offer.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: offers,
      pagination: {
        total,
        skip: parseInt(skip),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    logger.error('getOffers error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch offers' });
  }
};

// ─── GET /api/v1/offers/:id ───────────────────────────────────────────────────
const getOfferDetail = async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const offer = await Offer.findById(req.params.id)
      .populate('crop', 'name category images pricePerKg quantity availableQuantity')
      .populate('farmer', 'name phone email avatar rating')
      .populate('buyer', 'name phone email avatar rating')
      .populate('contract');

    if (!offer) return res.status(404).json({ success: false, error: 'Offer not found' });

    const isParty =
      offer.farmer._id.toString() === userId.toString() ||
      offer.buyer._id.toString() === userId.toString();
    if (!isParty) return res.status(403).json({ success: false, error: 'Unauthorized' });

    return res.status(200).json({ success: true, data: offer });
  } catch (err) {
    logger.error('getOfferDetail error:', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch offer' });
  }
};

// ─── POST /api/v1/offers — Buyer makes an offer ───────────────────────────────
const makeOffer = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array().map((e) => ({ field: e.param, message: e.msg })),
      });
    }

    const buyerId = req.user.id || req.user._id;
    const {
      cropId,
      quantity,
      pricePerKg,
      pricePerUnit,       // backward-compat alias
      deliveryLocation,
      deliveryDate,
      paymentTerms,
      message,
    } = req.body;

    const resolvedPrice = parseFloat(pricePerKg || pricePerUnit);
    if (!resolvedPrice || resolvedPrice <= 0) {
      return res.status(400).json({ success: false, error: 'Valid pricePerKg is required' });
    }

    const crop = await Crop.findById(cropId).populate('farmer');
    if (!crop) return res.status(404).json({ success: false, error: 'Crop not found' });

    if (crop.farmer._id.toString() === buyerId.toString()) {
      return res.status(400).json({ success: false, error: 'Cannot offer on your own crop' });
    }

    const parsedQty = parseFloat(quantity);
    if (parsedQty > (crop.availableQuantity || crop.quantity)) {
      return res.status(400).json({ success: false, error: `Only ${crop.availableQuantity || crop.quantity} kg available` });
    }

    const buyer = await User.findById(buyerId);
    if (!buyer || buyer.role !== 'buyer') {
      return res.status(403).json({ success: false, error: 'Only buyers can make offers' });
    }

    const totalAmount = parseFloat((parsedQty * resolvedPrice).toFixed(2));

    const offer = await Offer.create({
      crop: cropId,
      farmer: crop.farmer._id,
      buyer: buyerId,
      quantity: parsedQty,
      pricePerKg: resolvedPrice,
      totalAmount,
      deliveryLocation: deliveryLocation ? sanitizer.sanitizeString(deliveryLocation) : undefined,
      deliveryDate: deliveryDate ? new Date(deliveryDate) : undefined,
      paymentTerms: paymentTerms || 'KrushiMitra Secure Escrow',
      message: message ? sanitizer.sanitizeString(message) : undefined,
      status: 'pending',
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      negotiationHistory: [{
        by: 'buyer',
        action: 'offer',
        price: resolvedPrice,
        message: message || '',
        timestamp: new Date(),
      }],
    });

    await offer.populate([
      { path: 'crop', select: 'name images pricePerKg' },
      { path: 'farmer', select: 'name phone email' },
      { path: 'buyer', select: 'name phone email' },
    ]);

    // ─── Chat Message Integration ─────────────────────────────────────────────
    try {
      // 1. Find or Create Conversation
      const participants = [buyerId.toString(), crop.farmer._id.toString()].sort();
      const conversation = await Conversation.findOneAndUpdate(
        { participants: { $size: 2, $all: participants } },
        {
          $setOnInsert: { participants },
          $set: { lastMessageAt: new Date() }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );

      // 2. Create 'offer' Message
      const chatMessage = await Message.create({
        conversationId: conversation._id,
        sender: buyerId,
        recipient: crop.farmer._id,
        content: `New Offer Received: ₹${resolvedPrice}/kg for ${parsedQty}kg of ${crop.name}`,
        messageType: 'offer',
        offer: offer._id,
      });

      // 3. Update Conversation's last message
      await Conversation.findByIdAndUpdate(conversation._id, {
        lastMessage: chatMessage._id,
        lastMessageAt: new Date(),
      });

      // 4. Emit to socket if online
      if (global.io) {
        global.io.to(`conversation:${conversation._id}`).emit('message:new', {
          _id: chatMessage._id,
          conversationId: conversation._id,
          sender: { _id: buyerId, name: buyer.name },
          recipient: crop.farmer._id.toString(),
          content: chatMessage.content,
          messageType: 'offer',
          offer: offer, // Full populated offer object
          createdAt: chatMessage.createdAt,
          isRead: false
        });
      }
    } catch (chatErr) {
      logger.error('Failed to create chat message for offer:', chatErr);
      // We don't fail the entire offer if chat fails, but we log it
    }

    // Notify farmer (existing notification system)
    NotificationService.create({
      recipientId: crop.farmer._id,
      senderId: buyerId,
      type: 'new_offer',
      title: '💰 New Offer Received!',
      body: `${buyer.name} offered ₹${resolvedPrice}/kg for ${parsedQty}kg of ${crop.name}`,
      refModel: 'Offer',
      refId: offer._id,
      priority: 'high',
    }).catch(logger.error);

    logger.info(`✅ Offer created: ${offer._id} by buyer ${buyerId}`);
    return res.status(201).json({ success: true, message: 'Offer submitted', data: offer });
  } catch (err) {
    logger.error('makeOffer error:', err);
    return res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'development' ? err.message : 'Failed to create offer',
    });
  }
};

// ─── POST /api/v1/offers/:id/accept — Farmer or Buyer accepts ──────────────
const acceptOffer = async (req, res) => {
  try {
    const { id: offerId } = req.params;
    const userId = req.user.id || req.user._id;

    // Execute atomic transaction for acceptance
    const contract = await transactionOfferAcceptance(offerId, userId);

    // ─── Notifications ────────────────────────────────────────────────────────
    // Determine who was the acceptor and who is the recipient
    const isFarmerAccepting = contract.farmer.toString() === userId.toString();
    const recipientId = isFarmerAccepting ? contract.buyer : contract.farmer;
    const title = isFarmerAccepting ? '✅ Offer Accepted! Pay Now' : '🤝 Counter-Offer Accepted!';
    const body = isFarmerAccepting 
        ? `The farmer accepted your offer for ${contract.terms.cropName}. Proceed to choose a payment method.`
        : `The buyer accepted your counter-offer for ${contract.terms.cropName}. Contract is now active.`;

    NotificationService.create({
      recipientId,
      senderId: userId,
      type: 'offer_accepted',
      title,
      body,
      refModel: 'Contract',
      refId: contract._id,
      priority: 'high',
    }).catch(logger.error);

    if (global.io) {
      global.io.to(`user:${contract.buyer}`).emit('offer_accepted', {
        offerId,
        contractId: contract._id,
        cropName: contract.terms.cropName,
        totalAmount: contract.terms.totalAmount,
      });
    }

    logger.info(`✅ Offer accepted via transaction: ${offerId} → contract: ${contract._id}`);

    return res.status(200).json({
      success: true,
      message: 'Offer accepted. Contract created.',
      data: {
        offer: { _id: offerId, status: 'accepted' },
        contract: {
          _id: contract._id,
          contractId: contract.contractId,
          cropName: contract.terms.cropName,
          quantity: contract.terms.quantity,
          totalAmount: contract.terms.totalAmount,
          paymentStatus: contract.payment.status,
        },
      },
    });
  } catch (err) {
    logger.error('acceptOffer error:', err);
    // Determine if it was a business logic error or server error
    const msg = [
      'Offer not found',
      'Offer is already',
      'Offer has expired',
      'Insufficient crop quantity'
    ].some(m => err.message.includes(m)) ? err.message : 'Failed to accept offer';

    return res.status(err.message.includes('Insufficient') ? 409 : 500).json({
      success: false,
      error: msg,
    });
  }
};

// ─── POST /api/v1/offers/:id/reject — Farmer or buyer rejects ─────────────────
const rejectOffer = async (req, res) => {
  try {
    const { id: offerId } = req.params;
    const { reason } = req.body;
    const userId = req.user.id || req.user._id;

    const offer = await Offer.findById(offerId);
    if (!offer) return res.status(404).json({ success: false, error: 'Offer not found' });

    const isFarmer = offer.farmer.toString() === userId.toString();
    const isBuyer = offer.buyer.toString() === userId.toString();
    if (!isFarmer && !isBuyer) {
      return res.status(403).json({ success: false, error: 'Not authorized to reject this offer' });
    }
    if (!['pending', 'countered', 'accepted'].includes(offer.status)) {
      return res.status(400).json({ success: false, error: `Cannot reject a ${offer.status} offer` });
    }

    offer.status = 'rejected';
    offer.rejectionReason = reason ? sanitizer.sanitizeString(reason) : undefined;
    offer.rejectedBy = isFarmer ? 'farmer' : 'buyer';
    offer.negotiationHistory.push({
      by: isFarmer ? 'farmer' : 'buyer', action: 'reject', price: offer.pricePerKg, timestamp: new Date(),
    });
    await offer.save();

    if (isBuyer && offer.contract) {
      await Contract.findByIdAndUpdate(offer.contract, {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancellationReason: reason || 'Buyer rejected after acceptance',
        cancelledBy: userId,
      });
      await Crop.findByIdAndUpdate(offer.crop, { $inc: { availableQuantity: offer.quantity, quantity: offer.quantity } });
    }

    const recipientId = isFarmer ? offer.buyer : offer.farmer;
    NotificationService.create({
      recipientId,
      senderId: userId,
      type: 'offer_rejected',
      title: '❌ Offer Rejected',
      body: `Your offer for ${offer.cropName || 'the crop'} was rejected. ${reason ? `Reason: ${reason}` : ''}`,
      refModel: 'Offer',
      refId: offer._id,
    }).catch(logger.error);

    logger.info(`✅ Offer rejected: ${offerId} by ${isFarmer ? 'farmer' : 'buyer'}`);
    return res.status(200).json({ success: true, message: 'Offer rejected', data: offer });
  } catch (err) {
    logger.error('rejectOffer error:', err);
    return res.status(500).json({ success: false, error: 'Failed to reject offer' });
  }
};

// ─── POST /api/v1/offers/:id/counter ─────────────────────────────────────────
const counterOffer = async (req, res) => {
  try {
    const { id: offerId } = req.params;
    const { pricePerKg, message } = req.body;
    const userId = req.user.id || req.user._id;

    const offer = await Offer.findById(offerId).populate('farmer buyer crop');
    if (!offer) return res.status(404).json({ success: false, error: 'Offer not found' });

    const isFarmer = offer.farmer._id.toString() === userId.toString();
    const isBuyer = offer.buyer._id.toString() === userId.toString();
    if (!isFarmer && !isBuyer) {
      return res.status(403).json({ success: false, error: 'Not a party to this offer' });
    }
    if (!['pending', 'countered'].includes(offer.status)) {
      return res.status(400).json({ success: false, error: 'Can only counter a pending offer' });
    }

    const counterPrice = parseFloat(pricePerKg);
    offer.status = 'countered';
    offer.counterOffer = {
      price: counterPrice,
      message: message ? sanitizer.sanitizeString(message) : undefined,
      by: isFarmer ? 'farmer' : 'buyer',
      createdAt: new Date(),
    };
    offer.negotiationHistory.push({
      by: isFarmer ? 'farmer' : 'buyer', action: 'counter',
      price: counterPrice, message: message, timestamp: new Date(),
    });
    await offer.save();

    const recipientId = isFarmer ? offer.buyer._id : offer.farmer._id;
    NotificationService.create({
      recipientId,
      senderId: userId,
      type: 'offer_countered',
      title: '🔄 Counter Offer Received',
      body: `New price proposed: ₹${counterPrice}/kg for ${offer.crop?.name || 'the crop'}`,
      refModel: 'Offer',
      refId: offer._id,
      priority: 'high',
    }).catch(logger.error);

    logger.info(`✅ Counter offer sent on: ${offerId}`);
    return res.status(200).json({ success: true, message: 'Counter offer sent', data: offer });
  } catch (err) {
    logger.error('counterOffer error:', err);
    return res.status(500).json({ success: false, error: 'Failed to send counter offer' });
  }
};

// ─── POST /api/v1/offers/:id/cancel — Buyer cancels their own offer ───────────
const cancelOffer = async (req, res) => {
  try {
    const { id: offerId } = req.params;
    const buyerId = req.user.id || req.user._id;

    const offer = await Offer.findById(offerId);
    if (!offer) return res.status(404).json({ success: false, error: 'Offer not found' });
    if (offer.buyer.toString() !== buyerId.toString()) {
      return res.status(403).json({ success: false, error: 'Only the buyer can cancel' });
    }
    if (!['pending', 'countered'].includes(offer.status)) {
      return res.status(400).json({ success: false, error: `Cannot cancel a ${offer.status} offer` });
    }

    offer.status = 'cancelled';
    await offer.save();

    logger.info(`✅ Offer cancelled: ${offerId}`);
    return res.status(200).json({ success: true, message: 'Offer cancelled', data: offer });
  } catch (err) {
    logger.error('cancelOffer error:', err);
    return res.status(500).json({ success: false, error: 'Failed to cancel offer' });
  }
};

module.exports = { getOffers, getOfferDetail, makeOffer, acceptOffer, rejectOffer, counterOffer, cancelOffer };