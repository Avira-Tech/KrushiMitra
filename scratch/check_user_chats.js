
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const dbUrl = process.env.MONGODB_URI;

async function checkUserConversations() {
  await mongoose.connect(dbUrl);
  console.log('Connected to MongoDB');

  const userId = '69cf58a259f7cbb1c783e07c';
  
  const Conversation = mongoose.model('Conversation', new mongoose.Schema({ participants: [mongoose.Schema.Types.ObjectId] }));
  const conversations = await Conversation.find({ participants: userId });
  
  console.log(`Found ${conversations.length} conversations for user ${userId}`);
  for (const conv of conversations) {
    console.log(`Conv ID: ${conv._id}, Participants: ${conv.participants.join(', ')}`);
  }
  
  process.exit(0);
}

checkUserConversations().catch(err => {
  console.error(err);
  process.exit(1);
});
