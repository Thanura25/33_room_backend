const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

console.log('Testing connection to:', process.env.MONGODB_URI?.replace(/:([^:@]+)@/, ':****@'));

mongoose
  .connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  .then(() => {
    console.log('SUCCESS: Connected to MongoDB Atlas!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('ERROR connecting to MongoDB:');
    console.error(err.message);
    process.exit(1);
  });
