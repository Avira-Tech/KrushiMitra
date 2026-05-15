const admin = require('firebase-admin');
const logger = require('../utils/logger');

let firebaseApp = null;

const initFirebase = () => {
  try {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

    if (!projectId || !privateKey || !clientEmail) {
      logger.warn('Firebase credentials incomplete. Push notifications disabled.');
      return null;
    }

    // Ensure the private key is properly formatted for PEM
    if (privateKey.includes('\\n')) {
      privateKey = privateKey.replace(/\\n/g, '\n');
    }

    // Add PEM headers if missing (common mistake in .env)
    if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
      privateKey = `-----BEGIN PRIVATE KEY-----\n${privateKey}\n-----END PRIVATE KEY-----`;
    }

    // Basic sanity check: RSA private keys are typically > 1000 chars
    if (privateKey.length < 500) {
      logger.warn('Firebase Private Key seems invalid (too short). Push notifications disabled.');
      return null;
    }

    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        privateKey,
        clientEmail,
      }),
    });
    logger.info('✅ Firebase Admin initialized');
    return firebaseApp;
  } catch (error) {
    const isAsn1Error = error.message.includes('ASN.1');
    const msg = isAsn1Error
      ? 'Invalid RSA Key format. Please ensure FIREBASE_PRIVATE_KEY is a full PEM string from your Service Account JSON.'
      : error.message;
    logger.error(`Firebase init error: ${msg}`);
    return null;
  }
};

const sendPushNotification = async ({ token, title, body, data = {}, badge = 0 }) => {
  if (!firebaseApp) return { success: false, reason: 'Firebase not configured' };
  try {
    const message = {
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      token,
      android: {
        priority: 'high',
        notification: { sound: 'default', channelId: 'krushimitra', notificationCount: badge },
      },
      apns: { payload: { aps: { sound: 'default', badge } } },
    };
    const response = await admin.messaging().send(message);
    return { success: true, messageId: response };
  } catch (error) {
    logger.error('FCM send error:', error.message);
    return { success: false, error: error.message };
  }
};

const sendMulticastNotification = async ({ tokens, title, body, data = {}, badge = 0 }) => {
  if (!firebaseApp || !tokens?.length) return;
  try {
    const message = {
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      tokens,
      android: {
        notification: { sound: 'default', channelId: 'krushimitra', notificationCount: badge },
      },
      apns: { payload: { aps: { sound: 'default', badge } } },
    };
    return await admin.messaging().sendEachForMulticast(message);
  } catch (error) {
    logger.error('FCM multicast error:', error.message);
  }
};

module.exports = { initFirebase, sendPushNotification, sendMulticastNotification };
