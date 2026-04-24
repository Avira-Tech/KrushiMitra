
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const dbUrl = process.env.MONGODB_URI;

async function checkAllUsers() {
  await mongoose.connect(dbUrl);
  console.log('Connected to MongoDB');

  const User = mongoose.model('User', new mongoose.Schema({ name: String, role: String, phone: String }));
  const users = await User.find({});
  
  console.log(`Total Users: ${users.length}`);
  users.forEach(u => {
    console.log(`- User ${u._id}: ${u.name} (${u.role}) ${u.phone}`);
  });
  
  process.exit(0);
}

checkAllUsers().catch(err => {
  console.error(err);
  process.exit(1);
});
