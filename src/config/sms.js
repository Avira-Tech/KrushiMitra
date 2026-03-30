const AWS = require('aws-sdk');
const twilio = require('twilio');
const logger = require('../utils/logger');

// Determine SMS provider: aws_sns (temp), twilio (default/prod), or dev mock
const SMS_PROVIDER = process.env.SMS_PROVIDER || 'twilio';

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// AWS SNS Setup
const sns = new AWS.SNS({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1',
});

const sendOTP = async (phoneNumber, otp) => {
  const message = `Your KrushiMitra OTP is: ${otp}. Valid for 10 minutes. Do not share with anyone. - KrushiMitra`;

  try {
    if (SMS_PROVIDER === 'aws_sns') {
      // 1. Set SMS Attributes first to ensure high delivery (Transactional)
      await sns.setSMSAttributes({
        attributes: {
        //   'DefaultSMSType': 'Transactional',
          'DefaultSenderID': 'KMITRA' // Max 6 chars, alphanumeric
        }
      }).promise();

      // 2. Publish message
      const params = {
        Message: message,
        PhoneNumber: phoneNumber, // Ensure this is +91XXXXXXXXXX
        MessageAttributes: {
        //   'AWS.SNS.SMS.SenderID': { DataType: 'String', StringValue: 'KMITRA' },
          'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' }
        }
      };
      
      const data = await sns.publish(params).promise();
      logger.info(`AWS SNS OTP sent to ${phoneNumber}: ${data.MessageId}`);
      return { success: true, sid: data.MessageId };
    } else {
      // Twilio
      const twilioMessage = await twilioClient.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phoneNumber,
      });
      logger.info(`Twilio OTP sent to ${phoneNumber}: ${twilioMessage.sid}`);
      return { success: true, sid: twilioMessage.sid };
    }
  } catch (error) {
    logger.error(`${SMS_PROVIDER.toUpperCase()} sendOTP error:`, error);
    
    // Dev mock fallback
    if (process.env.NODE_ENV === 'development') {
      logger.info(`[DEV MOCK] OTP generated: ${otp} for ${phoneNumber}`);
      return { success: true, sid: 'dev_mock_sid' };
    }
    
    throw new Error(`Failed to send OTP via ${SMS_PROVIDER}`);
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

module.exports = { sendOTP, generateVoiceToken };

