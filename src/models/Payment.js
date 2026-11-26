const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  resident_bill_id: { type: mongoose.Schema.Types.ObjectId, ref: 'ResidentBill', required: false },
  resident_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Resident' },
  month: { type: Number },
  year: { type: Number },
  amount: { type: Number, required: true, min: 0 },
  paid_date: { type: Date, default: Date.now },
  method: { type: String, enum: ['cash', 'bank_transfer', 'online', 'other'], default: 'cash' },
  reference: { type: String, default: '', trim: true },
  notes: { type: String, default: '', trim: true },
  receipt_number: { type: String, sparse: true, unique: true },
  recorded_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, versionKey: false });

schema.index({ resident_id: 1, paid_date: -1 });

module.exports = mongoose.model('Payment', schema);
