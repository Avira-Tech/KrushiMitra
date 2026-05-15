const mongoose = require('mongoose');
const User = require('./src/models/User');
require('dotenv').config();

async function unblock() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to DB');

  const userId = '69fef6c0e43f0fbb009aaf50';
  const result = await User.findByIdAndUpdate(userId, {
    $set: {
      'securityStatus.pinWrongAttempts': 0,
      'securityStatus.blockedUntil': null,
    },
  });

  console.log('Unblocked user:', result ? result.phone : 'Not found');
  await mongoose.disconnect();
}

unblock().catch(console.error);
