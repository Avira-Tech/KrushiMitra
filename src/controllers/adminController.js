const User = require('../models/User');
const Crop = require('../models/Crop');
const Contract = require('../models/Contract');
const Payment = require('../models/Payment');
const Offer = require('../models/Offer');
const AuditLog = require('../models/AuditLog');
const NotificationService = require('../services/notificationService');

// Helper to log admin actions
const logAdminAction = async (req, module, action, targetId = null, details = {}) => {
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
    logger.error('Failed to log admin action:', err);
  }
};
const { parsePagination } = require('../utils/helpers');
const { sendSuccess, sendNotFound, sendError, sendPaginated } = require('../utils/apiResponse');
const logger = require('../utils/logger');

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

  await logAdminAction(req, 'Users', isApproved ? 'APPROVE_USER' : 'REJECT_USER', userId, { role: user.role, note });
  logger.info(`User ${userId} ${action}d by admin ${req.user._id}`);

  return sendSuccess(res, {
    message: `User ${isApproved ? 'approved' : 'rejected'} successfully`,
    data: { userId, action, isVerified: isApproved },
  });
};

// ─── GET ALL USERS ──────────────────────────────────────────────────────────────────────────
const getAllUsers = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { role, isVerified, search, verificationStatus } = req.query;

  const query = {};
  if (role) query.role = role;
  if (verificationStatus) query.verificationStatus = verificationStatus;
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
    bannedAt: action === 'ban' ? new Date() : undefined,
    bannedBy: action === 'ban' ? req.user._id : undefined,
  });

  await logAdminAction(req, 'Users', action === 'ban' ? 'BAN_USER' : 'UNBAN_USER', userId, { reason });
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

  await logAdminAction(req, 'Contracts', 'RESOLVE_DISPUTE', contractId, { action, resolution });
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

// ─── GET RECENT ACTIVITY ──────────────────────────────────────────────────────────────────
const getActivity = async (req, res) => {
  const [users, crops, contracts, payments, logs] = await Promise.all([
    User.find().sort({ createdAt: -1 }).limit(5).select('name role createdAt'),
    Crop.find().sort({ createdAt: -1 }).limit(5).select('name farmer quantity createdAt'),
    Contract.find().sort({ createdAt: -1 }).limit(5).select('contractId terms.cropName status createdAt'),
    Payment.find().sort({ createdAt: -1 }).limit(5).select('amount status createdAt'),
    AuditLog.find().sort({ createdAt: -1 }).limit(10).populate('admin', 'name'),
  ]);

  const activity = [
    ...users.map((u) => ({ type: 'user', icon: 'person-add', text: `New ${u.role}: ${u.name}`, time: u.createdAt, color: '#4CAF50' })),
    ...crops.map((c) => ({ type: 'crop', icon: 'leaf', text: `Listing: ${c.name} (${c.quantity}kg)`, time: c.createdAt, color: '#2196F3' })),
    ...contracts.map((c) => ({ type: 'contract', icon: 'document-text', text: `Contract ${c.status}: #${c.contractId}`, time: c.createdAt, color: '#FF9800' })),
    ...payments.map((p) => ({ type: 'payment', icon: 'cash', text: `Payment ${p.status}: ₹${p.amount}`, time: p.createdAt, color: '#FFD54F' })),
    ...logs.map((l) => ({ type: 'admin', icon: 'flash', text: `Admin ${l.admin?.name || 'Admin'} ${l.action.replace(/_/g, ' ')}`, time: l.createdAt, color: '#7B1FA2' })),
  ].sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 15);

  return sendSuccess(res, { data: activity });
};

// ─── GET ALL DISPUTES ─────────────────────────────────────────────────────────────────────
const getDisputes = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const query = { status: 'disputed' };

  const [disputes, total] = await Promise.all([
    Contract.find(query)
      .populate('farmer', 'name phone')
      .populate('buyer', 'name phone')
      .sort({ 'dispute.raisedAt': -1 })
      .skip(skip)
      .limit(limit),
    Contract.countDocuments(query),
  ]);

  return sendPaginated(res, { data: { disputes }, page, limit, total });
};

// ─── GET GEOGRAPHICAL ANALYTICS ──────────────────────────────────────────────────────────
const getGeoAnalytics = async (req, res) => {
  const analytics = await Contract.aggregate([
    { $match: { status: 'completed' } },
    {
      $lookup: {
        from: 'users',
        localField: 'farmer',
        foreignField: '_id',
        as: 'farmerDetails'
      }
    },
    { $unwind: '$farmerDetails' },
    {
      $group: {
        _id: '$farmerDetails.location.state',
        totalVolume: { $sum: '$terms.totalAmount' },
        orderCount: { $sum: 1 },
      }
    },
    { $sort: { totalVolume: -1 } },
    {
      $project: {
        state: '$_id',
        totalVolume: 1,
        orderCount: 1,
        _id: 0
      }
    }
  ]);

  return sendSuccess(res, { data: analytics });
};

const getAuditLogs = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const [logs, total] = await Promise.all([
    AuditLog.find()
      .populate('admin', 'name role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    AuditLog.countDocuments()
  ]);
  sendPaginated(res, { data: logs, page, limit, total });
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
  getDisputes,
  getGeoAnalytics,
  getAuditLogs,
  logAdminAction
};
