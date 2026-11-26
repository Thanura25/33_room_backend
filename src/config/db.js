const mongoose = require('mongoose');

let connectionPromise = null;

/**
 * Connect to MongoDB, reusing any active or in-flight Mongoose connection
 * across serverless invocations.
 */
async function connectDatabase(uri) {
  if (!uri) {
    throw new Error('MONGODB_URI is not configured in environment variables.');
  }

  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (!connectionPromise) {
    connectionPromise = mongoose
      .connect(uri, {
        serverSelectionTimeoutMS: 8000,
      })
      .then((connection) => {
        console.log('MongoDB connected.');
        return connection;
      })
      .finally(() => {
        connectionPromise = null;
      });
  }

  return connectionPromise;
}

module.exports = { connectDatabase };
