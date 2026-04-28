const User = require('../models/User');
const Crop = require('../models/Crop');
const Contract = require('../models/Contract');
const Payment = require('../models/Payment');
const Offer = require('../models/Offer');
const NotificationService = require('../services/notificationService');
const { parsePagination } = require('../utils/helpers');
const { sendSuccess, sendNotFound, sendError, sendPaginated } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const AuditLog = require('../models/AuditLog');

// ─── DASHBOARD ANALYTICS ────────────────────────────────────────────────────────────────────
const getDashboard = async (req, res) => {
  const [userStats, cropStats, contractStats, paymentStats, recentUsers] = await Promise.all([
    User.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 }, verified: { $sum: { $cond: ['$isVerified', 1, 0] } } } },
    ]),
    Crop.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 }, totalQuantity: { $sum: '$quantity' } } },
    ]),
    Contract.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 }, totalValue: { $sum: '$terms.totalAmount' } } },
    ]),
    Payment.aggregate([
      { $match: { status: { $in: ['released', 'authorized', 'in_escrow'] } } },
      { $group: { _id: null, totalVolume: { $sum: '$amount' }, totalFees: { $sum: '$platformFee' }, count: { $sum: 1 } } },
    ]),
    User.find().sort({ createdAt: -1 }).limit(10).select('name phone role verificationStatus createdAt'),
  ]);

  const formatStats = (arr, key = '_id') => arr.reduce((acc, item) => ({ ...acc, [item[key]]: item }), {});

  return sendSuccess(res, {
    data: {
      users: formatStats(userStats),
      crops: formatStats(cropStats),
      contracts: formatStats(contractStats),
      payments: paymentStats[0] || { totalVolume: 0, totalFees: 0, count: 0 },
      recentUsers,
      pendingVerifications: await User.countDocuments({ verificationStatus: 'pending' }),
      activeDisputes: await Contract.countDocuments({ status: 'disputed' }),
    },
  });
};

// ─── GET PENDING VERIFICATIONS ───────────────────────────────────────────────────────────────
const getPendingVerifications = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { role } = req.query;

  const query = { verificationStatus: { $in: ['pending', 'under_review'] } };
  if (role) query.role = role;

  const [users, total] = await Promise.all([
    User.find(query)
      .select('name phone email role farmerId companyName gstNumber verificationStatus createdAt location')
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit),
    User.countDocuments(query),
  ]);

  return sendPaginated(res, { data: { users }, page, limit, total });
};

// ─── VERIFY USER ────────────────────────────────────────────────────────────────────────────
const verifyUser = async (req, res) => {
  const { userId } = req.params;
  const { action, note } = req.body; // action: 'approve' | 'reject'

  const user = await User.findById(userId);
  if (!user) return sendNotFound(res, 'User not found');

  const isApproved = action === 'approve';

  await User.findByIdAndUpdate(userId, {
    isVerified: isApproved,
    verificationStatus: isApproved ? 'approved' : 'rejected',
    verificationNote: note,
    verifiedAt: isApproved ? new Date() : undefined,
    verifiedBy: req.user._id,
  });

  await NotificationService.notifyAccountVerified(userId, isApproved, note);

  logger.info(`User ${userId} ${action}d by admin ${req.user._id}`);

  return sendSuccess(res, {
    message: `User ${isApproved ? 'approved' : 'rejected'} successfully`,
    data: { userId, action, isVerified: isApproved },
  });
};

// ─── GET ALL USERS ──────────────────────────────────────────────────────────────────────────
const getAllUsers = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { role, isVerified, search } = req.query;

  const query = {};
  if (role) query.role = role;
  if (isVerified !== undefined) query.isVerified = isVerified === 'true';
  if (search) query.$or = [{ name: new RegExp(search, 'i') }, { phone: new RegExp(search, 'i') }];

  const [users, total] = await Promise.all([
    User.find(query).select('-password -otp -refreshToken -governmentId').sort({ createdAt: -1 }).skip(skip).limit(limit),
    User.countDocuments(query),
  ]);

  return sendPaginated(res, { data: { users }, page, limit, total });
};

// ─── BAN/UNBAN USER ─────────────────────────────────────────────────────────────────────────
const banUser = async (req, res) => {
  const { userId } = req.params;
  const { reason, action } = req.body; // action: 'ban' | 'unban'

  const user = await User.findById(userId);
  if (!user) return sendNotFound(res, 'User not found');
  if (user.role === 'admin') return sendError(res, { message: 'Cannot ban admin', statusCode: 400 });

  await User.findByIdAndUpdate(userId, {
    isBanned: action === 'ban',
    banReason: action === 'ban' ? reason : undefined,
  });

  return sendSuccess(res, { message: `User ${action === 'ban' ? 'banned' : 'unbanned'} successfully` });
};

// ─── RESOLVE DISPUTE ───────────────────────────────────────────────────────────────────────
const resolveDispute = async (req, res) => {
  const { contractId } = req.params;
  const { resolution, action, refundAmount } = req.body;

  const contract = await Contract.findById(contractId);
  if (!contract) return sendNotFound(res, 'Contract not found');
  if (!contract.dispute.isDisputed) {
    return sendError(res, { message: 'No dispute found for this contract', statusCode: 400 });
  }

  await Contract.findByIdAndUpdate(contractId, {
    status: action === 'release_payment' ? 'completed' : 'cancelled',
    'dispute.resolution': resolution,
    'dispute.resolvedBy': req.user._id,
    'dispute.resolvedAt': new Date(),
  });

  // Handle payment based on resolution
  if (action === 'release_payment') {
    await Contract.findByIdAndUpdate(contractId, { 'payment.status': 'released', 'payment.releasedAt': new Date() });
    await NotificationService.notifyPaymentReleased(contract, contract.farmer, contract.terms.netAmount);
  } else if (action === 'refund') {
    await Contract.findByIdAndUpdate(contractId, { 'payment.status': 'refunded', 'payment.refundedAt': new Date() });
  }

  // Notify both parties
  NotificationService.createBulk([contract.farmer, contract.buyer], {
    type: 'dispute_resolved',
    title: '✅ Dispute Resolved',
    body: `Dispute on contract #${contract.contractId} has been resolved by admin.`,
    refModel: 'Contract',
    refId: contract._id,
  }).catch(() => {});

  logger.info(`Dispute resolved for contract ${contract.contractId} by admin ${req.user._id}`);

  return sendSuccess(res, { message: 'Dispute resolved successfully', data: { resolution, action } });
};

// ─── SEND BROADCAST NOTIFICATION ──────────────────────────────────────────────────────────────
const sendBroadcast = async (req, res) => {
  const { title, body, role, priority = 'normal' } = req.body;

  const query = { isActive: true };
  if (role) query.role = role;

  const users = await User.find(query).select('_id');
  const result = await NotificationService.createBulk(
    users.map((u) => u._id),
    { type: 'system', title, body, priority }
  );

  return sendSuccess(res, {
    message: `Broadcast sent to ${users.length} users`,
    data: { sent: users.length },
  });
};

// ─── GET SYSTEM ACTIVITY ────────────────────────────────────────────────────────────────────
const getActivity = async (req, res) => {
  const activities = await AuditLog.find()
    .populate('admin', 'name role')
    .sort({ createdAt: -1 })
    .limit(50);
  
  return sendSuccess(res, { data: { activities } });
};

// ─── GET GEOGRAPHICAL ANALYTICS ──────────────────────────────────────────────────────────────
const getGeoAnalytics = async (req, res) => {
  const geoStats = await User.aggregate([
    { $match: { 'location.coordinates': { $exists: true } } },
    {
      $group: {
        _id: '$location.address',
        count: { $sum: 1 },
        farmers: { $sum: { $cond: [{ $eq: ['$role', 'farmer'] }, 1, 0] } },
        buyers: { $sum: { $cond: [{ $eq: ['$role', 'buyer'] }, 1, 0] } },
      }
    },
    { $sort: { count: -1 } },
    { $limit: 20 }
  ]);

  return sendSuccess(res, { data: { geoStats } });
};

// ─── GET DISPUTES ──────────────────────────────────────────────────────────────────────────
const getDisputes = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { status = 'all' } = req.query;

  const query = { 'dispute.isDisputed': true };
  if (status !== 'all') query.status = status;

  const [disputes, total] = await Promise.all([
    Contract.find(query)
      .populate('farmer buyer', 'name phone email')
      .sort({ 'dispute.raisedAt': -1 })
      .skip(skip)
      .limit(limit),
    Contract.countDocuments(query),
  ]);

  return sendPaginated(res, { data: { disputes }, page, limit, total });
};

// ─── GET AUDIT LOGS ────────────────────────────────────────────────────────────────────────
const getAuditLogs = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { module, adminId } = req.query;

  const query = {};
  if (module) query.module = module;
  if (adminId) query.admin = adminId;

  const [logs, total] = await Promise.all([
    AuditLog.find(query)
      .populate('admin', 'name email role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    AuditLog.countDocuments(query),
  ]);

  return sendPaginated(res, { data: { logs }, page, limit, total });
};

// ─── HELPER: LOG ADMIN ACTION ──────────────────────────────────────────────────────────────
const logAdminAction = async (req, module, action, targetId, details) => {
  try {
    await AuditLog.create({
      admin: req.user._id,
      module,
      action,
      targetId,
      details,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
  } catch (err) {
    logger.error(`Failed to log admin action: ${err.message}`);
  }
};

module.exports = {
  getDashboard,
  getPendingVerifications,
  verifyUser,
  getAllUsers,
  banUser,
  resolveDispute,
  sendBroadcast,
  getActivity,
  getGeoAnalytics,
  getDisputes,
  getAuditLogs,
  logAdminAction
};
