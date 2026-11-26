const financialService = require('../services/financialService');
const Payment = require('../models/Payment');
const { fail, objectId } = require('../utils/validation');

exports.getBalances = async (request, response) => {
  const { year, month } = request.query;
  if (!year || !month) fail('Year and month are required.');
  const summary = await financialService.getMonthlyFinancialSummary(Number(year), Number(month));
  return response.json(summary);
};

exports.recordPayment = async (request, response) => {
  const { residentId, month, year, amount, method, reference, notes, paymentDate } = request.body;
  const result = await financialService.recordPayment({
    residentId,
    month: Number(month),
    year: Number(year),
    amount,
    method,
    reference,
    notes,
    paymentDate,
    recordedBy: request.auth?.id,
  });
  return response.status(201).json(result);
};

exports.getPayments = async (request, response) => {
  const { year, month, residentId } = request.query;
  const filter = {};
  if (year) filter.year = Number(year);
  if (month) filter.month = Number(month);
  if (residentId) filter.resident_id = residentId;

  const payments = await Payment.find(filter)
    .populate('resident_id', 'name room_number phone_number email')
    .sort({ paid_date: -1 })
    .limit(100)
    .lean();

  return response.json(payments.map(p => ({
    id: p._id,
    receiptNumber: p.receipt_number || `RCP-${p._id.toString().slice(-6).toUpperCase()}`,
    residentId: p.resident_id?._id,
    memberName: p.resident_id?.name || 'Member',
    roomNumber: p.resident_id?.room_number || '—',
    phoneNumber: p.resident_id?.phone_number || '',
    amount: p.amount,
    method: p.method,
    reference: p.reference,
    notes: p.notes,
    paidDate: p.paid_date,
    month: p.month,
    year: p.year,
  })));
};

exports.getReceipt = async (request, response) => {
  objectId(request.params.id, 'Payment ID');
  const payment = await Payment.findById(request.params.id)
    .populate('resident_id', 'name room_number phone_number email')
    .lean();

  if (!payment) fail('Payment receipt not found.', 404);

  // Get member's balance status for that month
  let remainingBalance = 0;
  let totalAmountDue = 0;
  if (payment.year && payment.month) {
    const summary = await financialService.getMonthlyFinancialSummary(payment.year, payment.month);
    const memberSummary = summary.find(s => s.residentId === String(payment.resident_id?._id));
    if (memberSummary) {
      remainingBalance = memberSummary.remainingBalance;
      totalAmountDue = memberSummary.totalAmountDue;
    }
  }

  return response.json({
    id: payment._id,
    receiptNumber: payment.receipt_number || `RCP-${payment._id.toString().slice(-6).toUpperCase()}`,
    residentId: payment.resident_id?._id,
    memberName: payment.resident_id?.name || 'Boarding Member',
    roomNumber: payment.resident_id?.room_number || 'N/A',
    phoneNumber: payment.resident_id?.phone_number || '',
    email: payment.resident_id?.email || '',
    amount: payment.amount,
    method: payment.method,
    reference: payment.reference || '',
    notes: payment.notes || '',
    paidDate: payment.paid_date,
    month: payment.month,
    year: payment.year,
    remainingBalance,
    totalAmountDue,
  });
};
