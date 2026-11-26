const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  month: { type: Number, required: true, min: 1, max: 12 },
  year: { type: Number, required: true, min: 2000 },
  total_amount: { type: Number, required: true, min: 0 },
  electricity: { type: Number, default: 0 },
  water: { type: Number, default: 0 },
  sharedCredit: { type: Number, default: 0 },
  dueDate: { type: Date, default: null },
  notes: { type: String, default: '' },
  readings: { type: mongoose.Schema.Types.Mixed, default: {} },
  // Immutable snapshot allows interrupted saves to recover on standalone MongoDB.
  participants: [{
    _id: false,
    resident_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Resident', required: true },
    name: String,
    phone_number: String,
    room_number: String,
    amount: Number,
  }],
  request_fingerprint: String,
  created_at: { type: Date, default: Date.now },
}, { versionKey: false });

schema.index({ month: 1, year: 1 }, { unique: true });
module.exports = mongoose.model('MonthlyBill', schema);
