const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  month: { type: Number, required: true, min: 1, max: 12 },
  year: { type: Number, required: true, min: 2000 },
  total_discount: { type: Number, required: true, min: 0 },
  reason: { type: String, trim: true, default: '' },
  allocations: [{
    _id: false,
    resident_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Resident', required: true },
    resident_name: { type: String, trim: true },
    room_number: { type: String, trim: true },
    phone_number: { type: String, trim: true },
    discount_amount: { type: Number, required: true, min: 0 },
  }],
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updated_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, versionKey: false });

schema.index({ year: 1, month: 1 }, { unique: true });

module.exports = mongoose.model('MonthlyDiscount', schema);
