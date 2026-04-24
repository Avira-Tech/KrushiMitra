
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const dbUrl = process.env.MONGODB_URI;

async function backfillAllOfferMessages() {
  await mongoose.connect(dbUrl);
  console.log('Connected to MongoDB');

  const offerSchema = new mongoose.Schema({ 
    buyer: mongoose.Schema.Types.ObjectId, 
    farmer: mongoose.Schema.Types.ObjectId, 
    crop: { type: mongoose.Schema.Types.ObjectId, ref: 'Crop' },
    quantity: Number,
    pricePerKg: Number,
    createdAt: Date,
  }, { collection: 'offers' });

  const cropSchema = new mongoose.Schema({ name: String }, { collection: 'crops' });
  const conversationSchema = new mongoose.Schema({ 
    participants: [mongoose.Schema.Types.ObjectId],
    lastMessage: mongoose.Schema.Types.ObjectId,
    lastMessageAt: Date
  }, { timestamps: true, collection: 'conversations' });

  const messageSchema = new mongoose.Schema({
    conversationId: mongoose.Schema.Types.ObjectId,
    sender: mongoose.Schema.Types.ObjectId,
    recipient: mongoose.Schema.Types.ObjectId,
    content: String,
    messageType: String,
    offer: mongoose.Schema.Types.ObjectId,
    createdAt: Date
  }, { collection: 'messages' });

  const Offer = mongoose.models.Offer || mongoose.model('Offer', offerSchema);
  const Crop = mongoose.models.Crop || mongoose.model('Crop', cropSchema);
  const Conversation = mongoose.models.Conversation || mongoose.model('Conversation', conversationSchema);
  const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);

  const offers = await Offer.find({}).populate('crop');
  console.log(`Total Offers to process: ${offers.length}`);

  let messagesCreated = 0;
  for (const offer of offers) {
    if (!offer.buyer || !offer.farmer) continue;

    const participants = [offer.buyer.toString(), offer.farmer.toString()].sort();
    
    // 1. Find or create conversation
    let conv = await Conversation.findOne({ participants: { $size: 2, $all: participants } });
    if (!conv) {
      conv = await Conversation.create({
        participants,
        lastMessageAt: offer.createdAt || new Date()
      });
    }

    // 2. Check if this specific offer already has a message in this conversation
    const existingMsg = await Message.findOne({ conversationId: conv._id, offer: offer._id });
    
    if (!existingMsg) {
      console.log(`Creating message for offer ${offer._id} in conv ${conv._id}`);
      const cropName = offer.crop?.name || 'Crop';
      const msg = await Message.create({
        conversationId: conv._id,
        sender: offer.buyer,
        recipient: offer.farmer,
        content: `Offer for ${cropName}: ₹${offer.pricePerKg}/kg for ${offer.quantity}kg`,
        messageType: 'offer',
        offer: offer._id,
        createdAt: offer.createdAt || new Date()
      });

      // Update conversation last message if this offer is the newest
      if (!conv.lastMessageAt || (offer.createdAt && offer.createdAt > conv.lastMessageAt)) {
        conv.lastMessage = msg._id;
        conv.lastMessageAt = offer.createdAt;
        await conv.save();
      }
      messagesCreated++;
    }
  }

  console.log(`Successfully created ${messagesCreated} missing offer messages.`);
  process.exit(0);
}

backfillAllOfferMessages().catch(err => {
  console.error(err);
  process.exit(1);
});
