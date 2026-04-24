'use strict';
/**
 * transactionService.js
 *
 * Atomic MongoDB multi-document operations using sessions/transactions.
 * Used by offerController.acceptOffer to prevent race conditions.
 */

const mongoose  = require('mongoose');
const { generateContractId } = require('../utils/helpers');
const logger    = require('../utils/logger');

// ─── Retry helper ─────────────────────────────────────────────────────────────
/**
 * Returns true if the error is a transient MongoDB error that should be retried.
 * Checks by error code (reliable) rather than message string (fragile).
 */
const isRetryableError = (err) => {
  // WriteConflict = 112, LockTimeout = 24, NetworkTimeout = various
  const retryCodes = [112, 24, 91, 189, 262, 50]; // MongoDB error codes
  if (err.code && retryCodes.includes(err.code)) return true;
  // Fallback: codeName check
  const retryNames = ['WriteConflict', 'LockTimeout', 'NotPrimaryOrSecondary'];
  if (err.codeName && retryNames.includes(err.codeName)) return true;
  return false;
};

/**
 * Execute an operation inside a MongoDB session with automatic retry on transient errors.
 *
 * @param {(session: ClientSession) => Promise<T>} operation
 * @param {{ retries?: number; timeout?: number }} options
 * @param {number} attempt - internal use only, do not pass from callers
 */
const executeTransaction = async (operation, options = {}, attempt = 0) => {
  const { retries = 3, timeout = 30_000 } = options;
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const result = await Promise.race([
      operation(session),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Transaction timeout')), timeout)
      ),
    ]);

    await session.commitTransaction();
    return result;
  } catch (err) {
    await session.abortTransaction().catch(() => {});

    if (attempt < retries && isRetryableError(err)) {
      const delay = 200 * Math.pow(2, attempt); // exponential back-off: 200, 400, 800ms
      logger.warn(`Transaction retry ${attempt + 1}/${retries} in ${delay}ms: ${err.message}`);
      await new Promise((resolve) => setTimeout(resolve, delay));
      return executeTransaction(operation, options, attempt + 1);
    }

    throw err;
  } finally {
    await session.endSession();
  }
};

// ─── Offer acceptance transaction ─────────────────────────────────────────────
/**
 * Atomically:
 *   1. Marks the offer as accepted
 *   2. Decrements crop.availableQuantity (prevents overselling)
 *   3. Creates a Contract document
 *
 * Called from offerController.acceptOffer().
 */
const transactionOfferAcceptance = (offerId, userId) =>
  executeTransaction(async (session) => {
    const Offer    = mongoose.model('Offer');
    const Crop     = mongoose.model('Crop');
    const Contract = mongoose.model('Contract');

    // 1. Load and validate offer
    const offer = await Offer.findById(offerId)
      .populate('crop')
      .populate('farmer', 'name phone email')
      .populate('buyer',  'name phone email')
      .session(session);

    if (!offer)                        throw new Error('Offer not found');
    if (!['pending', 'countered'].includes(offer.status)) {
        throw new Error(`Offer is already ${offer.status}`);
    }
    if (new Date() > offer.expiresAt)  throw new Error('Offer has expired');

    // ─── Authorization Check ──────────────────────────────────────────────────
    // Determine who is allowed to accept based on current status
    let isAuthorized = false;
    if (offer.status === 'pending') {
        // Pending offers are sent by buyers to farmers
        isAuthorized = offer.farmer._id.toString() === userId.toString();
    } else if (offer.status === 'countered') {
        // For countered, only the party who DID NOT send the counter can accept
        if (offer.counterOffer?.by === 'farmer') {
            isAuthorized = offer.buyer._id.toString() === userId.toString();
        } else {
            isAuthorized = offer.farmer._id.toString() === userId.toString();
        }
    }

    if (!isAuthorized) {
        throw new Error('Not authorized to accept this offer in its current state');
    }

    // ─── Determine Final Pricing ──────────────────────────────────────────────
    const finalPricePerKg = offer.status === 'countered' && offer.counterOffer?.price 
        ? offer.counterOffer.price 
        : offer.pricePerKg;
    const finalTotalAmount = parseFloat((offer.quantity * finalPricePerKg).toFixed(2));

    // 2. Atomically decrement stock — the $gte condition prevents overselling
    const updatedCrop = await Crop.findOneAndUpdate(
      { _id: offer.crop._id, availableQuantity: { $gte: offer.quantity } },
      { $inc: { availableQuantity: -offer.quantity } },
      { session, new: true }
    );

    if (!updatedCrop) {
      throw new Error('Insufficient crop quantity — concurrent purchase detected');
    }

    // 3. Create contract
    const contractId = generateContractId();
    const platformFee = parseFloat((finalTotalAmount * 0.02).toFixed(2));

    const [contract] = await Contract.create(
      [
        {
          contractId,
          offer:   offer._id,
          crop:    offer.crop._id,
          farmer:  offer.farmer._id,
          buyer:   offer.buyer._id,
          terms: {
            cropName:     offer.crop.name,
            quantity:     offer.quantity,
            pricePerKg:   finalPricePerKg,
            totalAmount:  finalTotalAmount,
            platformFee,
            netAmount:    parseFloat((finalTotalAmount - platformFee).toFixed(2)),
            deliveryDate: offer.deliveryDate ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            paymentTerms: offer.paymentTerms ?? 'KrushiMitra Secure Escrow',
            // Flatten farmer/buyer names so frontend Contract interface works
            farmerName:   offer.farmer.name,
            buyerName:    offer.buyer.name,
          },
          status:          'active',
          payment:         { status: 'awaiting_buyer' },
          delivery:        { status: 'pending' },
          dispute:         { isDisputed: false },
          createdAt:       new Date(),
        },
      ],
      { session }
    );

    // 4. Mark offer as accepted and link contract
    await Offer.findByIdAndUpdate(
      offerId,
      { status: 'accepted', acceptedAt: new Date(), contract: contract._id },
      { session }
    );

    logger.info(`✅ Transaction complete: offer ${offerId} → contract ${contract._id}`);
    return contract;
  });

/**
 * Atomically creates/updates a Payment record and updates Contract payment status.
 * Called after Stripe payment is authorized (requires_capture) or succeeded.
 */
const transactionPaymentVerification = (contractId, paymentData) =>
  executeTransaction(async (session) => {
    const Contract = mongoose.model('Contract');
    const Payment  = mongoose.model('Payment');
    const { redis } = require('../config/redis');

    // Distributed Lock Prefix
    const lockKey = `lock:payment:${contractId}`;
    const acquired = await redis.set(lockKey, 'locked', 'PX', 10000, 'NX');

    if (!acquired) {
      logger.warn(`Payment lock contention for contract ${contractId}. Retrying...`);
      throw new Error('WriteConflict'); // Trigger retry logic
    }

    try {
      const contract = await Contract.findById(contractId).session(session);
      if (!contract) throw new Error('Contract not found');

      // If already in escrow/authorized, just return (idempotency)
      const successStatuses = ['in_escrow', 'requires_capture', 'released'];
      if (successStatuses.includes(contract.payment.status)) {
        return { contract, alreadyProcessed: true };
      }

      const { intentId, amount, status, email } = paymentData;

      // 1. Update/Create Payment record
      const payment = await Payment.findOneAndUpdate(
        { 'stripe.paymentIntentId': intentId },
        {
          status: status === 'requires_capture' ? 'in_escrow' : 'paid',
          'stripe.status': status,
          'stripe.amountReceived': amount,
          processedAt: new Date(),
        },
        { session, new: true, upsert: true }
      );

      // 2. Update Contract status
      const updatedContract = await Contract.findByIdAndUpdate(
        contractId,
        {
          status: 'confirmed',
          'payment.status': status === 'requires_capture' ? 'in_escrow' : 'authorized',
          'payment.stripeIntentId': intentId,
          'payment.paidAt': new Date(),
        },
        { session, new: true }
      );

      return { contract: updatedContract, payment };
    } finally {
      await redis.del(lockKey);
    }
  });

/**
 * Atomically releases payment from escrow to the farmer.
 * Marks contract as completed.
 */
const transactionPaymentRelease = (contractId) =>
  executeTransaction(async (session) => {
    const Contract = mongoose.model('Contract');
    const Payment  = mongoose.model('Payment');

    const contract = await Contract.findById(contractId).session(session);
    if (!contract) throw new Error('Contract not found');

    const allowedToRelease = ['in_escrow', 'requires_capture', 'authorized'];
    if (!allowedToRelease.includes(contract.payment.status)) {
      throw new Error(`Cannot release payment. Current status: ${contract.payment.status}`);
    }

    // 1. Update Payment record
    const payment = await Payment.findOneAndUpdate(
      { contract: contractId, status: { $in: ['in_escrow', 'paid', 'captured'] } },
      {
        status: 'released',
        releasedAt: new Date(),
      },
      { session, new: true }
    );

    // 2. Update Contract status
    const updatedContract = await Contract.findByIdAndUpdate(
      contractId,
      {
        status: 'completed',
        'payment.status': 'released',
        'payment.releasedAt': new Date(),
        'delivery.status': 'delivered',
        'delivery.deliveredAt': new Date(),
      },
      { session, new: true }
    );

    return { contract: updatedContract, payment };
  });

/**
 * Atomically confirms Cash on Delivery payment.
 * Creates a Payment record and marks contract as completed.
 */
const transactionCodPayment = (contractId, paymentData) =>
  executeTransaction(async (session) => {
    const Contract = mongoose.model('Contract');
    const Payment  = mongoose.model('Payment');

    const contract = await Contract.findById(contractId).session(session);
    if (!contract) throw new Error('Contract not found');

    // Idempotency: skip if already completed
    if (contract.status === 'completed') {
      return { contract, alreadyProcessed: true };
    }

    // 1. Create Payment record for COD
    const [payment] = await Payment.create(
      [
        {
          contract: contractId,
          payer: contract.buyer,
          payee: contract.farmer,
          amount: contract.terms.totalAmount,
          status: 'released', // COD is directly released to farmer upon collection
          type: 'cod',
          processedAt: new Date(),
          releasedAt: new Date(),
          notes: paymentData.notes || 'Cash on Delivery confirmed',
        },
      ],
      { session }
    );

    // 2. Update Contract status
    const updatedContract = await Contract.findByIdAndUpdate(
      contractId,
      {
        status: 'completed',
        'payment.status': 'released',
        'payment.method': 'cod',
        'payment.paidAt': new Date(),
        'payment.releasedAt': new Date(),
        'delivery.status': 'delivered',
        'delivery.deliveredAt': new Date(),
      },
      { session, new: true }
    );

    return { contract: updatedContract, payment };
  });

module.exports = {
  executeTransaction,
  transactionOfferAcceptance,
  transactionPaymentVerification,
  transactionPaymentRelease,
  transactionCodPayment
};