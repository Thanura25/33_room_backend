const MonthlyBill = require('../models/MonthlyBill');
const Resident = require('../models/Resident');
const ResidentBill = require('../models/ResidentBill');
const Payment = require('../models/Payment');
const Notification = require('../models/Notification');
const { monthParts } = require('../utils/validation');
const { ensureAllocations } = require('./billService');
const { getDeliveryConfig, billMessage } = require('./notificationService');
const { previousArrearsByResident, previousArrearsByRow, receiptTotals } = require('./arrearsService');

const rounded = value => Math.round(value * 100) / 100;
const monthKey = bill => `${bill.year}-${String(bill.month).padStart(2, '0')}`;

function serializeResident(person) {
  return { id: String(person._id), fullName: person.name, phone: person.phone_number, roomNumber: person.room_number || '', email: person.email || '', birthday: person.birthday || null, status: person.status, joinedDate: person.joined_date, leftDate: person.left_date };
}

function serializeBill(bill, rows = []) {
  return bill ? {
    id: String(bill._id), month: monthKey(bill), title: 'Electricity and Water Bill',
    totalAmount: bill.total_amount, electricity: bill.electricity ?? bill.total_amount,
    water: bill.water || 0, sharedCredit: bill.sharedCredit || 0, dueDate: bill.dueDate,
    notes: bill.notes || '', ...bill.readings,
    residentIds: rows.map(row => String(row.resident_id?._id || row.resident_id)),
    createdAt: bill.created_at, locked: true,
  } : null;
}

function allocationView(row, legacyPaid = 0, previousBalance = row.previous_balance || 0) {
  const payableAmount = rounded(Math.max(0, row.amount + previousBalance + (row.manual_adjustment || 0)));
  const paidAmount = rounded((row.paid_amount || 0) + legacyPaid);
  return {
    id: String(row._id), userId: String(row.resident_id?._id || row.resident_id),
    fullName: row.resident_name || row.resident_id?.name || 'Former resident',
    phone: row.phone_number || row.resident_id?.phone_number || '',
    roomNumber: row.room_number || row.resident_id?.room_number || '',
    shareAmount: row.amount, previousBalance,
    manualAdjustment: row.manual_adjustment || 0, payableAmount, paidAmount,
    balance: rounded(Math.max(0, payableAmount - paidAmount)),
    status: paidAmount >= payableAmount ? 'paid' : paidAmount > 0 ? 'partial' : 'pending',
    paymentMethod: row.payment_method || 'cash', paidAt: row.paid_date,
  };
}

async function getDashboard(month) {
  const period = monthParts(month);
  const bill = await MonthlyBill.findOne(period).lean();
  if (bill) await ensureAllocations(bill);
  const [users, rows, historyBills, notifications] = await Promise.all([
    Resident.find().sort({ name: 1 }).lean(),
    ResidentBill.find().populate('resident_id', 'name phone_number room_number').lean(),
    MonthlyBill.find().sort({ year: -1, month: -1 }).lean(),
    bill ? Notification.find({ bill_id: bill._id }).sort({ createdAt: 1 }).lean() : [],
  ]);
  const payments = rows.length ? await Payment.find({ resident_bill_id: { $in: rows.map(row => row._id) } }).lean() : [];
  const paidByRow = receiptTotals(payments);
  const previousByRow = previousArrearsByRow(historyBills, rows, paidByRow);
  const previousByResident = previousArrearsByResident(historyBills, rows, paidByRow, period);
  const allAllocations = rows.map(row => ({ ...allocationView(row, paidByRow.get(String(row._id)) || 0, previousByRow.get(String(row._id)) || 0), billId: String(row.bill_id) }));
  const allocations = bill ? allAllocations.filter(row => row.billId === String(bill._id)) : [];
  const totalPayable = rounded(allocations.reduce((sum, row) => sum + row.payableAmount, 0));
  const collected = rounded(allocations.reduce((sum, row) => sum + row.paidAmount, 0));
  const billPeriods = new Map(historyBills.map(item => [String(item._id), item.year * 12 + item.month]));
  const latestByResident = new Map();
  for (const row of allAllocations) {
    const latest = latestByResident.get(row.userId);
    if (!latest || billPeriods.get(row.billId) > billPeriods.get(latest.billId)) latestByResident.set(row.userId, row);
  }
  const history = historyBills.map(item => ({
    id: String(item._id), month: monthKey(item), totalBill: item.total_amount,
    collected: rounded(allAllocations.filter(row => row.billId === String(item._id)).reduce((sum, row) => sum + row.paidAmount, 0)),
  }));
  return {
    month, bill: serializeBill(bill, rows.filter(row => bill && String(row.bill_id) === String(bill._id))),
    users: users.map(person => ({ ...serializeResident(person), previousArrears: previousByResident.get(String(person._id)) || 0 })), allocations, history,
    notifications: notifications.map(item => {
      const row = allocations.find(allocation => allocation.userId === String(item.resident_id));
      const message = row && ['pending', 'failed'].includes(item.status)
        ? billMessage(bill, { amount: row.shareAmount, previous_balance: row.previousBalance, manual_adjustment: row.manualAdjustment, paid_amount: row.paidAmount }, allocations.length).message
        : item.message;
      return { id: String(item._id), residentId: String(item.resident_id), phone: item.phone_number, message, status: item.status, error: item.error_message || '', sentAt: item.sent_at };
    }),
    delivery: getDeliveryConfig(),
    summary: {
      totalUsers: users.length, activeUsers: users.filter(user => user.status === 'active').length,
      inactiveUsers: users.filter(user => user.status === 'inactive').length, selectedUsers: allocations.length,
      totalBill: bill?.total_amount || 0, electricityBill: bill?.electricity || 0, waterBill: bill?.water || 0,
      grossBill: rounded((bill?.electricity || 0) + (bill?.water || 0)), sharedCredit: bill?.sharedCredit || 0,
      totalPayable, carryForwardTotal: rounded(allocations.reduce((sum, row) => sum + row.previousBalance, 0)),
      adjustmentTotal: rounded(allocations.reduce((sum, row) => sum + row.manualAdjustment, 0)),
      collected, outstanding: rounded(allocations.reduce((sum, row) => sum + row.balance, 0)),
      paidUsers: allocations.filter(row => row.status === 'paid').length,
      pendingUsers: allocations.filter(row => row.status !== 'paid').length,
      collectionRate: totalPayable ? Math.min(100, Math.round(collected / totalPayable * 100)) : 0,
    },
    billingInsights: {
      monthsRecorded: history.length, totalBillsAmount: rounded(history.reduce((sum, item) => sum + item.totalBill, 0)),
      totalElectricityAmount: rounded(historyBills.reduce((sum, item) => sum + (item.electricity || 0), 0)),
      totalWaterAmount: rounded(historyBills.reduce((sum, item) => sum + (item.water || 0), 0)),
      totalCollectedAmount: rounded(allAllocations.reduce((sum, row) => sum + row.paidAmount, 0)),
      totalOutstandingAmount: rounded([...latestByResident.values()].reduce((sum, row) => sum + row.balance, 0)),
    },
  };
}

module.exports = { getDashboard, allocationView, serializeBill };

