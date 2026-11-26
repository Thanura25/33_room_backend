const Payment = require('../models/Payment');
const ResidentBill = require('../models/ResidentBill');
const MonthlyBill = require('../models/MonthlyBill');
const { fail, money, objectId, date } = require('../utils/validation');
const { getDashboard } = require('../services/dashboardService');
const { getPreviousArrears } = require('../services/arrearsService');

exports.update = async (request, response) => {
  objectId(request.params.id, 'Allocation ID');
  const row = await ResidentBill.findById(request.params.id);
  if (!row) fail('Resident bill not found.', 404);
  const paidAmount = money(request.body.paidAmount, 'Paid amount');
  const bill = await MonthlyBill.findById(row.bill_id);
  const previousArrears = await getPreviousArrears(bill, [row.resident_id]);
  const previousBalance = previousArrears.get(String(row.resident_id)) || 0;
  const manualAdjustment = money(request.body.manualAdjustment ?? 0, 'Manual adjustment', { negative: true });
  const payable = Math.round((row.amount + previousBalance + manualAdjustment) * 100) / 100;
  if (payable < 0 || paidAmount > payable) fail('Paid amount must be between zero and the final payable amount.');
  const paymentMethod = request.body.paymentMethod || 'cash';
  if (!['cash', 'bank transfer', 'online payment'].includes(paymentMethod)) fail('Choose a valid payment method.');
  const legacyPaid = (await Payment.find({ resident_bill_id: row._id })).reduce((sum, payment) => sum + payment.amount, 0);
  if (paidAmount < Math.round(legacyPaid * 100) / 100) fail('Paid amount cannot be below existing payment receipts.');
  const paidAt = date(request.body.paidAt, 'Paid date');
  await ResidentBill.findByIdAndUpdate(row._id, { $set: {
    paid_amount: Math.round((paidAmount - legacyPaid) * 100) / 100,
    previous_balance: previousBalance, manual_adjustment: manualAdjustment, payment_method: paymentMethod,
    payment_status: paidAmount >= payable ? 'paid' : paidAmount > 0 ? 'partial' : 'pending',
    paid_date: paidAmount > 0 ? paidAt || new Date() : null,
  } }, { runValidators: true });
  return response.json(await getDashboard(`${bill.year}-${String(bill.month).padStart(2, '0')}`));
};

// Legacy clients record additional receipts. The current UI uses the idempotent
// cumulative payment endpoint above so retrying a save does not charge twice.
exports.create = async (request, response) => {
  const { resident_bill_id, method = 'cash' } = request.body;
  objectId(resident_bill_id, 'Allocation ID');
  const amount = money(request.body.amount, 'Payment');
  if (amount <= 0) fail('Payment must be greater than zero.');
  if (!['cash', 'bank_transfer', 'online'].includes(method)) fail('Choose a valid payment method.');
  const residentBill = await ResidentBill.findById(resident_bill_id);
  if (!residentBill) fail('Resident bill not found.', 404);
  const payment = await Payment.create({ resident_bill_id, amount, method });
  const totalPaid = residentBill.paid_amount + (await Payment.find({ resident_bill_id })).reduce((sum, item) => sum + item.amount, 0);
  const bill = await MonthlyBill.findById(residentBill.bill_id);
  const previousArrears = await getPreviousArrears(bill, [residentBill.resident_id]);
  residentBill.previous_balance = previousArrears.get(String(residentBill.resident_id)) || 0;
  const payable = residentBill.amount + residentBill.previous_balance + residentBill.manual_adjustment;
  residentBill.payment_status = totalPaid >= payable ? 'paid' : 'partial';
  residentBill.paid_date = payment.paid_date;
  await residentBill.save();
  return response.status(201).json({ payment, residentBill });
};

