const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../app');
const User = require('../models/User');

// Mock Twilio
jest.mock('../config/sms', () => ({
  sendOTP: jest.fn().mockResolvedValue({ success: true, sid: 'test_sid' }),
  generateVoiceToken: jest.fn().mockReturnValue('test_token'),
}));

describe('Auth API', () => {
  beforeAll(async () => {
    await mongoose.connect(process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/krushimitra_test');
  });

  afterAll(async () => {
    await User.deleteMany({ phone: { $regex: /^\+91999/ } });
    await mongoose.connection.close();
  });

  describe('POST /api/v1/auth/send-otp', () => {
    it('should send OTP for valid phone number', async () => {
      const res = await request(app)
        .post('/api/v1/auth/send-otp')
        .send({ phone: '9999000001', role: 'farmer' });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.phone).toBeDefined();
    });

    it('should reject invalid phone number', async () => {
      const res = await request(app)
        .post('/api/v1/auth/send-otp')
        .send({ phone: '123', role: 'farmer' });

      expect(res.statusCode).toBe(422);
      expect(res.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/auth/verify-otp', () => {
    beforeEach(async () => {
      const { hashString } = require('../utils/helpers');
      await User.findOneAndUpdate(
        { phone: '+919999000001' },
        {
          phone: '+919999000001',
          role: 'farmer',
          'otp.code': hashString('123456'),
          'otp.expiresAt': new Date(Date.now() + 600000),
          'otp.attempts': 1,
        },
        { upsert: true }
      );
    });

    it('should login with valid OTP', async () => {
      const res = await request(app)
        .post('/api/v1/auth/verify-otp')
        .send({ phone: '9999000001', otp: '123456', role: 'farmer' });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.refreshToken).toBeDefined();
    });

    it('should reject invalid OTP', async () => {
      const res = await request(app)
        .post('/api/v1/auth/verify-otp')
        .send({ phone: '9999000001', otp: '000000', role: 'farmer' });

      expect(res.statusCode).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  describe('GET /health', () => {
    it('should return health status', async () => {
      const res = await request(app).get('/health');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain('KrushiMitra');
    });
  });
});
