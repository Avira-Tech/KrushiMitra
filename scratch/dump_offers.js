
const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const dbUrl = process.env.MONGODB_URI;

async function dumpOffers() {
  await mongoose.connect(dbUrl);
  console.log('Connected to MongoDB');

  const Offer = mongoose.model('Offer', new mongoose.Schema({ buyer: mongoose.Schema.Types.ObjectId, farmer: mongoose.Schema.Types.ObjectId }));
  const offers = await Offer.find({});
  
  offers.forEach(o => {
    console.log(`Offer ${o._id}: Buyer ${o.buyer}, Farmer ${o.farmer}`);
  });
  
  process.exit(0);
}

dumpOffers().catch(err => {
  console.error(err);
  process.exit(1);
});
