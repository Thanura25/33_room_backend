const MonthlyBill = require('../models/MonthlyBill');
const ResidentBill = require('../models/ResidentBill');
const Payment = require('../models/Payment');

const keyOf = value => String(value?._id || value);
const cents = value => Math.round(Number(value || 0) * 100);
const periodOf = bill => bill.year * 12 + bill.month;

function receiptTotals(payments) {
  const totals = new Map();
  for (const payment of payments) {
    const key = keyOf(payment.resident_bill_id);
    totals.set(key, (totals.get(key) || 0) + cents(payment.amount));
  }
  return new Map([...totals].map(([key, amount]) => [key, amount / 100]));
}

function previousArrearsByResident(bills, rows, receipts, period) {
  const previousBillIds = new Set(bills.filter(bill => periodOf(bill) < periodOf(period)).map(bill => keyOf(bill._id)));
  const balances = new Map();
  for (const row of rows) {
    if (!previousBillIds.has(keyOf(row.bill_id))) continue;
    const residentId = keyOf(row.resident_id);
    // Carried previous_balance is not a new charge: counting it again would
    // duplicate the same debt in every subsequent month.
    const remaining = cents(row.amount) + cents(row.manual_adjustment) - cents(row.paid_amount) - cents(receipts.get(keyOf(row._id)));
    balances.set(residentId, (balances.get(residentId) || 0) + remaining);
  }
  return new Map([...balances].map(([id, amount]) => [id, Math.max(0, amount) / 100]));
}

function previousArrearsByRow(bills, rows, receipts) {
  const periods = new Map(bills.map(bill => [keyOf(bill._id), periodOf(bill)]));
  const running = new Map();
  const balances = new Map();
  const sorted = rows.filter(row => periods.has(keyOf(row.bill_id))).slice().sort((a, b) => periods.get(keyOf(a.bill_id)) - periods.get(keyOf(b.bill_id)));
  for (const row of sorted) {
    const id = keyOf(row.resident_id);
    const previous = running.get(id) || 0;
    balances.set(keyOf(row._id), Math.max(0, previous) / 100);
    running.set(id, previous + cents(row.amount) + cents(row.manual_adjustment) - cents(row.paid_amount) - cents(receipts.get(keyOf(row._id))));
  }
  return balances;
}

async function getPreviousArrears(bill, residentIds) {
  const bills = await MonthlyBill.find({ $or: [{ year: { $lt: bill.year } }, { year: bill.year, month: { $lt: bill.month } }] }).lean();
  if (!bills.length || !residentIds.length) return new Map();
  const rows = await ResidentBill.find({ bill_id: { $in: bills.map(item => item._id) }, resident_id: { $in: residentIds } }).lean();
  const payments = await Payment.find({ resident_bill_id: { $in: rows.map(row => row._id) } }).lean();
  return previousArrearsByResident(bills, rows, receiptTotals(payments), bill);
}

module.exports = { getPreviousArrears, previousArrearsByResident, previousArrearsByRow, receiptTotals };
