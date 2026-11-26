const mongoose = require('mongoose');
const Resident = require('../models/Resident');
const CategoryBill = require('../models/CategoryBill');
const MemberBillRecord = require('../models/MemberBillRecord');
const Payment = require('../models/Payment');
const MonthlyBill = require('../models/MonthlyBill');
const ResidentBill = require('../models/ResidentBill');
const MonthlyDiscount = require('../models/MonthlyDiscount');
const { fail, money, objectId, date } = require('../utils/validation');

const round = (val) => Math.round((Number(val) || 0) * 100) / 100;
const toCents = (val) => Math.round((Number(val) || 0) * 100);

/**
 * Computes previous outstanding balance for residents before the given (year, month).
 */
async function computePreviousArrears(year, month, residentIds = []) {
  const currentPeriod = year * 12 + month;
  const matchResidents = residentIds.length ? { resident_id: { $in: residentIds } } : {};

  // 1. From MemberBillRecords in prior months
  const priorBillRecords = await MemberBillRecord.find({
    ...matchResidents,
    $or: [
      { year: { $lt: year } },
      { year, month: { $lt: month } },
    ],
  }).lean();

  // 2. From legacy ResidentBills in prior months
  const priorMonthlyBills = await MonthlyBill.find({
    $or: [
      { year: { $lt: year } },
      { year, month: { $lt: month } },
    ],
  }).lean();
  const priorMonthlyBillIds = new Set(priorMonthlyBills.map(b => String(b._id)));

  const priorLegacyRows = priorMonthlyBills.length
    ? await ResidentBill.find({
        bill_id: { $in: Array.from(priorMonthlyBillIds) },
        ...(residentIds.length ? { resident_id: { $in: residentIds } } : {}),
      }).lean()
    : [];

  // 3. Payments made in prior months
  const priorPayments = await Payment.find({
    ...matchResidents,
    $or: [
      { year: { $lt: year } },
      { year, month: { $lt: month } },
      // legacy payments with resident_bill_id belonging to prior bills
      { resident_bill_id: { $in: priorLegacyRows.map(r => r._id) } },
    ],
  }).lean();

  // Tally charges by resident in cents
  const debtByResident = new Map();

  for (const rec of priorBillRecords) {
    const resId = String(rec.resident_id);
    debtByResident.set(resId, (debtByResident.get(resId) || 0) + toCents(rec.amount));
  }

  for (const row of priorLegacyRows) {
    const resId = String(row.resident_id);
    // Include manual adjustment if any, and base amount
    debtByResident.set(resId, (debtByResident.get(resId) || 0) + toCents(row.amount) + toCents(row.manual_adjustment));
  }

  // Tally payments by resident in cents
  const paidByResident = new Map();
  for (const pay of priorPayments) {
    let resId = pay.resident_id ? String(pay.resident_id) : null;
    if (!resId && pay.resident_bill_id) {
      const matchedRow = priorLegacyRows.find(r => String(r._id) === String(pay.resident_bill_id));
      if (matchedRow) resId = String(matchedRow.resident_id);
    }
    if (resId) {
      paidByResident.set(resId, (paidByResident.get(resId) || 0) + toCents(pay.amount));
    }
  }

  // Subtract paid amounts from legacy paid_amount fields if recorded directly
  for (const row of priorLegacyRows) {
    if (row.paid_amount > 0) {
      const resId = String(row.resident_id);
      paidByResident.set(resId, (paidByResident.get(resId) || 0) + toCents(row.paid_amount));
    }
  }

  // 4. Subtract prior monthly discounts allocated to residents
  const priorDiscounts = await MonthlyDiscount.find({
    $or: [
      { year: { $lt: year } },
      { year, month: { $lt: month } },
    ],
  }).lean();

  for (const disc of priorDiscounts) {
    for (const alloc of disc.allocations || []) {
      const resId = String(alloc.resident_id);
      if (!residentIds.length || residentIds.some(id => String(id) === resId)) {
        debtByResident.set(resId, Math.max(0, (debtByResident.get(resId) || 0) - toCents(alloc.discount_amount)));
      }
    }
  }

  const allResIds = new Set([
    ...residentIds.map(id => String(id)),
    ...debtByResident.keys(),
    ...paidByResident.keys(),
  ]);

  const result = new Map();
  for (const resId of allResIds) {
    const chargesCents = debtByResident.get(resId) || 0;
    const paidCents = paidByResident.get(resId) || 0;
    // Net arrears: positive means member owes money; negative means member overpaid (credit)
    const netArrearsCents = chargesCents - paidCents;
    result.set(resId, netArrearsCents / 100);
  }

  return result;
}

/**
 * Returns complete outstanding balances and financial matrix for all residents for a month/year.
 */
async function getMonthlyFinancialSummary(year, month) {
  const residents = await Resident.find().sort({ room_number: 1, name: 1 }).lean();
  const residentIds = residents.map(r => r._id);

  // Get all MemberBillRecords for current month
  const currentRecords = await MemberBillRecord.find({ year, month }).lean();

  // Check legacy ResidentBills for this month
  const legacyBill = await MonthlyBill.findOne({ year, month }).lean();
  const legacyRows = legacyBill
    ? await ResidentBill.find({ bill_id: legacyBill._id }).lean()
    : [];

  // Previous arrears
  const previousArrearsMap = await computePreviousArrears(year, month, residentIds);

  // Monthly discount configured for this month
  const monthlyDiscount = await MonthlyDiscount.findOne({ year, month }).lean();

  // Payments for this month
  const currentPayments = await Payment.find({
    $or: [
      { year, month },
      ...(legacyRows.length ? [{ resident_bill_id: { $in: legacyRows.map(r => r._id) } }] : []),
    ],
  }).lean();

  // Group current records by resident
  const memberMatrix = residents.map(resident => {
    const resId = String(resident._id);
    const records = currentRecords.filter(r => String(r.resident_id) === resId);
    const legacyRow = legacyRows.find(r => String(r.resident_id) === resId);

    // Sum category charges
    let electricity = 0;
    let water = 0;
    let telecom = 0;
    let restaurant = 0;
    let other = 0;

    for (const rec of records) {
      if (rec.category === 'electricity') electricity += rec.amount;
      else if (rec.category === 'water') water += rec.amount;
      else if (rec.category === 'telecom') telecom += rec.amount;
      else if (rec.category === 'restaurant') restaurant += rec.amount;
      else if (rec.category === 'other') other += rec.amount;
    }

    // Merge legacy electricity and water if no category records exist for them
    if (legacyRow) {
      if (electricity === 0 && legacyBill?.electricity) {
        // portion for this resident
        electricity = round((legacyBill.electricity / (legacyBill.participants?.length || 1)));
      }
      if (water === 0 && legacyBill?.water) {
        water = round((legacyBill.water / (legacyBill.participants?.length || 1)));
      }
    }

    electricity = round(electricity);
    water = round(water);
    telecom = round(telecom);
    restaurant = round(restaurant);
    other = round(other);

    const totalNewCharges = round(electricity + water + telecom + restaurant + other);
    const previousOutstanding = round(previousArrearsMap.get(resId) || 0);
    const grossAmount = round(previousOutstanding + totalNewCharges);

    const discAlloc = monthlyDiscount?.allocations?.find(a => String(a.resident_id) === resId);
    const discount = discAlloc ? round(discAlloc.discount_amount) : 0;
    
    // Member cannot owe negative due to discount alone, but previous overpayment (credit) carries forward
    const payableBeforeDiscount = Math.max(0, grossAmount);
    const totalAmountDue = round(Math.max(0, payableBeforeDiscount - discount));

    // Payments
    const memberPayments = currentPayments.filter(p => {
      if (p.resident_id && String(p.resident_id) === resId) return true;
      if (legacyRow && p.resident_bill_id && String(p.resident_bill_id) === String(legacyRow._id)) return true;
      return false;
    });

    const totalPaidAmount = round(
      memberPayments.reduce((sum, p) => sum + p.amount, 0) + (legacyRow?.paid_amount || 0)
    );

    // If member paid more than totalAmountDue, or if grossAmount was negative from carried credit,
    // remaining balance reflects the overpaid / credit amount (negative)
    const creditCarried = grossAmount < 0 ? grossAmount : 0;
    const remainingBalance = round(totalAmountDue + creditCarried - totalPaidAmount);

    let paymentStatus = 'Unpaid';
    if (totalAmountDue === 0 && totalPaidAmount === 0 && grossAmount <= 0) {
      paymentStatus = 'Paid';
    } else if (remainingBalance <= 0) {
      paymentStatus = 'Paid';
    } else if (totalPaidAmount > 0) {
      paymentStatus = 'Partially Paid';
    } else {
      paymentStatus = 'Unpaid';
    }

    return {
      residentId: resId,
      name: resident.name,
      roomNumber: resident.room_number || '',
      phone: resident.phone_number,
      email: resident.email || '',
      status: resident.status,
      charges: {
        electricity,
        water,
        telecom,
        restaurant,
        other,
      },
      previousOutstanding,
      totalNewCharges,
      grossAmount,
      discount,
      totalAmountDue,
      totalPaidAmount,
      remainingBalance,
      paymentStatus,
    };
  });

  return memberMatrix;
}

/**
 * Generate sequential unique receipt number
 */
async function generateReceiptNumber(year, month) {
  const prefix = `RCP-${year}${String(month).padStart(2, '0')}`;
  const count = await Payment.countDocuments({
    receipt_number: new RegExp(`^${prefix}`),
  });
  const seq = String(count + 1).padStart(4, '0');
  return `${prefix}-${seq}`;
}

/**
 * Record a payment with partial payment support and generate receipt.
 */
async function recordPayment({ residentId, month, year, amount, method, reference = '', notes = '', recordedBy, paymentDate }) {
  objectId(residentId, 'Resident ID');
  const payAmount = money(amount, 'Payment amount');
  if (payAmount <= 0) fail('Payment amount must be greater than zero.');

  const resident = await Resident.findById(residentId);
  if (!resident) fail('Resident not found.', 404);

  const receiptNumber = await generateReceiptNumber(year, month);
  const payDate = paymentDate ? date(paymentDate, 'Payment date') : new Date();

  const payment = await Payment.create({
    resident_id: resident._id,
    month: Number(month),
    year: Number(year),
    amount: payAmount,
    method: method || 'cash',
    reference: String(reference || '').trim(),
    notes: String(notes || '').trim(),
    receipt_number: receiptNumber,
    paid_date: payDate,
    recorded_by: recordedBy,
  });

  // Check and update member bill records for that month
  const records = await MemberBillRecord.find({ resident_id: resident._id, month, year });
  let remainingPay = payAmount;
  for (const rec of records) {
    if (remainingPay <= 0) break;
    const unpaidOnRecord = rec.amount - rec.paid_amount;
    if (unpaidOnRecord > 0) {
      const apply = Math.min(remainingPay, unpaidOnRecord);
      rec.paid_amount = round(rec.paid_amount + apply);
      rec.status = rec.paid_amount >= rec.amount ? 'paid' : 'partially_paid';
      await rec.save();
      remainingPay -= apply;
    }
  }

  // Get current financial status for the receipt
  const summary = await getMonthlyFinancialSummary(year, month);
  const memberSummary = summary.find(s => s.residentId === String(resident._id));

  return {
    payment: {
      id: payment._id,
      receiptNumber: payment.receipt_number,
      residentId: resident._id,
      residentName: resident.name,
      roomNumber: resident.room_number,
      phone: resident.phone_number,
      amount: payment.amount,
      method: payment.method,
      reference: payment.reference,
      notes: payment.notes,
      paidDate: payment.paid_date,
      month,
      year,
      remainingBalance: memberSummary?.remainingBalance ?? 0,
      totalAmountDue: memberSummary?.totalAmountDue ?? 0,
      totalPaidAmount: memberSummary?.totalPaidAmount ?? 0,
      paymentStatus: memberSummary?.paymentStatus ?? 'Paid',
    },
  };
}

module.exports = {
  computePreviousArrears,
  getMonthlyFinancialSummary,
  recordPayment,
  generateReceiptNumber,
};
