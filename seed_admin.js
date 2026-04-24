const mongoose = require('mongoose');
require('dotenv').config();
const connectDB = require('./src/config/database');
const GovtScheme = require('./src/models/GovtScheme');
const SystemSetting = require('./src/models/SystemSetting');

// Register all models to prevent index sync errors in database.js
require('./src/models/User');
require('./src/models/Crop');
require('./src/models/Contract');
require('./src/models/Offer');
require('./src/models/Payment');
require('./src/models/Notification');
require('./src/models/Chat');
require('./src/models/Review');
require('./src/models/HelpArticle');

const HARDCODED_SCHEMES = [
  {
    name: 'PM Kisan Samman Nidhi',
    description: '₹6,000 per year direct income support to farmer families',
    benefit: '₹6,000/year',
    eligibility: 'Small & marginal farmers with landholding up to 2 hectares',
    link: 'https://pmkisan.gov.in',
    icon: '🌾',
    color: '#2E7D32',
  },
  {
    name: 'Soil Health Card',
    description: 'Free soil testing and nutrient recommendations for better yield',
    benefit: 'Free Testing',
    eligibility: 'All farmers',
    link: 'https://soilhealth.dac.gov.in',
    icon: '🌱',
    color: '#795548',
  },
  {
    name: 'Pradhan Mantri Fasal Bima Yojana',
    description: 'Crop insurance scheme to protect farmers from losses',
    benefit: 'Up to ₹2 lakh coverage',
    eligibility: 'All farmers growing notified crops',
    link: 'https://pmfby.gov.in',
    icon: '🛡️',
    color: '#1565C0',
  },
  {
    name: 'Kisan Credit Card',
    description: 'Easy credit for agricultural needs at subsidized interest rates',
    benefit: '4% interest rate',
    eligibility: 'All farmers, sharecroppers, tenant farmers',
    link: 'https://www.nabard.org',
    icon: '💳',
    color: '#6A1B9A',
  },
];

const seed = async () => {
  await connectDB();
  console.log('Seeding initial admin data...');

  // 1. Schemes
  for (const s of HARDCODED_SCHEMES) {
    await GovtScheme.findOneAndUpdate({ name: s.name }, s, { upsert: true });
  }
  console.log('Schemes migrated.');

  // 2. Default Settings
  const defaultSettings = [
    { key: 'platform_commission_rate', value: 0.02, description: 'Default platform commission fee (e.g. 0.02 for 2%)' },
    { key: 'maintenance_mode', value: false, description: 'Disable platform access for maintenance' },
    { key: 'minimum_payout', value: 500, description: 'Minimum balance required for farmer payout (₹)' },
    { key: 'gst_rate', value: 0.18, description: 'Applicable GST on platform fees (e.g. 0.18 for 18%)' }
  ];

  for (const setting of defaultSettings) {
    await SystemSetting.findOneAndUpdate({ key: setting.key }, setting, { upsert: true });
  }
  console.log('Default settings created.');

  console.log('Seeding complete.');
  process.exit();
};

seed();
