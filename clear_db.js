const mongoose = require('mongoose');

const MONGO_URI = 'mongodb+srv://admin:L0W5zNn0E1v7LPRD@cluster0.p1a5o.mongodb.net/test?retryWrites=true&w=majority';

async function wipeData() {
  console.log('Connecting to Atlas...');
  await mongoose.connect(MONGO_URI);
  console.log('Connected.');
  
  const db = mongoose.connection.db;
  console.log('Deleting collections...');
  
  // Try to drop or clear
  await db.collection('attendances').deleteMany({});
  await db.collection('sessions').deleteMany({});
  await db.collection('devices').deleteMany({});
  await db.collection('otps').deleteMany({});
  
  console.log('Wipe complete.');
  process.exit(0);
}

wipeData().catch(e => {
  console.error(e);
  process.exit(1);
});
