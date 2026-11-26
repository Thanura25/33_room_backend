const mongoose = require('mongoose');
const { CATEGORY_CODES } = require('./BillCategory');

const schema = new mongoose.Schema({
  month: { type: Number, required: true, min: 1, max: 12 },
  year: { type: Number, required: true, min: 2000 },
  category: { type: String, required: true, enum: CATEGORY_CODES },
  total_amount: { type: Number, required: true, min: 0 },
  description: { type: String, default: '', trim: true },
  document_url: { type: String, default: '' }, // Data URI or file URL (PDF or Image)
  document_name: { type: String, default: '' },
  is_distributed: { type: Boolean, default: false },
  distributed_at: { type: Date, default: null },
  participants: [{
    _id: false,
    resident_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Resident', required: true },
    name: String,
    phone_number: String,
    room_number: String,
    amount: Number,
  }],
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true, versionKey: false });

schema.index({ month: 1, year: 1, category: 1 }, { unique: true });

module.exports = mongoose.model('CategoryBill', schema);
