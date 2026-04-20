/**
 * migrateFcmTokens.js
 * 
 * Migration script to move existing single 'fcmToken' strings to the new 'fcmTokens' array.
 * 
 * Usage:
 * NODE_PATH=./src node scripts/migrateFcmTokens.js
 */

const mongoose = require('mongoose');
require('dotenv').config();

// Define a minimal User schema for the migration
const UserSchema = new mongoose.Schema({
  fcmToken: String,
  fcmTokens: [String]
}, { strict: false });

const User = mongoose.model('User', UserSchema);

async function runMigration() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected.');

    // 1. Find all users with the old fcmToken field
    const usersToUpdate = await User.find({ 
      $or: [
        { fcmToken: { $exists: true, $ne: null } },
        { fcmTokens: { $exists: false } }
      ]
    });

    console.log(`Found ${usersToUpdate.length} users needing migration.`);

    let migratedCount = 0;

    for (const user of usersToUpdate) {
      const oldToken = user.fcmToken;
      const currentTokens = user.fcmTokens || [];

      const update = { $set: { fcmTokens: currentTokens } };
      
      if (oldToken && !currentTokens.includes(oldToken)) {
        update.$addToSet = { fcmTokens: oldToken };
      }

      // Also ensure fcmTokens is initialized if it's missing
      if (!user.fcmTokens) {
        update.$set.fcmTokens = oldToken ? [oldToken] : [];
      }

      // Remove the old field
      update.$unset = { fcmToken: 1 };

      await User.findByIdAndUpdate(user._id, update);
      migratedCount++;
      
      if (migratedCount % 10 === 0) {
        console.log(`Migrated ${migratedCount} users...`);
      }
    }

    console.log(`Migration complete. Total migrated: ${migratedCount}`);
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

runMigration();
