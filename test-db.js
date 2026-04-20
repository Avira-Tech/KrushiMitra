const mongoose = require('mongoose');
const User = require('./src/models/User');

mongoose.connect('mongodb://127.0.0.1:27017/krushimitra', { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    const user = await User.findOne({ phone: '+917862892576' }).select('+otp');
    console.log("OTP in DB:", user.otp);
    process.exit(0);
  });
