
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const dbUrl = process.env.MONGODB_URI;

async function checkConvDetails() {
  await mongoose.connect(dbUrl);
  console.log('Connected to MongoDB');

  const convId = '69eb1373a9b8626f711d0e61';
  const Message = mongoose.model('Message', new mongoose.Schema({ conversationId: mongoose.Schema.Types.ObjectId, content: String }));
  
  const messages = await Message.find({ conversationId: convId });
  console.log(`Conversation ${convId} has ${messages.length} messages.`);
  messages.forEach(m => console.log(`- ${m.content}`));
  
  process.exit(0);
}

checkConvDetails().catch(err => {
  console.error(err);
  process.exit(1);
});
