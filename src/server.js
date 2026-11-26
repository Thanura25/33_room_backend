const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });

const app = require('./app');
const { connectDatabase } = require('./config/db');
const { getAdminConfig, syncEnvironmentAdmin } = require('./services/adminService');
const { startKeepAlive } = require('./services/keepAliveService');

async function start() {
  if (!process.env.MONGODB_URI || !process.env.JWT_SECRET) {
    throw new Error('MONGODB_URI and JWT_SECRET must be set in .env.');
  }
  getAdminConfig();
  await connectDatabase(process.env.MONGODB_URI);
  await Promise.all(Object.values(require('mongoose').models).map(model => model.init()));
  await syncEnvironmentAdmin();
  const port = Number(process.env.PORT || 4000);
  app.listen(port, () => {
    console.log(`33 Room API running on port ${port}`);
    startKeepAlive();
  });
}

start().catch((error) => {
  console.error('Failed to start the API:', error.message);
  process.exit(1);
});
