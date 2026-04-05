// const Offer = require('../models/Offer');
// const Crop = require('../models/Crop');
// const User = require('../models/User');
// const Contract = require('../models/Contract');
// const { validationResult } = require('express-validator');
// const logger = require('../utils/logger');
// const sanitizer = require('../utils/sanitizer');

// /**
//  * Get all offers (for buyer's offers or farmer's received offers)
//  * GET /api/v1/offers
//  */
// const getOffers = async (req, res) => {
//   try {
//     const userId = req.user.id;
//     const userRole = req.user.role;
//     const { status, skip = 0, limit = 20 } = req.query;

//     let filter = {};

//     // Farmer sees offers received for their crops
//     if (userRole === 'farmer') {
//       filter.farmer = userId;
//     }
//     // Buyer sees offers they made
//     else if (userRole === 'buyer') {
//       filter.buyer = userId;
//     }

//     if (status) {
//       filter.status = status;
//     }

//     const offers = await Offer.find(filter)
//       .populate('crop', 'name category images pricePerUnit')
//       .populate('farmer', 'name phone email avatar')
//       .populate('buyer', 'name phone email avatar')
//       .sort({ createdAt: -1 })
//       .skip(parseInt(skip))
//       .limit(parseInt(limit));

//     const total = await Offer.countDocuments(filter);

//     return res.status(200).json({
//       success: true,
//       data: offers,
//       pagination: {
//         total,
//         skip: parseInt(skip),
//         limit: parseInt(limit),
//         pages: Math.ceil(total / parseInt(limit)),
//       },
//     });
//   } catch (error) {
//     logger.error('❌ Error fetching offers:', error);
//     return res.status(500).json({
//       success: false,
//       error: 'Failed to fetch offers',
//     });
//   }
// };

// /**
//  * Get offer detail
//  * GET /api/v1/offers/:id
//  */
// const getOfferDetail = async (req, res) => {
//   try {
//     const { id } = req.params;
//     const userId = req.user.id;

//     const offer = await Offer.findById(id)
//       .populate('crop', 'name category images pricePerUnit quantity availableQuantity')
//       .populate('farmer', 'name phone email avatar rating')
//       .populate('buyer', 'name phone email avatar rating');

//     if (!offer) {
//       return res.status(404).json({
//         success: false,
//         error: 'Offer not found',
//       });
//     }

//     // Verify user is part of this offer
//     if (offer.farmer._id.toString() !== userId && offer.buyer._id.toString() !== userId) {
//       return res.status(403).json({
//         success: false,
//         error: 'Unauthorized to view this offer',
//       });
//     }

//     return res.status(200).json({
//       success: true,
//       data: offer,
//     });
//   } catch (error) {
//     logger.error('❌ Error fetching offer detail:', error);
//     return res.status(500).json({
//       success: false,
//       error: 'Failed to fetch offer details',
//     });
//   }
// };

// /**
//  * Make offer on crop
//  * POST /api/v1/offers
//  */
// const makeOffer = async (req, res) => {
//   try {
//     const errors = validationResult(req);
//     if (!errors.isEmpty()) {
//       return res.status(400).json({
//         success: false,
//         errors: errors.array().map(e => ({
//           field: e.param,
//           message: e.msg,
//         })),
//       });
//     }

//     const buyerId = req.user.id;
//     const { cropId, quantity, pricePerUnit, deliveryLocation, deliveryDate, paymentTerms, notes } = req.body;

//     // Find crop
//     const crop = await Crop.findById(cropId).populate('farmer');
//     if (!crop) {
//       return res.status(404).json({
//         success: false,
//         error: 'Crop not found',
//       });
//     }

//     // ✅ Verify buyer is not the crop owner
//     if (crop.farmer._id.toString() === buyerId) {
//       return res.status(400).json({
//         success: false,
//         error: 'Cannot make offer on your own crop',
//       });
//     }

//     // ✅ Check available quantity
//     if (quantity > crop.availableQuantity) {
//       return res.status(400).json({
//         success: false,
//         error: `Only ${crop.availableQuantity} ${crop.unit} available`,
//       });
//     }

//     // ✅ Verify buyer exists and is a buyer
//     const buyer = await User.findById(buyerId);
//     if (!buyer) {
//       return res.status(404).json({
//         success: false,
//         error: 'Buyer not found',
//       });
//     }

//     if (buyer.role !== 'buyer') {
//       return res.status(403).json({
//         success: false,
//         error: 'Only buyers can make offers',
//       });
//     }

//     // Calculate total amount
//     const totalAmount = parseFloat(quantity) * parseFloat(pricePerUnit);

//     // Create offer
//     const offer = new Offer({
//       crop: cropId,
//       farmer: crop.farmer._id,
//       buyer: buyerId,
//       quantity: parseFloat(quantity),
//       pricePerUnit: parseFloat(pricePerUnit),
//       totalAmount,
//       deliveryLocation: sanitizer.sanitizeString(deliveryLocation),
//       deliveryDate: new Date(deliveryDate),
//       paymentTerms,
//       notes: sanitizer.sanitizeString(notes),
//       status: 'pending',
//       expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
//     });

//     await offer.save();

//     // Populate references
//     await offer.populate([
//       { path: 'crop', select: 'name category images' },
//       { path: 'farmer', select: 'name phone email' },
//       { path: 'buyer', select: 'name phone email' },
//     ]);

//     logger.info(`✅ Offer created by buyer ${buyerId}:`, offer._id);

//     return res.status(201).json({
//       success: true,
//       message: 'Offer created successfully',
//       data: offer,
//     });
//   } catch (error) {
//     logger.error('❌ Error making offer:', error);
//     return res.status(500).json({
//       success: false,
//       error: process.env.NODE_ENV === 'development' ? error.message : 'Failed to make offer',
//     });
//   }
// };

// /**
//  * Accept offer
//  * POST /api/v1/offers/:id/accept
//  */
// const acceptOffer = async (req, res) => {
//   try {
//     const { id: offerId } = req.params;
//     const farmerId = req.user.id;

//     // Find offer
//     const offer = await Offer.findById(offerId).populate(['crop', 'farmer', 'buyer']);
//     if (!offer) {
//       return res.status(404).json({
//         success: false,
//         error: 'Offer not found',
//       });
//     }

//     // ✅ Verify farmer owns the crop
//     if (offer.farmer._id.toString() !== farmerId) {
//       return res.status(403).json({
//         success: false,
//         error: 'Only the farmer can accept/reject offers',
//       });
//     }

//     // ✅ Check offer status
//     if (offer.status !== 'pending') {
//       return res.status(400).json({
//         success: false,
//         error: `Offer is already ${offer.status}`,
//       });
//     }

//     // ✅ Check offer expiration
//     if (new Date() > offer.expiresAt) {
//       return res.status(400).json({
//         success: false,
//         error: 'Offer has expired',
//       });
//     }

//     // Update offer status
//     offer.status = 'accepted';
//     offer.acceptedAt = new Date();
//     await offer.save();

//     // Create contract
//     const contract = new Contract({
//       contractId: `CTR-${Date.now()}`,
//       offer: offerId,
//       crop: offer.crop._id,
//       farmer: offer.farmer._id,
//       buyer: offer.buyer._id,
//       quantity: offer.quantity,
//       unit: offer.crop.unit,
//       pricePerUnit: offer.pricePerUnit,
//       totalAmount: offer.totalAmount,
//       deliveryLocation: offer.deliveryLocation,
//       deliveryDate: offer.deliveryDate,
//       paymentTerms: offer.paymentTerms,
//       status: 'pending',
//       payment: {
//         status: 'pending',
//         amount: offer.totalAmount,
//       },
//     });

//     await contract.save();

//     // Populate contract
//     await contract.populate([
//       { path: 'crop', select: 'name category images' },
//       { path: 'farmer', select: 'name phone email' },
//       { path: 'buyer', select: 'name phone email' },
//     ]);

//     logger.info(`✅ Offer accepted by farmer ${farmerId}:`, offerId);

//     return res.status(200).json({
//       success: true,
//       message: 'Offer accepted. Contract created.',
//       data: {
//         offer: {
//           _id: offer._id,
//           status: 'accepted',
//         },
//         contract,
//       },
//     });
//   } catch (error) {
//     logger.error('❌ Error accepting offer:', error);
//     return res.status(500).json({
//       success: false,
//       error: process.env.NODE_ENV === 'development' ? error.message : 'Failed to accept offer',
//     });
//   }
// };

// /**
//  * Reject offer
//  * POST /api/v1/offers/:id/reject
//  */
// const rejectOffer = async (req, res) => {
//   try {
//     const { id: offerId } = req.params;
//     const { reason } = req.body;
//     const farmerId = req.user.id;

//     const offer = await Offer.findById(offerId);
//     if (!offer) {
//       return res.status(404).json({
//         success: false,
//         error: 'Offer not found',
//       });
//     }

//     if (offer.farmer.toString() !== farmerId) {
//       return res.status(403).json({
//         success: false,
//         error: 'Only the farmer can reject this offer',
//       });
//     }

//     if (offer.status !== 'pending') {
//       return res.status(400).json({
//         success: false,
//         error: 'Only pending offers can be rejected',
//       });
//     }

//     offer.status = 'rejected';
//     offer.rejectionReason = sanitizer.sanitizeString(reason);
//     await offer.save();

//     logger.info(`✅ Offer rejected by farmer ${farmerId}:`, offerId);

//     return res.status(200).json({
//       success: true,
//       message: 'Offer rejected',
//       data: offer,
//     });
//   } catch (error) {
//     logger.error('❌ Error rejecting offer:', error);
//     return res.status(500).json({
//       success: false,
//       error: 'Failed to reject offer',
//     });
//   }
// };

// /**
//  * Cancel offer (buyer can cancel their own offers)
//  * POST /api/v1/offers/:id/cancel
//  */
// const cancelOffer = async (req, res) => {
//   try {
//     const { id: offerId } = req.params;
//     const buyerId = req.user.id;

//     const offer = await Offer.findById(offerId);
//     if (!offer) {
//       return res.status(404).json({
//         success: false,
//         error: 'Offer not found',
//       });
//     }

//     if (offer.buyer.toString() !== buyerId) {
//       return res.status(403).json({
//         success: false,
//         error: 'Only the buyer can cancel this offer',
//       });
//     }

//     if (!['pending', 'accepted'].includes(offer.status)) {
//       return res.status(400).json({
//         success: false,
//         error: `Cannot cancel ${offer.status} offer`,
//       });
//     }

//     offer.status = 'cancelled';
//     await offer.save();

//     logger.info(`✅ Offer cancelled by buyer ${buyerId}:`, offerId);

//     return res.status(200).json({
//       success: true,
//       message: 'Offer cancelled',
//       data: offer,
//     });
//   } catch (error) {
//     logger.error('❌ Error cancelling offer:', error);
//     return res.status(500).json({
//       success: false,
//       error: 'Failed to cancel offer',
//     });
//   }
// };

// module.exports = {
//   getOffers,
//   getOfferDetail,
//   makeOffer,
//   acceptOffer,
//   rejectOffer,
//   cancelOffer,
// };

// 'use strict';
// /**
//  * offerController.js
//  * All prices use pricePerKg consistently (matches Crop model and frontend).
//  * acceptOffer delegates to transactionOfferAcceptance for atomic DB operations.
//  */

// const Offer    = require('../models/Offer');
// const Crop     = require('../models/Crop');
// const User     = require('../models/User');
// const Contract = require('../models/Contract');
// const { validationResult } = require('express-validator');
// const logger   = require('../utils/logger');
// const sanitizer = require('../utils/sanitizer');
// const { transactionOfferAcceptance } = require('../services/transactionService');
// const NotificationService            = require('../services/notificationService');

// // ─── GET /api/v1/offers ───────────────────────────────────────────────────────
// const getOffers = async (req, res) => {
//   try {
//     const userId   = req.user.id;
//     const userRole = req.user.role;
//     const { status, skip = 0, limit = 20 } = req.query;

//     const filter = {};
//     if (userRole === 'farmer') filter.farmer = userId;
//     else if (userRole === 'buyer') filter.buyer = userId;
//     if (status) filter.status = status;

//     const [offers, total] = await Promise.all([
//       Offer.find(filter)
//         .populate('crop',   'name category images pricePerKg quantity availableQuantity')
//         .populate('farmer', 'name phone email avatar rating')
//         .populate('buyer',  'name phone email avatar rating')
//         .sort({ createdAt: -1 })
//         .skip(parseInt(skip))
//         .limit(parseInt(limit)),
//       Offer.countDocuments(filter),
//     ]);

//     return res.status(200).json({
//       success: true,
//       data: offers,
//       pagination: {
//         total,
//         skip:  parseInt(skip),
//         limit: parseInt(limit),
//         pages: Math.ceil(total / parseInt(limit)),
//       },
//     });
//   } catch (err) {
//     logger.error('getOffers error:', err);
//     return res.status(500).json({ success: false, error: 'Failed to fetch offers' });
//   }
// };

// // ─── GET /api/v1/offers/:id ───────────────────────────────────────────────────
// const getOfferDetail = async (req, res) => {
//   try {
//     const offer = await Offer.findById(req.params.id)
//       .populate('crop',   'name category images pricePerKg quantity availableQuantity')
//       .populate('farmer', 'name phone email avatar rating')
//       .populate('buyer',  'name phone email avatar rating');

//     if (!offer) return res.status(404).json({ success: false, error: 'Offer not found' });

//     const userId = req.user.id;
//     const isParty =
//       offer.farmer._id.toString() === userId ||
//       offer.buyer._id.toString()  === userId;

//     if (!isParty) return res.status(403).json({ success: false, error: 'Unauthorized' });

//     return res.status(200).json({ success: true, data: offer });
//   } catch (err) {
//     logger.error('getOfferDetail error:', err);
//     return res.status(500).json({ success: false, error: 'Failed to fetch offer' });
//   }
// };

// // ─── POST /api/v1/offers ──────────────────────────────────────────────────────
// const makeOffer = async (req, res) => {
//   try {
//     const errors = validationResult(req);
//     if (!errors.isEmpty()) {
//       return res.status(400).json({
//         success: false,
//         errors: errors.array().map((e) => ({ field: e.param, message: e.msg })),
//       });
//     }

//     const buyerId = req.user.id;
//     // Accept both pricePerKg (frontend) and pricePerUnit (legacy) for compatibility
//     const {
//       cropId,
//       quantity,
//       pricePerKg,
//       pricePerUnit,            // fallback alias
//       deliveryLocation,
//       deliveryDate,
//       paymentTerms,
//       message,
//     } = req.body;

//     const resolvedPrice = parseFloat(pricePerKg || pricePerUnit);
//     if (!resolvedPrice || resolvedPrice <= 0) {
//       return res.status(400).json({ success: false, error: 'Valid pricePerKg is required' });
//     }

//     // Validate crop exists
//     const crop = await Crop.findById(cropId).populate('farmer');
//     if (!crop) return res.status(404).json({ success: false, error: 'Crop not found' });

//     if (crop.farmer._id.toString() === buyerId) {
//       return res.status(400).json({ success: false, error: 'Cannot make offer on your own crop' });
//     }

//     const parsedQty = parseFloat(quantity);
//     if (parsedQty > crop.availableQuantity) {
//       return res.status(400).json({
//         success: false,
//         error: `Only ${crop.availableQuantity} kg available`,
//       });
//     }

//     // Validate buyer role
//     const buyer = await User.findById(buyerId);
//     if (!buyer || buyer.role !== 'buyer') {
//       return res.status(403).json({ success: false, error: 'Only buyers can make offers' });
//     }

//     const totalAmount = parseFloat((parsedQty * resolvedPrice).toFixed(2));

//     const offer = new Offer({
//       crop:             cropId,
//       farmer:           crop.farmer._id,
//       buyer:            buyerId,
//       quantity:         parsedQty,
//       pricePerKg:       resolvedPrice,
//       totalAmount,
//       deliveryLocation: deliveryLocation ? sanitizer.sanitizeString(deliveryLocation) : undefined,
//       deliveryDate:     deliveryDate ? new Date(deliveryDate) : undefined,
//       paymentTerms:     paymentTerms || 'KrushiMitra Secure Escrow',
//       message:          message ? sanitizer.sanitizeString(message) : undefined,
//       status:           'pending',
//       expiresAt:        new Date(Date.now() + 48 * 60 * 60 * 1000),
//     });

//     await offer.save();

//     await offer.populate([
//       { path: 'crop',   select: 'name category images pricePerKg' },
//       { path: 'farmer', select: 'name phone email' },
//       { path: 'buyer',  select: 'name phone email' },
//     ]);

//     // Notify farmer about new offer
//     NotificationService.notifyNewOffer(offer, crop, crop.farmer, buyer).catch(logger.error);

//     logger.info(`✅ Offer created: ${offer._id} by buyer ${buyerId}`);

//     return res.status(201).json({
//       success: true,
//       message: 'Offer submitted successfully',
//       data: offer,
//     });
//   } catch (err) {
//     logger.error('makeOffer error:', err);
//     return res.status(500).json({
//       success: false,
//       error: process.env.NODE_ENV === 'development' ? err.message : 'Failed to create offer',
//     });
//   }
// };

// // ─── POST /api/v1/offers/:id/accept ──────────────────────────────────────────
// /**
//  * Delegates to transactionOfferAcceptance for atomic:
//  *   1. Offer status → accepted
//  *   2. Crop availableQuantity -= offer.quantity  (prevents overselling)
//  *   3. Contract creation
//  * All three writes happen inside a single MongoDB session/transaction.
//  */
// const acceptOffer = async (req, res) => {
//   try {
//     const { id: offerId } = req.params;
//     const farmerId = req.user.id;

//     // Pre-flight checks before entering the transaction
//     const offer = await Offer.findById(offerId).populate('farmer');
//     if (!offer) return res.status(404).json({ success: false, error: 'Offer not found' });

//     if (offer.farmer._id.toString() !== farmerId) {
//       return res.status(403).json({ success: false, error: 'Only the crop owner can accept offers' });
//     }
//     if (offer.status !== 'pending') {
//       return res.status(400).json({ success: false, error: `Offer is already ${offer.status}` });
//     }
//     if (new Date() > offer.expiresAt) {
//       return res.status(400).json({ success: false, error: 'Offer has expired' });
//     }

//     // Execute atomic transaction: accept offer + decrement stock + create contract
//     const contract = await transactionOfferAcceptance(offerId);

//     // Populate contract for response
//     await contract.populate([
//       { path: 'farmer', select: 'name phone email' },
//       { path: 'buyer',  select: 'name phone email' },
//       { path: 'crop',   select: 'name images' },
//     ]);

//     // Notify buyer
//     NotificationService.notifyOfferAccepted(offer, { name: offer.cropName }, offer.farmer, { _id: offer.buyer }).catch(logger.error);

//     logger.info(`✅ Offer accepted: ${offerId}, contract: ${contract._id}`);

//     return res.status(200).json({
//       success: true,
//       message: 'Offer accepted. Contract created.',
//       data: {
//         offer:    { _id: offer._id, status: 'accepted' },
//         contract: {
//           _id:         contract._id,
//           contractId:  contract.contractId,
//           cropName:    contract.terms?.cropName,
//           farmerName:  contract.farmer?.name,
//           buyerName:   contract.buyer?.name,
//           quantity:    contract.terms?.quantity,
//           pricePerKg:  contract.terms?.pricePerKg,
//           totalAmount: contract.terms?.totalAmount,
//           status:      contract.status,
//         },
//       },
//     });
//   } catch (err) {
//     logger.error('acceptOffer error:', err);
//     const status = err.message.includes('Insufficient') ? 409 : 500;
//     return res.status(status).json({
//       success: false,
//       error: process.env.NODE_ENV === 'development' ? err.message : 'Failed to accept offer',
//     });
//   }
// };

// // ─── POST /api/v1/offers/:id/reject ──────────────────────────────────────────
// const rejectOffer = async (req, res) => {
//   try {
//     const { id: offerId } = req.params;
//     const { reason }      = req.body;
//     const farmerId        = req.user.id;

//     const offer = await Offer.findById(offerId);
//     if (!offer) return res.status(404).json({ success: false, error: 'Offer not found' });

//     if (offer.farmer.toString() !== farmerId) {
//       return res.status(403).json({ success: false, error: 'Only the farmer can reject this offer' });
//     }
//     if (offer.status !== 'pending') {
//       return res.status(400).json({ success: false, error: 'Only pending offers can be rejected' });
//     }

//     offer.status          = 'rejected';
//     offer.rejectionReason = reason ? sanitizer.sanitizeString(reason) : undefined;
//     offer.rejectedBy      = 'farmer';
//     await offer.save();

//     logger.info(`✅ Offer rejected: ${offerId}`);
//     return res.status(200).json({ success: true, message: 'Offer rejected', data: offer });
//   } catch (err) {
//     logger.error('rejectOffer error:', err);
//     return res.status(500).json({ success: false, error: 'Failed to reject offer' });
//   }
// };

// // ─── POST /api/v1/offers/:id/counter ─────────────────────────────────────────
// const counterOffer = async (req, res) => {
//   try {
//     const { id: offerId }             = req.params;
//     const { pricePerKg, message }     = req.body;
//     const userId                      = req.user.id;

//     const offer = await Offer.findById(offerId).populate('farmer buyer');
//     if (!offer) return res.status(404).json({ success: false, error: 'Offer not found' });

//     const isFarmer = offer.farmer._id.toString() === userId;
//     const isBuyer  = offer.buyer._id.toString()  === userId;
//     if (!isFarmer && !isBuyer) {
//       return res.status(403).json({ success: false, error: 'Not a party to this offer' });
//     }
//     if (offer.status !== 'pending') {
//       return res.status(400).json({ success: false, error: 'Can only counter a pending offer' });
//     }

//     offer.status      = 'countered';
//     offer.counterOffer = {
//       price:     parseFloat(pricePerKg),
//       message:   message ? sanitizer.sanitizeString(message) : undefined,
//       by:        isFarmer ? 'farmer' : 'buyer',
//       createdAt: new Date(),
//     };
//     offer.negotiationHistory.push({
//       by:        isFarmer ? 'farmer' : 'buyer',
//       action:    'counter',
//       price:     parseFloat(pricePerKg),
//       message:   message,
//       timestamp: new Date(),
//     });
//     await offer.save();

//     logger.info(`✅ Counter offer sent on: ${offerId}`);
//     return res.status(200).json({ success: true, message: 'Counter offer sent', data: offer });
//   } catch (err) {
//     logger.error('counterOffer error:', err);
//     return res.status(500).json({ success: false, error: 'Failed to send counter offer' });
//   }
// };

// // ─── POST /api/v1/offers/:id/cancel ──────────────────────────────────────────
// const cancelOffer = async (req, res) => {
//   try {
//     const { id: offerId } = req.params;
//     const buyerId = req.user.id;

//     const offer = await Offer.findById(offerId);
//     if (!offer) return res.status(404).json({ success: false, error: 'Offer not found' });

//     if (offer.buyer.toString() !== buyerId) {
//       return res.status(403).json({ success: false, error: 'Only the buyer can cancel this offer' });
//     }
//     if (!['pending', 'countered'].includes(offer.status)) {
//       return res.status(400).json({ success: false, error: `Cannot cancel a ${offer.status} offer` });
//     }

//     offer.status = 'cancelled';
//     await offer.save();

//     logger.info(`✅ Offer cancelled: ${offerId}`);
//     return res.status(200).json({ success: true, message: 'Offer cancelled', data: offer });
//   } catch (err) {
//     logger.error('cancelOffer error:', err);
//     return res.status(500).json({ success: false, error: 'Failed to cancel offer' });
//   }
// };

// module.exports = { getOffers, getOfferDetail, makeOffer, acceptOffer, rejectOffer, counterOffer, cancelOffer };

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

const Offer    = require('../models/Offer');
const Crop     = require('../models/Crop');
const User     = require('../models/User');
const Contract = require('../models/Contract');
const { validationResult } = require('express-validator');
const logger   = require('../utils/logger');
const sanitizer = require('../utils/sanitizer');
const NotificationService = require('../services/notificationService');

// ─── GET /api/v1/offers ───────────────────────────────────────────────────────
const getOffers = async (req, res) => {
  try {
    const userId   = req.user.id || req.user._id;
    const userRole = req.user.role;
    const { status, skip = 0, limit = 20 } = req.query;

    let filter = {};
    if (userRole === 'farmer') filter.farmer = userId;
    else if (userRole === 'buyer') filter.buyer = userId;
    if (status) filter.status = status;

    const [offers, total] = await Promise.all([
      Offer.find(filter)
        .populate('crop',   'name category images pricePerKg quantity availableQuantity')
        .populate('farmer', 'name phone email avatar rating')
        .populate('buyer',  'name phone email avatar rating')
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
        skip:  parseInt(skip),
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
    const offer  = await Offer.findById(req.params.id)
      .populate('crop',     'name category images pricePerKg quantity availableQuantity')
      .populate('farmer',   'name phone email avatar rating')
      .populate('buyer',    'name phone email avatar rating')
      .populate('contract');

    if (!offer) return res.status(404).json({ success: false, error: 'Offer not found' });

    const isParty =
      offer.farmer._id.toString() === userId.toString() ||
      offer.buyer._id.toString()  === userId.toString();
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
      crop:             cropId,
      farmer:           crop.farmer._id,
      buyer:            buyerId,
      quantity:         parsedQty,
      pricePerKg:       resolvedPrice,
      totalAmount,
      deliveryLocation: deliveryLocation ? sanitizer.sanitizeString(deliveryLocation) : undefined,
      deliveryDate:     deliveryDate ? new Date(deliveryDate) : undefined,
      paymentTerms:     paymentTerms || 'KrushiMitra Secure Escrow',
      message:          message ? sanitizer.sanitizeString(message) : undefined,
      status:           'pending',
      expiresAt:        new Date(Date.now() + 48 * 60 * 60 * 1000),
      negotiationHistory: [{
        by:        'buyer',
        action:    'offer',
        price:     resolvedPrice,
        message:   message || '',
        timestamp: new Date(),
      }],
    });

    await offer.populate([
      { path: 'crop',   select: 'name images pricePerKg' },
      { path: 'farmer', select: 'name phone email' },
      { path: 'buyer',  select: 'name phone email' },
    ]);

    // Notify farmer
    NotificationService.create({
      recipientId: crop.farmer._id,
      senderId:    buyerId,
      type:        'new_offer',
      title:       '💰 New Offer Received!',
      body:        `${buyer.name} offered ₹${resolvedPrice}/kg for ${parsedQty}kg of ${crop.name}`,
      refModel:    'Offer',
      refId:       offer._id,
      priority:    'high',
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

// ─── POST /api/v1/offers/:id/accept — Farmer accepts ─────────────────────────
/**
 * Flow after farmer accepts:
 *  - Offer status → 'accepted'
 *  - Contract is created with paymentStatus: 'awaiting_buyer'
 *  - Buyer gets notified with payment options (advance / on-delivery)
 *  - Buyer now sees contract in their OffersScreen with a "Pay Now" button
 */
const acceptOffer = async (req, res) => {
  try {
    const { id: offerId } = req.params;
    const farmerId = req.user.id || req.user._id;

    const offer = await Offer.findById(offerId)
      .populate('crop',   'name unit availableQuantity quantity pricePerKg')
      .populate('farmer', 'name phone email')
      .populate('buyer',  'name phone email');

    if (!offer) return res.status(404).json({ success: false, error: 'Offer not found' });

    if (offer.farmer._id.toString() !== farmerId.toString()) {
      return res.status(403).json({ success: false, error: 'Only the crop owner can accept' });
    }
    if (offer.status !== 'pending' && offer.status !== 'countered') {
      return res.status(400).json({ success: false, error: `Offer is already ${offer.status}` });
    }
    if (new Date() > offer.expiresAt) {
      return res.status(400).json({ success: false, error: 'Offer has expired' });
    }

    // Decrement stock atomically
    const updatedCrop = await Crop.findOneAndUpdate(
      { _id: offer.crop._id, $or: [{ availableQuantity: { $gte: offer.quantity } }, { quantity: { $gte: offer.quantity } }] },
      { $inc: { availableQuantity: -offer.quantity, quantity: -offer.quantity } },
      { new: true }
    );
    if (!updatedCrop) {
      return res.status(409).json({ success: false, error: 'Insufficient stock — possibly sold to another buyer' });
    }

    // Mark offer accepted
    offer.status     = 'accepted';
    offer.acceptedAt = new Date();
    offer.negotiationHistory.push({
      by: 'farmer', action: 'accept', price: offer.pricePerKg, timestamp: new Date(),
    });
    await offer.save();

    // Create platform fee & net
    const platformFee = parseFloat((offer.totalAmount * 0.02).toFixed(2));
    const netAmount   = parseFloat((offer.totalAmount - platformFee).toFixed(2));

    // Build contract — paymentStatus is 'awaiting_buyer' so buyer knows to pay
    const contract = await Contract.create({
      offer:   offer._id,
      crop:    offer.crop._id,
      farmer:  offer.farmer._id,
      buyer:   offer.buyer._id,
      terms: {
        cropName:     offer.crop.name,
        quantity:     offer.quantity,
        pricePerKg:   offer.pricePerKg,
        totalAmount:  offer.totalAmount,
        platformFee,
        netAmount,
        farmerName:   offer.farmer.name,
        buyerName:    offer.buyer.name,
        deliveryDate: offer.deliveryDate || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        paymentTerms: offer.paymentTerms || 'KrushiMitra Secure Escrow',
      },
      status:   'active',
      payment:  { status: 'awaiting_buyer' },   // ← buyer must now choose payment type
      delivery: { status: 'pending' },
      dispute:  { isDisputed: false },
    });

    // Link contract back to offer
    offer.contract = contract._id;
    await offer.save();

    // Populate for response
    await contract.populate([
      { path: 'farmer', select: 'name phone email' },
      { path: 'buyer',  select: 'name phone email' },
      { path: 'crop',   select: 'name images' },
    ]);

    // Notify buyer → "Farmer accepted! Choose payment method"
    NotificationService.create({
      recipientId: offer.buyer._id,
      senderId:    farmerId,
      type:        'offer_accepted',
      title:       '✅ Offer Accepted! Pay Now',
      body:        `${offer.farmer.name} accepted your offer for ${offer.crop.name}. Choose a payment method to finalise the contract.`,
      refModel:    'Contract',
      refId:       contract._id,
      priority:    'high',
    }).catch(logger.error);

    // Real-time socket event
    if (global.io) {
      global.io.to(`user:${offer.buyer._id}`).emit('offer_accepted', {
        offerId:    offer._id,
        contractId: contract._id,
        cropName:   offer.crop.name,
        totalAmount:offer.totalAmount,
        message:    'Farmer accepted your offer. Proceed to payment.',
      });
    }

    logger.info(`✅ Offer accepted: ${offerId} → contract: ${contract._id}`);

    return res.status(200).json({
      success: true,
      message: 'Offer accepted. Contract created. Buyer notified to choose payment.',
      data: {
        offer:    { _id: offer._id, status: 'accepted' },
        contract: {
          _id:           contract._id,
          contractId:    contract.contractId,
          cropName:      contract.terms.cropName,
          farmerName:    contract.terms.farmerName,
          buyerName:     contract.terms.buyerName,
          quantity:      contract.terms.quantity,
          pricePerKg:    contract.terms.pricePerKg,
          totalAmount:   contract.terms.totalAmount,
          platformFee:   contract.terms.platformFee,
          netAmount:     contract.terms.netAmount,
          paymentStatus: contract.payment.status,   // 'awaiting_buyer'
          status:        contract.status,
        },
      },
    });
  } catch (err) {
    logger.error('acceptOffer error:', err);
    return res.status(500).json({
      success: false,
      error: process.env.NODE_ENV === 'development' ? err.message : 'Failed to accept offer',
    });
  }
};

// ─── POST /api/v1/offers/:id/reject — Farmer or buyer rejects ─────────────────
const rejectOffer = async (req, res) => {
  try {
    const { id: offerId } = req.params;
    const { reason }      = req.body;
    const userId          = req.user.id || req.user._id;

    const offer = await Offer.findById(offerId);
    if (!offer) return res.status(404).json({ success: false, error: 'Offer not found' });

    const isFarmer = offer.farmer.toString() === userId.toString();
    const isBuyer  = offer.buyer.toString()  === userId.toString();
    if (!isFarmer && !isBuyer) {
      return res.status(403).json({ success: false, error: 'Not authorized to reject this offer' });
    }
    if (!['pending', 'countered', 'accepted'].includes(offer.status)) {
      return res.status(400).json({ success: false, error: `Cannot reject a ${offer.status} offer` });
    }

    offer.status          = 'rejected';
    offer.rejectionReason = reason ? sanitizer.sanitizeString(reason) : undefined;
    offer.rejectedBy      = isFarmer ? 'farmer' : 'buyer';
    offer.negotiationHistory.push({
      by: isFarmer ? 'farmer' : 'buyer', action: 'reject', price: offer.pricePerKg, timestamp: new Date(),
    });
    await offer.save();

    // If buyer rejects an accepted offer, cancel the linked contract
    if (isBuyer && offer.contract) {
      await Contract.findByIdAndUpdate(offer.contract, {
        status: 'cancelled',
        cancelledAt: new Date(),
        cancellationReason: reason || 'Buyer rejected after acceptance',
        cancelledBy: userId,
      });
      // Restore stock
      await Crop.findByIdAndUpdate(offer.crop, { $inc: { availableQuantity: offer.quantity, quantity: offer.quantity } });
    }

    // Notify the other party
    const recipientId = isFarmer ? offer.buyer : offer.farmer;
    NotificationService.create({
      recipientId,
      senderId: userId,
      type:     'offer_rejected',
      title:    '❌ Offer Rejected',
      body:     `Your offer for ${offer.cropName || 'the crop'} was rejected. ${reason ? `Reason: ${reason}` : ''}`,
      refModel: 'Offer',
      refId:    offer._id,
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
    const { id: offerId }         = req.params;
    const { pricePerKg, message } = req.body;
    const userId                  = req.user.id || req.user._id;

    const offer = await Offer.findById(offerId).populate('farmer buyer crop');
    if (!offer) return res.status(404).json({ success: false, error: 'Offer not found' });

    const isFarmer = offer.farmer._id.toString() === userId.toString();
    const isBuyer  = offer.buyer._id.toString()  === userId.toString();
    if (!isFarmer && !isBuyer) {
      return res.status(403).json({ success: false, error: 'Not a party to this offer' });
    }
    if (!['pending', 'countered'].includes(offer.status)) {
      return res.status(400).json({ success: false, error: 'Can only counter a pending offer' });
    }

    const counterPrice = parseFloat(pricePerKg);
    offer.status       = 'countered';
    offer.counterOffer = {
      price:     counterPrice,
      message:   message ? sanitizer.sanitizeString(message) : undefined,
      by:        isFarmer ? 'farmer' : 'buyer',
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
      type:     'offer_countered',
      title:    '🔄 Counter Offer Received',
      body:     `New price proposed: ₹${counterPrice}/kg for ${offer.crop?.name || 'the crop'}`,
      refModel: 'Offer',
      refId:    offer._id,
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
    const buyerId         = req.user.id || req.user._id;

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