const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, trim: true, lowercase: true, unique: true },
  password_hash: { type: String, required: true, select: false },
  role: { type: String, enum: ['admin', 'staff', 'member'], default: 'admin' },
  resident_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Resident' },
  bootstrap_key: { type: String, unique: true, sparse: true },
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('User', schema);
