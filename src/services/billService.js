const crypto = require('node:crypto');
const MonthlyBill = require('../models/MonthlyBill');
const Resident = require('../models/Resident');
const ResidentBill = require('../models/ResidentBill');
const Payment = require('../models/Payment');
const { getPreviousArrears, receiptTotals } = require('./arrearsService');
const { splitBill } = require('../utils/calculateBill');
const { fail, money, monthParts, objectId, date, phone } = require('../utils/validation');

function prepareBill(monthKey, input) {
  const period = monthParts(monthKey);
  const electricity = money(input.electricity ?? input.total_amount ?? 0, 'Electricity');
  const water = money(input.water ?? 0, 'Water');
  const sharedCredit = money(input.sharedCredit ?? 0, 'Shared credit');
  const total_amount = (Math.round(electricity * 100) + Math.round(water * 100) - Math.round(sharedCredit * 100)) / 100;
  if (total_amount < 0) fail('Shared credit cannot exceed the utility total.');
  if (!Array.isArray(input.residentIds) || !input.residentIds.length) fail('Select the residents who stayed this month.');
  const residentIds = input.residentIds.map(id => objectId(id, 'Resident ID')).sort();
  if (new Set(residentIds).size !== residentIds.length) fail('Select each resident only once.');
  const readings = {};
  for (const key of ['electricityPreviousDate', 'electricityCurrentDate', 'waterReading1Date', 'waterReading2Date', 'waterReading3Date']) readings[key] = date(input[key], key);
  for (const key of ['electricityPreviousReading', 'electricityCurrentReading', 'waterReading1Value', 'waterReading2Value', 'waterReading3Value']) readings[key] = input[key] == null || input[key] === '' ? null : money(input[key], key);
  const data = { ...period, electricity, water, sharedCredit, total_amount, dueDate: date(input.dueDate, 'Due date'), notes: String(input.notes || '').trim(), readings };
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify({ ...data, residentIds })).digest('hex');
  return { data, residentIds, fingerprint };
}

async function ensureAllocations(bill) {
  if (!bill.participants?.length) return;
  // Only fill missing rows; a retry must never reset an existing payment.
  await ResidentBill.bulkWrite(bill.participants.map(person => ({
    updateOne: {
      filter: { bill_id: bill._id, resident_id: person.resident_id },
      update: { $setOnInsert: {
        bill_id: bill._id, resident_id: person.resident_id, amount: person.amount,
        resident_name: person.name, phone_number: person.phone_number, room_number: person.room_number,
      } }, upsert: true,
    },
  })));
}

async function saveMonthlyBill(monthKey, input) {
  const { data, residentIds, fingerprint } = prepareBill(monthKey, input);
  let bill = await MonthlyBill.findOne({ month: data.month, year: data.year });
  if (!bill) {
    const residents = await Resident.find({ _id: { $in: residentIds } });
    if (residents.length !== residentIds.length) fail('One or more selected residents no longer exist. Refresh the resident list.');
    const byId = new Map(residents.map(person => [String(person._id), person]));
    const participants = splitBill(data.total_amount, residentIds).map(row => {
      const person = byId.get(String(row.resident_id));
      return { ...row, name: person.name, phone_number: phone(person.phone_number), room_number: person.room_number };
    });
    try {
      bill = await MonthlyBill.create({ ...data, participants, request_fingerprint: fingerprint });
    } catch (error) {
      if (error.code !== 11000) throw error;
      bill = await MonthlyBill.findOne({ month: data.month, year: data.year });
    }
  }
  if (bill.request_fingerprint !== fingerprint) fail('A bill is already saved for this month. Saved bills are locked to preserve shares, messages and payments. Choose another month.', 409);
  await ensureAllocations(bill);
  return bill;
}

async function createMonthlyBill(input) {
  return saveMonthlyBill(`${input.year}-${String(input.month).padStart(2, '0')}`, input);
}

async function getBillDetails(billId) {
  objectId(billId, 'Bill ID');
  const bill = await MonthlyBill.findById(billId);
  if (!bill) fail('Monthly bill not found.', 404);
  await ensureAllocations(bill);
  const residentBills = await ResidentBill.find({ bill_id: billId }).populate('resident_id', 'name phone_number room_number');
  const [previousArrears, receipts] = await Promise.all([
    getPreviousArrears(bill, residentBills.map(row => row.resident_id?._id || row.resident_id)),
    Payment.find({ resident_bill_id: { $in: residentBills.map(row => row._id) } }).lean(),
  ]);
  const paidByRow = receiptTotals(receipts);
  for (const row of residentBills) {
    row.previous_balance = previousArrears.get(String(row.resident_id?._id || row.resident_id)) || 0;
    row.paid_amount = Math.round(((row.paid_amount || 0) + (paidByRow.get(String(row._id)) || 0)) * 100) / 100;
  }
  return { bill, residentBills };
}

module.exports = { createMonthlyBill, saveMonthlyBill, getBillDetails, ensureAllocations, prepareBill };

