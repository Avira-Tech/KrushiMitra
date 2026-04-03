// const mongoose = require('mongoose');
// const { generateContractId } = require('../utils/helpers'); // FIXED PATH
// const logger = require('../utils/logger');

// // FIXED: Proper retry tracking with attempt parameter
// const executeTransaction = async (
//   operation,
//   options = { retries: 3, timeout: 30000 },
//   attempt = 0
// ) => {
//   const session = await mongoose.startSession();
//   session.startTransaction();

//   try {
//     const result = await Promise.race([
//       operation(session),
//       new Promise((_, reject) =>
//         setTimeout(
//           () => reject(new Error('Transaction timeout')),
//           options.timeout
//         )
//       ),
//     ]);

//     await session.commitTransaction();
//     return result;
//   } catch (error) {
//     await session.abortTransaction();

//     // FIXED: Compare attempt < retries instead of resetting retries
//     if (attempt < options.retries && shouldRetry(error)) {
//       logger.warn(
//         `Transaction failed (attempt ${attempt + 1}/${options.retries}), retrying...`,
//         error.message
//       );
//       await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1))); // Exponential backoff
//       return executeTransaction(operation, options, attempt + 1); // FIXED: Pass attempt + 1
//     }

//     throw error;
//   } finally {
//     await session.endSession();
//   }
// };

// const shouldRetry = (error) => {
//   const retryableErrors = [
//     'EALREADY',
//     'ETIMEDOUT',
//     'EHOSTUNREACH',
//     'WriteConflict',
//     'NotMaster',
//   ];
//   return retryableErrors.some((e) => error.message.includes(e));
// };

// // FIXED: Atomic crop quantity check + decrement
// const transactionOfferAcceptance = async (offerId) => {
//   const Offer = mongoose.model('Offer');
//   const Crop = mongoose.model('Crop');
//   const Contract = mongoose.model('Contract');

//   return executeTransaction(async (session) => {
//     // Get offer with validation
//     const offer = await Offer.findById(offerId)
//       .populate('crop')
//       .populate('farmer')
//       .populate('buyer')
//       .session(session);

//     if (!offer) throw new Error('Offer not found');
//     if (offer.status !== 'pending') throw new Error('Offer not in pending status');

//     // FIXED: Atomic conditional update - prevents overselling
//     const updatedCrop = await Crop.findOneAndUpdate(
//       {
//         _id: offer.crop._id,
//         availableQuantity: { $gte: offer.quantity }, // Conditional check
//       },
//       {
//         $inc: { availableQuantity: -offer.quantity },
//       },
//       { session, new: true }
//     );

//     if (!updatedCrop) {
//       throw new Error('Insufficient crop quantity - concurrent purchase detected');
//     }

//     // Generate contract
//     const contractId = generateContractId();
//     const contract = await Contract.create(
//       [
//         {
//           contractId,
//           offer: offer._id,
//           farmer: offer.farmer._id,
//           buyer: offer.buyer._id,
//           crop: offer.crop._id,
//           quantity: offer.quantity,
//           totalAmount: offer.totalAmount,
//           status: 'pending',
//           payment: {
//             status: 'pending',
//             amount: offer.totalAmount,
//           },
//           createdAt: new Date(),
//         },
//       ],
//       { session }
//     );

//     // Update offer status
//     await Offer.findByIdAndUpdate(
//       offerId,
//       { status: 'accepted', acceptedAt: new Date() },
//       { session }
//     );

//     return contract[0];
//   });
// };

// // FIXED: Proper payment field mapping
// const transactionPaymentProcessing = async (contractId, paymentData) => {
//   const Contract = mongoose.model('Contract');
//   const Payment = mongoose.model('Payment');

//   return executeTransaction(async (session) => {
//     const contract = await Contract.findById(contractId).session(session);

//     if (!contract) throw new Error('Contract not found');
//     if (contract.payment.status !== 'pending') {
//       throw new Error('Payment already processed');
//     }

//     // FIXED: Validate payment data structure
//     if (!paymentData.stripe?.paymentIntentId) {
//       throw new Error('Invalid payment intent');
//     }

//     // Create payment record
//     const payment = await Payment.create(
//       [
//         {
//           contract: contractId,
//           payer: contract.buyer,
//           payee: contract.farmer,
//           amount: contract.totalAmount,
//           status: 'authorized',
//           type: 'stripe',
//           stripe: {
//             paymentIntentId: paymentData.stripe.paymentIntentId,
//             chargeId: paymentData.stripe.chargeId || null,
//           },
//           metadata: {
//             contractId,
//           },
//         },
//       ],
//       { session }
//     );

//     // Update contract payment status
//     await Contract.findByIdAndUpdate(
//       contractId,
//       {
//         'payment.status': 'authorized',
//         'payment.transactionId': payment[0]._id,
//       },
//       { session }
//     );

//     return payment[0];
//   });
// };

// module.exports = {
//   executeTransaction,
//   transactionOfferAcceptance,
//   transactionPaymentProcessing,
// };
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
const transactionOfferAcceptance = (offerId) =>
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
    if (offer.status !== 'pending')    throw new Error(`Offer is already ${offer.status}`);
    if (new Date() > offer.expiresAt)  throw new Error('Offer has expired');

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
    const platformFee = parseFloat((offer.totalAmount * 0.02).toFixed(2));

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
            pricePerKg:   offer.pricePerKg,
            totalAmount:  offer.totalAmount,
            platformFee,
            netAmount:    parseFloat((offer.totalAmount - platformFee).toFixed(2)),
            deliveryDate: offer.deliveryDate ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            paymentTerms: offer.paymentTerms ?? 'KrushiMitra Secure Escrow',
            // Flatten farmer/buyer names so frontend Contract interface works
            farmerName:   offer.farmer.name,
            buyerName:    offer.buyer.name,
          },
          status:          'active',
          payment:         { status: 'pending' },
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

// ─── Payment processing transaction ───────────────────────────────────────────
/**
 * Atomically creates a Payment record and updates Contract payment status.
 * Called after Stripe paymentIntent is confirmed server-side via webhook.
 */
const transactionPaymentProcessing = (contractId, paymentData) =>
  executeTransaction(async (session) => {
    const Contract = mongoose.model('Contract');
    const Payment  = mongoose.model('Payment');

    const contract = await Contract.findById(contractId).session(session);
    if (!contract)                            throw new Error('Contract not found');
    if (contract.payment.status !== 'pending') throw new Error('Payment already processed');

    if (!paymentData?.stripe?.paymentIntentId) throw new Error('Invalid payment data: missing paymentIntentId');

    const [payment] = await Payment.create(
      [
        {
          contract:  contractId,
          payer:     contract.buyer,
          payee:     contract.farmer,
          amount:    contract.terms.totalAmount,
          status:    'authorized',
          type:      'escrow_deposit',
          stripe:    {
            paymentIntentId: paymentData.stripe.paymentIntentId,
            chargeId:        paymentData.stripe.chargeId ?? null,
          },
          description: `Escrow — Contract ${contract.contractId}`,
        },
      ],
      { session }
    );

    await Contract.findByIdAndUpdate(
      contractId,
      {
        'payment.status':                'authorized',
        'payment.stripePaymentIntentId': paymentData.stripe.paymentIntentId,
        'payment.paidAt':                new Date(),
      },
      { session }
    );

    logger.info(`✅ Payment transaction: ${payment._id} for contract ${contract.contractId}`);
    return payment;
  });

module.exports = { executeTransaction, transactionOfferAcceptance, transactionPaymentProcessing };