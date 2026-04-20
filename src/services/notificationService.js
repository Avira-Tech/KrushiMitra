const Notification = require('../models/Notification');
const { sendPushNotification, sendMulticastNotification } = require('../config/firebase');
const socketService = require('../utils/socketService');
const logger = require('../utils/logger');

class NotificationService {
  /**
   * Create and optionally push a notification
   */
  static async create({ recipientId, senderId = null, type, title, body, data = {}, refModel, refId, priority = 'normal' }) {
    try {
      const notification = await Notification.create({
        recipient: recipientId,
        sender: senderId,
        type,
        title,
        body,
        data,
        refModel,
        refId,
        priority,
      });

      // Emit via socket if available
      socketService.emitToUser(recipientId, 'notification', {
        id: notification._id,
        type,
        title,
        body,
        data,
        createdAt: notification.createdAt,
      });

      // Send push notification
      const User = require('../models/User');
      const recipient = await User.findById(recipientId).select('+fcmTokens');
      if (recipient?.fcmTokens?.length) {
        // Send to all registered devices
        const pushResult = await sendMulticastNotification({
          tokens: recipient.fcmTokens,
          title,
          body,
          data: { ...data, notificationId: notification._id.toString(), type },
        });

        const successCount = pushResult?.successCount || 0;
        await Notification.findByIdAndUpdate(notification._id, {
          isPushSent: successCount > 0,
          pushSentAt: new Date(),
          metadata: { ...notification.metadata, fcmResponses: pushResult?.responses }
        });
      }

      return notification;
    } catch (error) {
      logger.error('NotificationService.create error:', error);
    }
  }

  /**
   * Notify multiple users
   */
  static async createBulk(recipientIds, notificationData) {
    const promises = recipientIds.map((id) =>
      this.create({ ...notificationData, recipientId: id })
    );
    return Promise.allSettled(promises);
  }

  // ─── Predefined notification helpers ───────────────────────────────────────

  static async notifyNewOffer(offer, crop, farmer, buyer) {
    return this.create({
      recipientId: farmer._id,
      senderId: buyer._id,
      type: 'new_offer',
      title: '💰 New Offer Received!',
      body: `${buyer.name} offered ₹${offer.offeredPrice}/kg for ${offer.quantity}kg of ${crop.name}`,
      data: { offerId: offer._id, cropId: crop._id },
      refModel: 'Offer',
      refId: offer._id,
      priority: 'high',
    });
  }

  static async notifyOfferAccepted(offer, crop, farmer, buyer) {
    return this.create({
      recipientId: buyer._id,
      senderId: farmer._id,
      type: 'offer_accepted',
      title: '✅ Offer Accepted!',
      body: `${farmer.name} accepted your offer for ${crop.name}. Contract has been generated.`,
      data: { offerId: offer._id, cropId: crop._id },
      refModel: 'Offer',
      refId: offer._id,
      priority: 'high',
    });
  }

  static async notifyOfferRejected(offer, crop, farmer, buyer) {
    return this.create({
      recipientId: buyer._id,
      senderId: farmer._id,
      type: 'offer_rejected',
      title: '❌ Offer Rejected',
      body: `${farmer.name} rejected your offer for ${crop.name}. Try a different price.`,
      data: { offerId: offer._id },
      refModel: 'Offer',
      refId: offer._id,
    });
  }

  static async notifyCounterOffer(offer, crop, initiatorName, recipientId) {
    return this.create({
      recipientId,
      type: 'offer_countered',
      title: '🔄 Counter Offer Received',
      body: `${initiatorName} sent a counter offer of ₹${offer.counterOffer.price}/kg for ${crop.name}`,
      data: { offerId: offer._id },
      refModel: 'Offer',
      refId: offer._id,
      priority: 'high',
    });
  }

  static async notifyContractCreated(contract, farmerId, buyerId) {
    const msgs = [
      this.create({
        recipientId: farmerId,
        type: 'contract_created',
        title: '📄 Contract Generated',
        body: `Contract #${contract.contractId} created for ${contract.terms.cropName}. Awaiting payment.`,
        data: { contractId: contract._id },
        refModel: 'Contract',
        refId: contract._id,
        priority: 'high',
      }),
      this.create({
        recipientId: buyerId,
        type: 'contract_created',
        title: '📄 Contract Generated',
        body: `Contract #${contract.contractId} ready. Please make payment of ₹${contract.terms.totalAmount.toLocaleString('en-IN')}`,
        data: { contractId: contract._id },
        refModel: 'Contract',
        refId: contract._id,
        priority: 'high',
      }),
    ];
    return Promise.all(msgs);
  }

  static async notifyPaymentReceived(contract, farmerId, amount) {
    return this.create({
      recipientId: farmerId,
      type: 'payment_received',
      title: '💳 Payment in Escrow',
      body: `₹${amount.toLocaleString('en-IN')} received in escrow for contract #${contract.contractId}`,
      data: { contractId: contract._id },
      refModel: 'Contract',
      refId: contract._id,
      priority: 'high',
    });
  }

  static async notifyPaymentReleased(contract, farmerId, amount) {
    return this.create({
      recipientId: farmerId,
      type: 'payment_released',
      title: '✅ Payment Released!',
      body: `₹${amount.toLocaleString('en-IN')} has been released to your account for contract #${contract.contractId}`,
      data: { contractId: contract._id },
      refModel: 'Contract',
      refId: contract._id,
      priority: 'urgent',
    });
  }

  static async notifyDeliveryUpdate(contract, recipientId, status, message) {
    const statusEmoji = { scheduled: '📦', picked_up: '🚚', in_transit: '🚛', delivered: '✅', failed: '❌' };
    return this.create({
      recipientId,
      type: 'delivery_update',
      title: `${statusEmoji[status] || '📦'} Delivery Update`,
      body: message || `Delivery status updated to: ${status}`,
      data: { contractId: contract._id, deliveryStatus: status },
      refModel: 'Contract',
      refId: contract._id,
    });
  }

  static async notifyAccountVerified(userId, approved, note) {
    return this.create({
      recipientId: userId,
      type: approved ? 'account_verified' : 'account_rejected',
      title: approved ? '✅ Account Verified!' : '❌ Verification Failed',
      body: approved
        ? 'Your KrushiMitra account has been verified. You can now list crops and make offers.'
        : `Account verification rejected. ${note || 'Please contact support for details.'}`,
      priority: 'high',
    });
  }

  static async notifyNewCropToNearbyBuyers(crop, farmerName, nearbyBuyerIds) {
    if (!nearbyBuyerIds?.length) return;
    return this.createBulk(nearbyBuyerIds, {
      type: 'crop_listed',
      title: '🌾 New Crop Available Nearby!',
      body: `${farmerName} listed ${crop.name} at ₹${crop.pricePerKg}/kg near you`,
      data: { cropId: crop._id },
      refModel: 'Crop',
      refId: crop._id,
    });
  }
}

module.exports = NotificationService;
