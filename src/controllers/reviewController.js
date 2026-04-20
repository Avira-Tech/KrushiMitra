const Review = require('../models/Review');
const User = require('../models/User');
const Contract = require('../models/Contract');
const { parsePagination } = require('../utils/helpers');
const { sendSuccess, sendCreated, sendError, sendNotFound, sendPaginated } = require('../utils/apiResponse');

const createReview = async (req, res) => {
  const { contractId, revieweeId, rating, categories, comment } = req.body;

  const contract = await Contract.findById(contractId);
  if (!contract) return sendNotFound(res, 'Contract not found');
  if (contract.status !== 'completed') {
    return sendError(res, { message: 'Can only review completed contracts', statusCode: 400 });
  }

  const isParty =
    contract.farmer.toString() === req.user._id.toString() ||
    contract.buyer.toString() === req.user._id.toString();
  if (!isParty) return sendError(res, { message: 'Not authorized', statusCode: 403 });

  const review = await Review.create({
    reviewer: req.user._id,
    reviewee: revieweeId,
    contract: contractId,
    rating,
    categories,
    comment,
  });

  // Update reviewee's rating atomically using $inc
  await User.findByIdAndUpdate(revieweeId, {
    $inc: { 
      'rating.total': rating, 
      'rating.count': 1 
    }
  });

  // Re-calculate average in a separate step or on read
  // For production performance, it's better to update it now or periodically
  const updatedUser = await User.findById(revieweeId).select('rating');
  if (updatedUser && updatedUser.rating.count > 0) {
    const newAverage = parseFloat((updatedUser.rating.total / updatedUser.rating.count).toFixed(2));
    await User.findByIdAndUpdate(revieweeId, { 'rating.average': newAverage });
  }

  return sendCreated(res, { message: 'Review submitted', data: { review } });
};

const getUserReviews = async (req, res) => {
  const { userId } = req.params;
  const { page, limit, skip } = parsePagination(req.query);

  const [reviews, total] = await Promise.all([
    Review.find({ reviewee: userId, isVisible: true })
      .populate('reviewer', 'name avatar role')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Review.countDocuments({ reviewee: userId, isVisible: true }),
  ]);

  const stats = await Review.aggregate([
    { $match: { reviewee: require('mongoose').Types.ObjectId(userId), isVisible: true } },
    { $group: { _id: null, avgRating: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);

  return sendPaginated(res, {
    data: { reviews, stats: stats[0] || { avgRating: 0, count: 0 } },
    page, limit, total,
  });
};

module.exports = { createReview, getUserReviews };
