const mongoose = require('mongoose');
require('dotenv').config({ path: '.env' });

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const Payment = mongoose.model('Payment', new mongoose.Schema({
    contract: mongoose.Schema.Types.ObjectId,
    payee: mongoose.Schema.Types.ObjectId,
    amount: Number,
    status: String,
  }, { strict: false }));
  
  const docs = await Payment.find({});
  console.log('Payments:', docs.length);
  docs.forEach(d => console.log(d.status, d.amount, d.payee));
  
  const Contract = mongoose.model('Contract', new mongoose.Schema({
    farmerName: String,
    totalAmount: Number,
    paymentStatus: String,
  }, { strict: false }));
  
  const c = await Contract.find({});
  console.log('Contracts:', c.length);
  c.forEach(x => console.log(x.farmerName, x.totalAmount, x.paymentStatus));
  process.exit();
}
run();
