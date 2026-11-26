const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  resident_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Resident', required: true },
  bill_id: { type: mongoose.Schema.Types.ObjectId, ref: 'MonthlyBill' },
  category_bill_id: { type: mongoose.Schema.Types.ObjectId, ref: 'CategoryBill' },
  category: { type: String, default: '' },
  phone_number: { type: String, required: true, trim: true },
  message: { type: String, required: true, trim: true },
  notification_key: { type: String },
  template_parameters: [String],
  message_version: Number,
  status: { type: String, enum: ['pending', 'sending', 'sent', 'failed', 'unknown'], default: 'pending' },
  error_message: { type: String, default: '' },
  provider_message_id: { type: String, default: '' },
  click_to_chat_url: { type: String, default: '' },
  sent_at: { type: Date, default: null },
}, { timestamps: true, versionKey: false });

schema.index({ notification_key: 1 }, { unique: true, partialFilterExpression: { notification_key: { $type: 'string' } } });
schema.index({ resident_id: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', schema);
