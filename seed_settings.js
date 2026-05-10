const mongoose = require('mongoose');
require('dotenv').config();
const SystemSetting = require('./src/models/SystemSetting');

const settings = [
  { key: 'platform_commission_rate', value: 2.0, description: 'Percentage fee taken from every successful trade.' },
  { key: 'withdrawal_minimum_limit', value: 100, description: 'Minimum amount a farmer can withdraw.' },
  { key: 'maintenance_mode', value: false, description: 'Restrict platform access for all users during updates.' },
  { key: 'maintenance_message', value: 'KrushiMitra is currently undergoing scheduled maintenance. We will be back shortly.', description: 'Reason for maintenance shown to users.' },
  { key: 'maintenance_until', value: '', description: 'ISO timestamp for when maintenance is expected to end.' },
  { key: 'app_rate', value: 5.0, description: 'Base platform service rate (internal reference).' },
  { key: 'farmer_gst_rate', value: 0.0, description: 'GST rate for farmers (standard is 0 in many cases).' }
];

async function seed() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    for (const s of settings) {
      await SystemSetting.findOneAndUpdate(
        { key: s.key },
        s,
        { upsert: true, new: true }
      );
      console.log(`Synced setting: ${s.key}`);
    }

    console.log('Settings seeded successfully!');
    process.exit(0);
  } catch (err) {
    console.error('Seed error:', err);
    process.exit(1);
  }
}

seed();
