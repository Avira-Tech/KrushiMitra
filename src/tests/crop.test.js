const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../../app');
const User = require('../models/User');
const Crop = require('../models/Crop');
const { generateTokenPair } = require('../utils/jwt');

let farmerToken, farmerId, cropId;

describe('Crop API', () => {
  beforeAll(async () => {
    await mongoose.connect(process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/krushimitra_test');

    // Create test farmer
    const farmer = await User.create({
      name: 'Test Farmer',
      phone: '+919999000002',
      role: 'farmer',
      isVerified: true,
      verificationStatus: 'approved',
      location: { type: 'Point', coordinates: [72.5714, 23.0225] },
    });
    farmerId = farmer._id;
    const tokens = generateTokenPair(farmer);
    farmerToken = tokens.accessToken;
  });

  afterAll(async () => {
    await User.deleteMany({ phone: '+919999000002' });
    await Crop.deleteMany({ farmer: farmerId });
    await mongoose.connection.close();
  });

  describe('GET /api/v1/crops', () => {
    it('should return crops list', async () => {
      const res = await request(app).get('/api/v1/crops');
      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data.crops)).toBe(true);
    });

    it('should filter crops by quality', async () => {
      const res = await request(app).get('/api/v1/crops?quality=A');
      expect(res.statusCode).toBe(200);
      expect(res.body.data.crops.every((c) => c.quality === 'A')).toBe(true);
    });
  });

  describe('POST /api/v1/crops', () => {
    it('should create crop for verified farmer', async () => {
      const res = await request(app)
        .post('/api/v1/crops')
        .set('Authorization', `Bearer ${farmerToken}`)
        .send({
          name: 'Test Wheat',
          quantity: 1000,
          pricePerKg: 22,
          quality: 'A',
          harvestDate: '2024-03-15',
          location: { lat: 23.0225, lng: 72.5714, address: 'Ahmedabad' },
          deliveryAvailable: true,
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.crop.name).toBe('Test Wheat');
      cropId = res.body.data.crop._id;
    });

    it('should reject crop creation without auth', async () => {
      const res = await request(app)
        .post('/api/v1/crops')
        .send({ name: 'Test', quantity: 100, pricePerKg: 10, quality: 'A', harvestDate: '2024-03-15' });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/crops/:id', () => {
    it('should return crop by id', async () => {
      if (!cropId) return;
      const res = await request(app).get(`/api/v1/crops/${cropId}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.crop._id).toBe(cropId);
    });

    it('should return 404 for invalid id', async () => {
      const res = await request(app).get('/api/v1/crops/000000000000000000000000');
      expect(res.statusCode).toBe(404);
    });
  });
});
