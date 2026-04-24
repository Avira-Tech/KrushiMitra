
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const dbUrl = process.env.MONGODB_URI;

async function simulateGetConversations() {
  await mongoose.connect(dbUrl);
  console.log('Connected to MongoDB');

  const userId = '69cf58a259f7cbb1c783e07c';
  
  const Conversation = mongoose.model('Conversation');
  const conversations = await Conversation.find({ participants: userId })
    .populate('participants', 'name avatar role');
  
  console.log(`API Simulation: Found ${conversations.length} conversations for user ${userId}`);
  conversations.forEach(c => {
    console.log(`- Conv ${c._id}`);
    console.log(`  Participants: ${c.participants.map(p => p.name).join(', ')}`);
  });
  
  process.exit(0);
}

// I need to require the models so they are registered
require('../src/models/User');
require('../src/models/Conversation');
require('../src/models/Message');

simulateGetConversations().catch(err => {
  console.error(err);
  process.exit(1);
});
