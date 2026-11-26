const mongoose = require('mongoose');
const { CATEGORY_CODES } = require('./BillCategory');

const schema = new mongoose.Schema({
  distribution_id: { type: mongoose.Schema.Types.ObjectId, ref: 'BillDistribution' },
  bill_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CategoryBill', required: true },
  resident_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Resident', required: true },
  month: { type: Number, required: true, min: 1, max: 12 },
  year: { type: Number, required: true, min: 2000 },
  category: { type: String, required: true, enum: CATEGORY_CODES },
  amount: { type: Number, required: true, min: 0 },
  paid_amount: { type: Number, default: 0, min: 0 },
  status: { type: String, enum: ['unpaid', 'partially_paid', 'paid'], default: 'unpaid' },
  resident_name: { type: String, trim: true },
  phone_number: { type: String, trim: true },
  room_number: { type: String, trim: true },
}, { timestamps: true, versionKey: false });

schema.index({ month: 1, year: 1, category: 1, resident_id: 1 }, { unique: true });
schema.index({ resident_id: 1, year: 1, month: 1 });

module.exports = mongoose.model('MemberBillRecord', schema);
