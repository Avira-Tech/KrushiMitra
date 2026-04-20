const { MongoClient } = require('mongodb');
const uri = "mongodb://127.0.0.1:27017";
const client = new MongoClient(uri);

async function run() {
  try {
    await client.connect();
    const db = client.db('krushimitra');
    const user = await db.collection('users').findOne({ phone: '+917862892576' });
    console.log("RAW OTP from DB:", user && user.otp);
  } finally {
    await client.close();
  }
}
run().catch(console.dir);
