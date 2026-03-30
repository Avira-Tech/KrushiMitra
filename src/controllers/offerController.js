const Offer = require('../models/Offer');
const Crop = require('../models/Crop');
const Contract = require('../models/Contract');
const NotificationService = require('../services/notificationService');
const { parsePagination } = require('../utils/helpers');
const { sendSuccess, sendCreated, sendError, sendNotFound, sendForbidden, sendPaginated } = require('../utils/apiResponse');
const logger = require('../utils/logger');

// ─── CREATE OFFER ─────────────────────────────────────────────────────────────────────────
const createOffer = async (req, res) => {
  const { cropId, quantity, offeredPrice, message } = req.body;
  const buyer = req.user;

  const crop = await Crop.findById(cropId).populate('farmer', 'name phone');
  if (!crop) return sendNotFound(res, 'Crop not found');
  if (!crop.isAvailable || crop.status !== 'active') {
    return sendError(res, { message: 'Crop is not available for offers', statusCode: 400 });
  }
  if (crop.farmer._id.toString() === buyer._id.toString()) {
    return sendForbidden(res, 'Cannot make offer on your own crop');
  }
  if (quantity < crop.minimumOrder) {
    return sendError(res, { message: `Minimum order quantity is ${crop.minimumOrder} kg`, statusCode: 400 });
  }
  if (quantity > crop.availableQuantity) {
    return sendError(res, { message: `Only ${crop.availableQuantity} kg available`, statusCode: 400 });
  }

  // Check for existing pending offer from same buyer
  const existingOffer = await Offer.findOne({ crop: cropId, buyer: buyer._id, status: 'pending' });
  if (existingOffer) {
    return sendError(res, { message: 'You already have a pending offer for this crop', statusCode: 409 });
  }

  const offer = await Offer.create({
    crop: cropId,
    farmer: crop.farmer._id,
    buyer: buyer._id,
    quantity,
    offeredPrice,
    message,
    negotiationHistory: [{ by: 'buyer', action: 'offer', price: offeredPrice, message }],
  });

  await Crop.findByIdAndUpdate(cropId, { $inc: { offerCount: 1 } });

  await offer.populate([
    { path: 'crop', select: 'name pricePerKg quality images' },
    { path: 'buyer', select: 'name phone' },
    { path: 'farmer', select: 'name phone' },
  ]);

  // Notify farmer
  await NotificationService.notifyNewOffer(offer, crop, crop.farmer, buyer);

  // Emit socket event
  if (global.io) {
    global.io.to(`user:${crop.farmer._id}`).emit('new_offer', {
      offerId: offer._id,
      cropName: crop.name,
      buyerName: buyer.name,
      price: offeredPrice,
      quantity,
    });
  }

  logger.info(`Offer created: ${offer._id} by buyer ${buyer._id}`);

  return sendCreated(res, {
    message: 'Offer sent successfully! Farmer will be notified.',
    data: { offer },
  });
};

// ─── UPDATE OFFER (Accept/Reject/Counter/Cancel) ──────────────────────────────────
const updateOffer = async (req, res) => {
  const { action, counterPrice, message, reason } = req.body;
  const user = req.user;

  const offer = await Offer.findById(req.params.id)
    .populate('crop', 'name pricePerKg images')
    .populate('farmer', 'name phone')
    .populate('buyer', 'name phone');

  if (!offer) return sendNotFound(res, 'Offer not found');

  const isFarmer = offer.farmer._id.toString() === user._id.toString();
  const isBuyer = offer.buyer._id.toString() === user._id.toString();

  if (!isFarmer && !isBuyer) return sendForbidden(res, 'Not authorized');
  if (['accepted', 'rejected', 'contracted'].includes(offer.status)) {
    return sendError(res, { message: `Offer is already ${offer.status}`, statusCode: 400 });
  }

  const historyEntry = {
    by: isFarmer ? 'farmer' : 'buyer',
    action,
    price: counterPrice || offer.offeredPrice,
    message,
    timestamp: new Date(),
  };

  switch (action) {
    case 'accept': {
      if (!isFarmer) return sendForbidden(res, 'Only farmer can accept offers');
      offer.status = 'accepted';

      // Auto-generate contract
      const contract = await Contract.create({
        offer: offer._id,
        crop: offer.crop._id,
        farmer: offer.farmer._id,
        buyer: offer.buyer._id,
        terms: {
          cropName: offer.crop.name,
          quantity: offer.quantity,
          pricePerKg: offer.counterOffer?.price || offer.offeredPrice,
          totalAmount: offer.totalAmount,
          deliveryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          paymentTerms: '50% advance, 50% on delivery',
          qualityGrade: offer.crop.quality,
        },
      });

      offer.status = 'contracted';
      offer.contract = contract._id;

      // Update crop available quantity
      await Crop.findByIdAndUpdate(offer.crop._id, {
        $inc: { availableQuantity: -offer.quantity },
      });

      await NotificationService.notifyOfferAccepted(offer, offer.crop, offer.farmer, offer.buyer);
      await NotificationService.notifyContractCreated(contract, offer.farmer._id, offer.buyer._id);

      if (global.io) {
        global.io.to(`user:${offer.buyer._id}`).emit('offer_accepted', {
          offerId: offer._id,
          contractId: contract._id,
          message: 'Your offer was accepted! Contract generated.',
        });
      }

      offer.negotiationHistory.push(historyEntry);
      await offer.save();

      return sendSuccess(res, {
        message: 'Offer accepted! Contract has been generated.',
        data: { offer, contract },
      });
    }

    case 'reject': {
      if (!isFarmer) return sendForbidden(res, 'Only farmer can reject offers');
      offer.status = 'rejected';
      offer.rejectionReason = reason;
      offer.rejectedBy = 'farmer';
      offer.negotiationHistory.push(historyEntry);
      await offer.save();

      await NotificationService.notifyOfferRejected(offer, offer.crop, offer.farmer, offer.buyer);

      if (global.io) {
        global.io.to(`user:${offer.buyer._id}`).emit('offer_rejected', { offerId: offer._id });
      }

      return sendSuccess(res, { message: 'Offer rejected', data: { offer } });
    }

    case 'counter': {
      if (!counterPrice) return sendError(res, { message: 'Counter price is required', statusCode: 400 });
      offer.status = 'countered';
      offer.counterOffer = {
        price: counterPrice,
        message,
        by: isFarmer ? 'farmer' : 'buyer',
        createdAt: new Date(),
      };
      offer.negotiationHistory.push({ ...historyEntry, action: 'counter', price: counterPrice });
      await offer.save();

      const recipientId = isFarmer ? offer.buyer._id : offer.farmer._id;
      const initiatorName = isFarmer ? offer.farmer.name : offer.buyer.name;
      await NotificationService.notifyCounterOffer(offer, offer.crop, initiatorName, recipientId);

      if (global.io) {
        global.io.to(`user:${recipientId}`).emit('counter_offer', {
          offerId: offer._id,
          counterPrice,
          by: isFarmer ? 'farmer' : 'buyer',
        });
      }

      return sendSuccess(res, { message: 'Counter offer sent', data: { offer } });
    }

    case 'cancel': {
      if (!isBuyer) return sendForbidden(res, 'Only buyer can cancel their offer');
      offer.status = 'cancelled';
      offer.negotiationHistory.push(historyEntry);
      await offer.save();
      return sendSuccess(res, { message: 'Offer cancelled', data: { offer } });
    }

    default:
      return sendError(res, { message: 'Invalid action', statusCode: 400 });
  }
};

// ─── GET OFFERS ─────────────────────────────────────────────────────────────────────────────
const getMyOffers = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { status, type = 'received' } = req.query;
  const user = req.user;

  const query = {};
  if (user.role === 'farmer') {
    query[type === 'received' ? 'farmer' : 'buyer'] = user._id;
  } else {
    query[type === 'sent' ? 'buyer' : 'farmer'] = user._id;
  }
  if (status) query.status = status;

  const [offers, total] = await Promise.all([
    Offer.find(query)
      .populate('crop', 'name images pricePerKg quality')
      .populate('farmer', 'name phone rating')
      .populate('buyer', 'name phone companyName')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Offer.countDocuments(query),
  ]);

  return sendPaginated(res, { data: { offers }, page, limit, total });
};

const getOfferById = async (req, res) => {
  const offer = await Offer.findById(req.params.id)
    .populate('crop', 'name images pricePerKg quality location')
    .populate('farmer', 'name phone rating avatar')
    .populate('buyer', 'name phone companyName avatar');

  if (!offer) return sendNotFound(res, 'Offer not found');

  const user = req.user;
  const hasAccess =
    offer.farmer._id.toString() === user._id.toString() ||
    offer.buyer._id.toString() === user._id.toString() ||
    user.role === 'admin';

  if (!hasAccess) return sendForbidden(res, 'Not authorized');

  return sendSuccess(res, { data: { offer } });
};

module.exports = { createOffer, updateOffer, getMyOffers, getOfferById };
