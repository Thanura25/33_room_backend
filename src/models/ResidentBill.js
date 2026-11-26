const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  bill_id: { type: mongoose.Schema.Types.ObjectId, ref: 'MonthlyBill', required: true },
  resident_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Resident', required: true },
  amount: { type: Number, required: true, min: 0 },
  resident_name: String,
  phone_number: String,
  room_number: String,
  paid_amount: { type: Number, min: 0, default: 0 },
  previous_balance: { type: Number, default: 0 },
  manual_adjustment: { type: Number, default: 0 },
  payment_method: { type: String, default: 'cash' },
  payment_status: { type: String, enum: ['pending', 'partial', 'paid'], default: 'pending' },
  paid_date: { type: Date, default: null },
}, { timestamps: true, versionKey: false });

schema.index({ bill_id: 1, resident_id: 1 }, { unique: true });
module.exports = mongoose.model('ResidentBill', schema);
