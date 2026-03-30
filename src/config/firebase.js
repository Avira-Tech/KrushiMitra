const admin = require('firebase-admin');
const logger = require('../utils/logger');

let firebaseApp = null;

const initFirebase = () => {
  try {
    if (!process.env.FIREBASE_PROJECT_ID) {
      logger.warn('Firebase credentials not configured. Push notifications disabled.');
      return null;
    }
    firebaseApp = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      }),
    });
    logger.info('✅ Firebase Admin initialized');
    return firebaseApp;
  } catch (error) {
    logger.error('Firebase init error:', error.message);
    return null;
  }
};

const sendPushNotification = async ({ token, title, body, data = {} }) => {
  if (!firebaseApp) return { success: false, reason: 'Firebase not configured' };
  try {
    const message = {
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      token,
      android: { priority: 'high', notification: { sound: 'default', channelId: 'krushimitra' } },
      apns: { payload: { aps: { sound: 'default', badge: 1 } } },
    };
    const response = await admin.messaging().send(message);
    return { success: true, messageId: response };
  } catch (error) {
    logger.error('FCM send error:', error.message);
    return { success: false, error: error.message };
  }
};

const sendMulticastNotification = async ({ tokens, title, body, data = {} }) => {
  if (!firebaseApp || !tokens?.length) return;
  try {
    const message = {
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
      tokens,
    };
    return await admin.messaging().sendEachForMulticast(message);
  } catch (error) {
    logger.error('FCM multicast error:', error.message);
  }
};

module.exports = { initFirebase, sendPushNotification, sendMulticastNotification };
