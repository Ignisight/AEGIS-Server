require('dotenv').config();
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async () => {
    console.log('Connected to DB');
    
    // We only need to import the Teacher schema logic, or define it locally:
    const teacherSchema = new mongoose.Schema({
        allowedDomain: { type: String }
    }, { strict: false });
    
    const Teacher = mongoose.model('Teacher', teacherSchema);
    
    const res = await Teacher.updateMany({}, { $set: { allowedDomain: '' } });
    console.log(`Updated ${res.modifiedCount} teachers. Removed the domain restriction.`);
    
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
