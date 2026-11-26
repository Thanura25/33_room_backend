const mongoose = require('mongoose');
const { CATEGORY_CODES } = require('./BillCategory');

const schema = new mongoose.Schema({
  bill_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CategoryBill', required: true },
  month: { type: Number, required: true, min: 1, max: 12 },
  year: { type: Number, required: true, min: 2000 },
  category: { type: String, required: true, enum: CATEGORY_CODES },
  total_amount: { type: Number, required: true, min: 0 },
  member_count: { type: Number, required: true, min: 1 },
  per_member_share: { type: Number, required: true, min: 0 },
  distributed_at: { type: Date, default: Date.now },
  distributed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, versionKey: false });

schema.index({ month: 1, year: 1, category: 1 }, { unique: true });

module.exports = mongoose.model('BillDistribution', schema);
