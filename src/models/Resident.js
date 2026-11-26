const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  phone_number: { type: String, required: true, trim: true, unique: true },
  room_number: { type: String, trim: true, default: '' },
  email: { type: String, trim: true, lowercase: true, default: '' },
  birthday: { type: Date, default: null },
  joined_date: { type: Date, required: true, default: Date.now },
  left_date: { type: Date, default: null },
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, versionKey: false });

module.exports = mongoose.model('Resident', schema);
