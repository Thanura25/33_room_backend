const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Resident = require('../models/Resident');
const { fail, phone } = require('../utils/validation');
const { hasEnvironmentAdmin } = require('../services/adminService');

exports.setup = async (_request, response) => response.json({ needsSetup: !hasEnvironmentAdmin() && !(await User.exists({})) });

exports.register = async (request, response) => {
  if (hasEnvironmentAdmin()) fail('The administrator is configured on the server. Sign in with that account.', 403);
  if (await User.exists({ role: 'admin' })) fail('An administrator already exists. Sign in with that account.', 403);
  const { name, email, password } = request.body;
  if (typeof name !== 'string' || !name.trim() || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) fail('A name and valid email are required.');
  if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password) > 72) fail('Use a password with at least 8 characters and at most 72 bytes.');
  const password_hash = await bcrypt.hash(password, 12);
  const user = await User.create({ name: name.trim(), email: email.trim(), password_hash, role: 'admin', bootstrap_key: 'initial-admin' });
  return response.status(201).json({ id: user.id, name: user.name, email: user.email, role: user.role });
};

exports.login = async (request, response) => {
  const { email, password } = request.body;
  if (typeof email !== 'string' || typeof password !== 'string') return response.status(401).json({ message: 'Invalid email or password.' });
  const rawIdentifier = email.trim();
  const lowerEmail = rawIdentifier.toLowerCase();

  // Try finding user by email first
  let user = await User.findOne({ email: lowerEmail }).select('+password_hash');

  // If not found, check if it's a resident phone number
  if (!user) {
    try {
      const normalizedPhone = phone(rawIdentifier);
      const resident = await Resident.findOne({ phone_number: normalizedPhone });
      if (resident && resident.user_id) {
        user = await User.findById(resident.user_id).select('+password_hash');
      }
    } catch {
      // not a phone number, continue
    }
  }

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return response.status(401).json({ message: 'Invalid email or password.' });
  }

  const payload = {
    id: user.id,
    role: user.role,
    name: user.name,
    residentId: user.resident_id ? String(user.resident_id) : undefined,
  };

  const token = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '8h' });
  return response.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      residentId: user.resident_id ? String(user.resident_id) : undefined,
    },
  });
};

exports.me = async (request, response) => {
  const user = await User.findById(request.auth.id);
  if (!user) return response.status(404).json({ message: 'User not found.' });
  return response.json({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    residentId: user.resident_id ? String(user.resident_id) : undefined,
  });
};
