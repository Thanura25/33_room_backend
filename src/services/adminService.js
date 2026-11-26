const bcrypt = require('bcryptjs');
const User = require('../models/User');

function hasEnvironmentAdmin() {
  return ['ADMIN_NAME', 'ADMIN_EMAIL', 'ADMIN_PASSWORD'].some(key => Boolean(process.env[key]));
}

function getAdminConfig() {
  if (!hasEnvironmentAdmin()) return null;
  const name = process.env.ADMIN_NAME?.trim() || '';
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase() || '';
  const password = process.env.ADMIN_PASSWORD || '';
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Set ADMIN_NAME and a valid ADMIN_EMAIL in the backend .env.');
  }
  if (password && (password.length < 8 || Buffer.byteLength(password) > 72)) {
    throw new Error('ADMIN_PASSWORD must contain at least 8 characters and at most 72 bytes.');
  }
  return { name, email, password };
}

async function syncEnvironmentAdmin() {
  const config = getAdminConfig();
  if (!config) return;

  const initialAdmin = await User.findOne({ bootstrap_key: 'initial-admin' }).select('+password_hash');
  const emailOwner = await User.findOne({ email: config.email }).select('+password_hash');
  if (emailOwner && (emailOwner.role !== 'admin' || (initialAdmin && !initialAdmin._id.equals(emailOwner._id)))) {
    throw new Error('ADMIN_EMAIL belongs to another account. Choose an unused email for the administrator.');
  }
  const admin = initialAdmin || emailOwner;
  if (admin && admin.role !== 'admin') throw new Error('The initial administrator record does not have the admin role.');
  if (!admin && !config.password) throw new Error('Set ADMIN_PASSWORD in the backend .env to create the administrator.');

  if (!admin) {
    await User.create({
      name: config.name, email: config.email,
      password_hash: await bcrypt.hash(config.password, 12),
      role: 'admin', bootstrap_key: 'initial-admin',
    });
    return;
  }

  admin.name = config.name;
  admin.email = config.email;
  admin.bootstrap_key = 'initial-admin';
  // A blank password preserves an existing login; a new value rotates its hash.
  if (config.password && !(await bcrypt.compare(config.password, admin.password_hash))) {
    admin.password_hash = await bcrypt.hash(config.password, 12);
  }
  if (admin.isModified()) await admin.save();
}

module.exports = { hasEnvironmentAdmin, getAdminConfig, syncEnvironmentAdmin };
