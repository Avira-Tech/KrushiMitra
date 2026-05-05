const Notification = require('../models/Notification');
const { parsePagination } = require('../utils/helpers');
const { sendSuccess, sendPaginated } = require('../utils/apiResponse');

const getNotifications = async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { type, isRead } = req.query;

  const query = { recipient: req.user._id };
  if (type) query.type = type;
  if (isRead !== undefined) query.isRead = isRead === 'true';

  const [notifications, total, unreadCount] = await Promise.all([
    Notification.find(query)
      .populate('sender', 'name avatar')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Notification.countDocuments(query),
    Notification.countDocuments({ recipient: req.user._id, isRead: false }),
  ]);

  return sendPaginated(res, {
    data: { notifications, unreadCount },
    page, limit, total,
    message: 'Notifications fetched',
  });
};

const markAsRead = async (req, res) => {
  const { id } = req.params;
  await Notification.findOneAndUpdate(
    { _id: id, recipient: req.user._id },
    { isRead: true, readAt: new Date() }
  );
  return sendSuccess(res, { message: 'Notification marked as read' });
};

const markAllAsRead = async (req, res) => {
  await Notification.updateMany(
    { recipient: req.user._id, isRead: false },
    { isRead: true, readAt: new Date() }
  );
  return sendSuccess(res, { message: 'All notifications marked as read' });
};

const deleteNotification = async (req, res) => {
  await Notification.findOneAndDelete({ _id: req.params.id, recipient: req.user._id });
  return sendSuccess(res, { message: 'Notification deleted' });
};

module.exports = { getNotifications, markAsRead, markAllAsRead, deleteNotification };
