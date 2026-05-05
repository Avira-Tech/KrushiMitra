const twilio = require('twilio');
const logger = require('../utils/logger');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const sendOTP = async (phoneNumber, otp) => {
  try {
    const message = await client.messages.create({
      body: `Your KrushiMitra OTP is: ${otp}. Valid for 10 minutes. Do not share with anyone. - KrushiMitra`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: phoneNumber,
    });
    logger.info(`OTP sent to ${phoneNumber}: ${message.sid}`);
    return { success: true, sid: message.sid };
  } catch (error) {
    logger.error('Twilio sendOTP error:', error);
    // Dev mock: Log OTP without phone for testing
    if (process.env.NODE_ENV === 'development') {
      logger.info(`[DEV] OTP generated: ${otp}`);
      return { success: true, sid: 'dev_mock_sid' };
    }
    throw new Error('Failed to send OTP');
  }
};

const generateVoiceToken = (identity) => {
  const AccessToken = twilio.jwt.AccessToken;
  const VoiceGrant = AccessToken.VoiceGrant;
  const voiceGrant = new VoiceGrant({
    outgoingApplicationSid: process.env.TWILIO_TWIML_APP_SID,
    incomingAllow: true,
  });
  const token = new AccessToken(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_API_KEY || process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_API_SECRET || process.env.TWILIO_AUTH_TOKEN,
    { identity }
  );
  token.addGrant(voiceGrant);
  return token.toJwt();
};

module.exports = { client, sendOTP, generateVoiceToken };
