'use strict';

const Truck = require('../models/Truck');
const Contract = require('../models/Contract');
const User = require('../models/User');
const { sendSuccess, sendError, sendNotFound } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const NotificationService = require('../services/notificationService');
const { sendOTP } = require('../config/sms');

/**
 * Register a new truck for a logistics partner
 */
exports.registerTruck = async (req, res) => {
  try {
    const { plateNumber, vehicleType, capacityKg, driverName, driverPhone, pricePerKm } = req.body;
    
    const existingTruck = await Truck.findOne({ plateNumber });
    if (existingTruck) {
      return sendError(res, { message: 'Truck with this plate number already registered', statusCode: 400 });
    }

    const truck = await Truck.create({
      owner: req.user._id,
      plateNumber,
      vehicleType,
      capacityKg,
      driverName,
      driverPhone,
      pricePerKm: pricePerKm || 0,
      status: 'available',
      isApproved: true
    });

    return sendSuccess(res, { message: 'Truck registered successfully.', data: truck });
  } catch (err) {
    logger.error('registerTruck error:', err);
    return sendError(res, { message: 'Failed to register truck', statusCode: 500 });
  }
};

/**
 * Get all trucks owned by the logistics partner
 */
exports.getMyTrucks = async (req, res) => {
  try {
    const trucks = await Truck.find({ owner: req.user._id });
    return sendSuccess(res, { data: trucks });
  } catch (err) {
    logger.error('getMyTrucks error:', err);
    return sendError(res, { message: 'Failed to fetch trucks', statusCode: 500 });
  }
};

/**
 * Delete a truck
 */
exports.deleteTruck = async (req, res) => {
  try {
    const truck = await Truck.findOneAndDelete({ _id: req.params.id, owner: req.user._id });
    if (!truck) return sendNotFound(res, 'Truck not found or unauthorized');
    
    return sendSuccess(res, { message: 'Truck deleted successfully' });
  } catch (err) {
    logger.error('deleteTruck error:', err);
    return sendError(res, { message: 'Failed to delete truck', statusCode: 500 });
  }
};

/**
 * Get available jobs for logistics partners
 */
exports.getAvailableJobs = async (req, res) => {
  try {
    // Jobs that are confirmed but don't have an assigned partner yet, OR assigned to this partner but not yet scheduled
    const jobs = await Contract.find({
      status: { $in: ['active', 'confirmed'] },
      'transport.provider': 'local',
      $or: [
          { 'transport.logisticsPartner': { $exists: false } },
          { 'transport.logisticsPartner': null },
          { 'transport.logisticsPartner': req.user._id, 'delivery.status': 'pending' }
      ]
    }).populate('farmer buyer crop');

    return sendSuccess(res, { data: jobs });
  } catch (err) {
    logger.error('getAvailableJobs error:', err);
    return sendError(res, { message: 'Failed to fetch available jobs', statusCode: 500 });
  }
};

/**
 * Accept a delivery job
 */
exports.acceptJob = async (req, res) => {
  try {
    const { contractId, truckId } = req.body;
    
    const truck = await Truck.findOne({ _id: truckId, owner: req.user._id });
    if (!truck) return sendNotFound(res, 'Truck not found or unauthorized');

    const contract = await Contract.findById(contractId);
    if (!contract) return sendNotFound(res, 'Contract not found');
    
    if (contract.transport.logisticsPartner && contract.transport.logisticsPartner.toString() !== req.user._id.toString()) {
      return sendError(res, { message: 'Job already taken by another partner', statusCode: 400 });
    }

    // If already scheduled, no need to re-accept
    if (contract.delivery.status === 'scheduled') {
        return sendError(res, { message: 'Job is already scheduled', statusCode: 400 });
    }

    // Generate OTPs for pickup and delivery
    const pickupOtp = Math.floor(100000 + Math.random() * 900000).toString();
    const deliveryOtp = Math.floor(100000 + Math.random() * 900000).toString();

    contract.transport.logisticsPartner = req.user._id;
    contract.transport.truck = truckId;
    contract.transport.pickupOtp = pickupOtp;
    contract.transport.deliveryOtp = deliveryOtp;
    contract.delivery.status = 'scheduled';
    
    await contract.save();
    
    // Set truck status to busy
    truck.status = 'busy';
    await truck.save();

    // Populate for notifications
    const fullContract = await Contract.findById(contractId).populate('farmer buyer');

    // Notify Farmer of Pickup OTP
    if (fullContract.farmer.phone) {
        await sendOTP(fullContract.farmer.phone, pickupOtp);
    }
    await NotificationService.notifyOtp(fullContract, fullContract.farmer._id, 'pickup', pickupOtp);

    // Notify Buyer of Delivery OTP (optional at this stage, but good for visibility)
    if (fullContract.buyer.phone) {
        await sendOTP(fullContract.buyer.phone, deliveryOtp);
    }
    await NotificationService.notifyOtp(fullContract, fullContract.buyer._id, 'delivery', deliveryOtp);

    return sendSuccess(res, { message: 'Job accepted successfully. OTPs sent to parties.', data: { pickupOtp } });
  } catch (err) {
    logger.error('acceptJob error:', err);
    return sendError(res, { message: 'Failed to accept job', statusCode: 500 });
  }
};

/**
 * Resend OTP to Farmer or Buyer
 */
exports.resendOtp = async (req, res) => {
  try {
    const { contractId, type } = req.body; // type: 'pickup' or 'delivery'
    const contract = await Contract.findById(contractId).populate('farmer buyer');

    if (!contract) return sendNotFound(res, 'Contract not found');
    if (contract.transport.logisticsPartner.toString() !== req.user._id.toString()) {
      return sendError(res, { message: 'Unauthorized', statusCode: 403 });
    }

    const otp = type === 'pickup' ? contract.transport.pickupOtp : contract.transport.deliveryOtp;
    const recipient = type === 'pickup' ? contract.farmer : contract.buyer;

    if (!otp) return sendError(res, { message: 'No OTP generated for this contract yet', statusCode: 400 });

    if (recipient.phone) {
      await sendOTP(recipient.phone, otp);
    }
    await NotificationService.notifyOtp(contract, recipient._id, type, otp);

    return sendSuccess(res, { message: `OTP resent to ${type === 'pickup' ? 'Farmer' : 'Buyer'} successfully.` });
  } catch (err) {
    logger.error('resendOtp error:', err);
    return sendError(res, { message: 'Failed to resend OTP', statusCode: 500 });
  }
};

/**
 * Verify Pickup via OTP (provided by Farmer)
 */
exports.verifyPickup = async (req, res) => {
  try {
    const { contractId, otp } = req.body;
    const contract = await Contract.findById(contractId);
    
    if (!contract) return sendNotFound(res, 'Contract not found');
    if (contract.transport.logisticsPartner.toString() !== req.user._id.toString()) {
      return sendError(res, { message: 'Unauthorized', statusCode: 403 });
    }

    if (contract.transport.pickupOtp !== otp) {
      return sendError(res, { message: 'Invalid OTP', statusCode: 400 });
    }

    contract.delivery.status = 'picked_up';
    contract.delivery.actualPickup = new Date();
    await contract.save();

    return sendSuccess(res, { message: 'Pickup verified successfully' });
  } catch (err) {
    logger.error('verifyPickup error:', err);
    return sendError(res, { message: 'Verification failed', statusCode: 500 });
  }
};

/**
 * Verify Delivery via OTP (provided by Buyer)
 */
exports.verifyDelivery = async (req, res) => {
  try {
    const { contractId, otp } = req.body;
    const contract = await Contract.findById(contractId);
    
    if (!contract) return sendNotFound(res, 'Contract not found');
    if (contract.transport.logisticsPartner.toString() !== req.user._id.toString()) {
      return sendError(res, { message: 'Unauthorized', statusCode: 403 });
    }

    if (contract.transport.deliveryOtp !== otp) {
      return sendError(res, { message: 'Invalid OTP', statusCode: 400 });
    }

    contract.delivery.status = 'delivered';
    contract.delivery.actualDelivery = new Date();
    contract.status = 'completed';
    await contract.save();
    
    // Free the truck
    await Truck.findByIdAndUpdate(contract.transport.truck, { status: 'available' });

    return sendSuccess(res, { message: 'Delivery verified successfully. Job completed.' });
  } catch (err) {
    logger.error('verifyDelivery error:', err);
    return sendError(res, { message: 'Verification failed', statusCode: 500 });
  }
};

/**
 * Suggest trucks for a buyer based on crop quantity
 */
exports.getSuggestedTrucks = async (req, res) => {
  try {
    const { quantityKg } = req.query;
    if (!quantityKg) return sendError(res, { message: 'Quantity is required', statusCode: 400 });

    const trucks = await Truck.find({
      isApproved: true,
      status: 'available',
      capacityKg: { $gte: Number(quantityKg) }
    }).populate('owner', 'name rating');

    return sendSuccess(res, { data: trucks });
  } catch (err) {
    logger.error('getSuggestedTrucks error:', err);
    return sendError(res, { message: 'Failed to fetch suggested trucks', statusCode: 500 });
  }
};
