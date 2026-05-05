const User = require('../models/User');
const Crop = require('../models/Crop');
const Contract = require('../models/Contract');
const Payment = require('../models/Payment');
const Offer = require('../models/Offer');
const NotificationService = require('../services/notificationService');
const { parsePagination, escapeRegExp } = require('../utils/helpers');
const { sendSuccess, sendNotFound, sendError, sendPaginated } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const AuditLog = require('../models/AuditLog');

// ─── DASHBOARD ANALYTICS ────────────────────────────────────────────────────────────────────
const getDashboard = async (req, res) => {
  const [userStats, cropStats, contractStats, paymentStats, recentUsers, totalContracts, completedContracts, activeDisputes] = await Promise.all([
    User.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 }, verified: { $sum: { $cond: ['$isVerified', 1, 0] } } } },
    ]),
    Crop.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 }, totalQuantity: { $sum: '$quantity' } } },
    ]),
    Contract.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          totalValue: { $sum: '$terms.totalAmount' },
          transSold: { $sum: { $cond: [{ $ne: ['$transport.provider', 'none'] }, 1, 0] } },
          totalTransValue: { $sum: '$transport.estimatedCost' }
        }
      },
    ]),
    Payment.aggregate([
      { $match: { status: { $in: ['released', 'captured', 'in_escrow'] } } },
      { $group: { _id: null, totalVolume: { $sum: '$amount' }, totalFees: { $sum: '$platformFee' }, count: { $sum: 1 } } },
    ]),
    User.find().sort({ createdAt: -1 }).limit(10).select('name phone role verificationStatus createdAt'),
    Contract.countDocuments(),
    Contract.countDocuments({ status: 'completed' }),
    Contract.countDocuments({ status: 'disputed' }),
  ]);

  const formatStats = (arr, key = '_id') => arr.reduce((acc, item) => ({ ...acc, [item[key]]: item }), {});

  // Performance Metrics
  const disputeRate = totalContracts > 0 ? (activeDisputes / totalContracts) * 100 : 0;
  const safetyRate = totalContracts > 0 ? (completedContracts / totalContracts) * 100 : 100;

  return sendSuccess(res, {
    data: {
      users: formatStats(userStats),
      crops: formatStats(cropStats),
      contracts: formatStats(contractStats),
      payments: paymentStats[0] || { totalVolume: 0, totalFees: 0, count: 0 },
      recentUsers,
      pendingVerifications: await User.countDocuments({ verificationStatus: 'pending' }),
      activeDisputes,
      performance: {
        disputeRate: disputeRate.toFixed(1),
        safetyRate: safetyRate.toFixed(1),
        growth: "12.5" // Placeholder for now, could be calculated from monthly trends
      }
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
  try {
    const { userId } = req.params;
    const { action, note } = req.body; // action: 'approve' | 'reject'

    if (!['approve', 'reject'].includes(action)) {
      return sendError(res, { message: 'Invalid action. Use "approve" or "reject".', statusCode: 400 });
    }

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

    // Notify user
    NotificationService.notifyAccountVerified(userId, isApproved, note).catch(err => {
      logger.error(`Failed to notify user ${userId} of verification status: ${err.message}`);
    });

    // Log admin action
    await logAdminAction(req, 'UserManagement', action, userId, { note });

    logger.info(`User ${userId} ${action}d by admin ${req.user._id}`);

    return sendSuccess(res, {
      message: `User ${isApproved ? 'approved' : 'rejected'} successfully`,
      data: { userId, action, isVerified: isApproved },
    });
  } catch (err) {
    logger.error('verifyUser error:', err);
    return sendError(res, { message: 'Failed to verify user', statusCode: 500 });
  }
};

// ─── GET ALL USERS ──────────────────────────────────────────────────────────────────────────
const getAllUsers = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { role, isVerified, search } = req.query;

  const query = {};
  if (role) query.role = role;
  if (isVerified !== undefined) query.isVerified = isVerified === 'true';
  if (req.query.verificationStatus) query.verificationStatus = req.query.verificationStatus;
  if (search) {
    const escaped = escapeRegExp(search);
    query.$or = [{ name: new RegExp(escaped, 'i') }, { phone: new RegExp(escaped, 'i') }];
  }

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
  }).catch(() => { });

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
  const logs = await AuditLog.find()
    .populate('admin', 'name')
    .sort({ createdAt: -1 })
    .limit(20);

  const formatted = logs.map(log => {
    let color = '#4A148C';
    let text = `${log.admin?.name || 'Admin'} performed ${log.action} in ${log.module}`;

    if (log.module === 'Payments') color = '#38A169';
    if (log.module === 'Users') color = '#2196F3';
    if (log.action === 'ban') color = '#E53E3E';

    return {
      id: log._id,
      text,
      time: log.createdAt,
      color
    };
  });

  return sendSuccess(res, { data: formatted });
};

// ─── GET GEOGRAPHICAL ANALYTICS ──────────────────────────────────────────────────────────────
const getGeoAnalytics = async (req, res) => {
  try {
    const geoStats = await Contract.aggregate([
      { $match: { status: 'completed' } },
      {
        $lookup: {
          from: 'users',
          localField: 'buyer',
          foreignField: '_id',
          as: 'buyerData'
        }
      },
      { $unwind: '$buyerData' },
      {
        $group: {
          _id: { $ifNull: ['$buyerData.location.state', 'Unknown Region'] },
          totalVolume: { $sum: '$terms.totalAmount' },
          orderCount: { $sum: 1 },
          farmers: { $addToSet: '$farmer' },
          buyers: { $addToSet: '$buyer' }
        }
      },
      {
        $project: {
          state: '$_id',
          totalVolume: 1,
          orderCount: 1,
          farmerCount: { $size: '$farmers' },
          buyerCount: { $size: '$buyers' },
          _id: 0
        }
      },
      { $sort: { totalVolume: -1 } },
      { $limit: 15 }
    ]);

    return sendSuccess(res, { data: { geoStats } });
  } catch (err) {
    logger.error('getGeoAnalytics error:', err);
    return sendError(res, { message: 'Failed to fetch geo analytics', statusCode: 500 });
  }
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

// ─── UPDATE CONTRACT TRANSPORT ──────────────────────────────────────────────────────────────
const updateContractTransport = async (req, res) => {
  try {
    const { contractId } = req.params;
    const { transportId } = req.body;

    const [contract, transport] = await Promise.all([
      Contract.findById(contractId),
      require('../models/Transport').findById(transportId)
    ]);

    if (!contract) return sendNotFound(res, 'Contract not found');
    if (!transport) return sendNotFound(res, 'Transport partner not found');

    await Contract.findByIdAndUpdate(contractId, {
      'delivery.deliveryPartner': transport.name,
      'delivery.status': 'scheduled',
      'delivery.deliveryPartnerId': transport._id, // Adding this for reference
    });

    // Notify farmer and buyer
    NotificationService.createBulk([contract.farmer, contract.buyer], {
      type: 'delivery_scheduled',
      title: '🚚 Delivery Scheduled',
      body: `Delivery for contract #${contract.contractId} has been scheduled with ${transport.name}.`,
      refModel: 'Contract',
      refId: contract._id,
    }).catch(() => { });

    await logAdminAction(req, 'ContractManagement', 'SetTransport', contractId, { transport: transport.name });

    return sendSuccess(res, { message: `Transport set to ${transport.name}` });
  } catch (err) {
    logger.error('updateContractTransport error:', err);
    return sendError(res, { message: 'Failed to update transport', statusCode: 500 });
  }
};

const getRevenueAnalytics = async (req, res) => {
  try {
    const now = new Date();
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfDay = new Date(now.setHours(0, 0, 0, 0));

    const [daily, monthly, yearly, userWise] = await Promise.all([
      Payment.aggregate([
        { $match: { status: { $in: ['released', 'captured', 'in_escrow'] }, createdAt: { $gte: startOfDay } } },
        { $group: { _id: null, totalVolume: { $sum: '$amount' }, platformFees: { $sum: '$platformFee' }, gst: { $sum: '$gstAmount' } } }
      ]),
      Payment.aggregate([
        { $match: { status: { $in: ['released', 'captured', 'in_escrow'] }, createdAt: { $gte: startOfMonth } } },
        { $group: { _id: null, totalVolume: { $sum: '$amount' }, platformFees: { $sum: '$platformFee' }, gst: { $sum: '$gstAmount' } } }
      ]),
      Payment.aggregate([
        { $match: { status: { $in: ['released', 'captured', 'in_escrow'] }, createdAt: { $gte: startOfYear } } },
        { $group: { _id: null, totalVolume: { $sum: '$amount' }, platformFees: { $sum: '$platformFee' }, gst: { $sum: '$gstAmount' } } }
      ]),
      Payment.aggregate([
        { $match: { status: { $in: ['released', 'captured', 'in_escrow'] } } },
        {
          $group: {
            _id: '$payer',
            totalPaid: { $sum: '$amount' },
            feesPaid: { $sum: '$platformFee' }
          }
        },
        { $sort: { totalPaid: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'userData'
          }
        },
        { $unwind: '$userData' },
        {
          $project: {
            userName: '$userData.name',
            userPhone: '$userData.phone',
            totalPaid: 1,
            feesPaid: 1
          }
        }
      ])
    ]);

    // Monthly Trend for Chart
    const monthlyTrend = await Payment.aggregate([
      { $match: { status: { $in: ['released', 'captured', 'in_escrow'] }, createdAt: { $gte: new Date(new Date().setFullYear(new Date().getFullYear() - 1)) } } },
      {
        $group: {
          _id: { month: { $month: '$createdAt' }, year: { $year: '$createdAt' } },
          revenue: { $sum: '$platformFee' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    return sendSuccess(res, {
      data: {
        summary: {
          daily: daily[0] || { totalVolume: 0, platformFees: 0, gst: 0 },
          monthly: monthly[0] || { totalVolume: 0, platformFees: 0, gst: 0 },
          yearly: yearly[0] || { totalVolume: 0, platformFees: 0, gst: 0 }
        },
        userWise,
        monthlyTrend
      }
    });
  } catch (err) {
    logger.error('getRevenueAnalytics error:', err);
    return sendError(res, { message: 'Failed to fetch revenue analytics', statusCode: 500 });
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
  logAdminAction,
  updateContractTransport,
  getRevenueAnalytics
};

