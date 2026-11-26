const CategoryBill = require('../models/CategoryBill');
const BillDistribution = require('../models/BillDistribution');
const MemberBillRecord = require('../models/MemberBillRecord');
const Resident = require('../models/Resident');
const { CATEGORIES, CATEGORY_CODES, getCategoryName } = require('../models/BillCategory');
const { splitBill } = require('../utils/calculateBill');
const { fail, money, objectId } = require('../utils/validation');
const { dispatchOrQueueWhatsApp } = require('./whatsappService');
const { getMonthlyFinancialSummary } = require('./financialService');

const round = (val) => Math.round((Number(val) || 0) * 100) / 100;

/**
 * Returns available bill categories
 */
function getCategories() {
  return CATEGORIES;
}

/**
 * Get all category bills for a specific month and year
 */
async function getMonthCategoryBills(year, month) {
  const bills = await CategoryBill.find({ year: Number(year), month: Number(month) })
    .populate('created_by', 'name email')
    .sort({ createdAt: -1 })
    .lean();

  const distributions = await BillDistribution.find({ year: Number(year), month: Number(month) }).lean();
  const distMap = new Map(distributions.map(d => [String(d.bill_id), d]));

  return bills.map(bill => ({
    ...bill,
    categoryName: getCategoryName(bill.category),
    distribution: distMap.get(String(bill._id)) || null,
  }));
}

/**
 * Create a new Category Bill
 */
async function createCategoryBill({ month, year, category, totalAmount, description = '', documentUrl = '', documentName = '', createdBy }) {
  if (!CATEGORY_CODES.includes(category)) {
    fail(`Invalid category. Must be one of: ${CATEGORY_CODES.join(', ')}`);
  }
  const amt = money(totalAmount, 'Bill total amount');
  if (amt <= 0) fail('Total bill amount must be greater than zero.');

  const existing = await CategoryBill.findOne({ month: Number(month), year: Number(year), category });
  if (existing) {
    if (existing.is_distributed) {
      fail(`A bill for ${getCategoryName(category)} in this month has already been distributed.`, 409);
    }
    // Update existing undistributed bill
    existing.total_amount = amt;
    existing.description = String(description || '').trim();
    if (documentUrl) {
      existing.document_url = documentUrl;
      existing.document_name = documentName || 'bill-attachment';
    }
    await existing.save();
    return existing;
  }

  const bill = await CategoryBill.create({
    month: Number(month),
    year: Number(year),
    category,
    total_amount: amt,
    description: String(description || '').trim(),
    document_url: documentUrl || '',
    document_name: documentName || '',
    created_by: createdBy,
  });

  return bill;
}

/**
 * Preview bill distribution before submitting
 */
async function previewDistribution({ billId, residentIds }) {
  objectId(billId, 'Bill ID');
  const bill = await CategoryBill.findById(billId);
  if (!bill) fail('Bill not found.', 404);

  if (!Array.isArray(residentIds) || residentIds.length === 0) {
    fail('Please select at least one member to share this bill.');
  }

  const residents = await Resident.find({ _id: { $in: residentIds } }).lean();
  if (residents.length !== residentIds.length) {
    fail('One or more selected residents could not be found.');
  }

  const resMap = new Map(residents.map(r => [String(r._id), r]));
  const splits = splitBill(bill.total_amount, residentIds);

  const previewList = splits.map(split => {
    const res = resMap.get(String(split.resident_id));
    return {
      residentId: split.resident_id,
      name: res.name,
      roomNumber: res.room_number || '',
      phoneNumber: res.phone_number,
      amount: split.amount,
    };
  });

  return {
    billId: bill._id,
    category: bill.category,
    categoryName: getCategoryName(bill.category),
    totalAmount: bill.total_amount,
    memberCount: residentIds.length,
    averageShare: round(bill.total_amount / residentIds.length),
    preview: previewList,
  };
}

/**
 * Distribute Category Bill among selected members and queue/send WhatsApp notices
 */
async function distributeBill({ billId, residentIds, sendWhatsApp = true, distributedBy }) {
  objectId(billId, 'Bill ID');
  const bill = await CategoryBill.findById(billId);
  if (!bill) fail('Bill not found.', 404);

  if (bill.is_distributed) {
    fail('This bill has already been distributed. Duplicate distributions are not allowed.', 409);
  }

  if (!Array.isArray(residentIds) || residentIds.length === 0) {
    fail('Please select at least one member to share this bill.');
  }

  const residents = await Resident.find({ _id: { $in: residentIds } });
  if (residents.length !== residentIds.length) {
    fail('One or more selected residents could not be found.');
  }

  // Calculate shares using splitBill for exact rounding
  const splits = splitBill(bill.total_amount, residentIds);
  const resMap = new Map(residents.map(r => [String(r._id), r]));

  const participants = splits.map(split => {
    const res = resMap.get(String(split.resident_id));
    return {
      resident_id: res._id,
      name: res.name,
      phone_number: res.phone_number,
      room_number: res.room_number,
      amount: split.amount,
    };
  });

  // 1. Create or update BillDistribution
  const distribution = await BillDistribution.findOneAndUpdate(
    { month: bill.month, year: bill.year, category: bill.category },
    {
      $set: {
        bill_id: bill._id,
        month: bill.month,
        year: bill.year,
        category: bill.category,
        total_amount: bill.total_amount,
        member_count: residentIds.length,
        per_member_share: round(bill.total_amount / residentIds.length),
        distributed_at: new Date(),
        distributed_by: distributedBy,
      },
    },
    { upsert: true, returnDocument: 'after' }
  );

  // 2. Create MemberBillRecord for each participant
  const memberRecords = participants.map(part => ({
    updateOne: {
      filter: {
        month: bill.month,
        year: bill.year,
        category: bill.category,
        resident_id: part.resident_id,
      },
      update: {
        $set: {
          distribution_id: distribution._id,
          bill_id: bill._id,
          month: bill.month,
          year: bill.year,
          category: bill.category,
          amount: part.amount,
          resident_name: part.name,
          phone_number: part.phone_number,
          room_number: part.room_number,
        },
      },
      upsert: true,
    },
  }));
  await MemberBillRecord.bulkWrite(memberRecords);

  // 3. Mark bill as distributed
  bill.is_distributed = true;
  bill.distributed_at = new Date();
  bill.participants = participants;
  await bill.save();

  // 4. Send or queue WhatsApp notifications if enabled
  const notifications = [];
  try {
    const currentFinancialSummary = await getMonthlyFinancialSummary(bill.year, bill.month);
    const summaryMap = new Map(currentFinancialSummary.map(s => [s.residentId, s]));

    for (const res of residents) {
      const summary = summaryMap.get(String(res._id));
      const part = participants.find(p => String(p.resident_id) === String(res._id));

      const notice = await dispatchOrQueueWhatsApp({
        resident: res,
        month: bill.month,
        year: bill.year,
        categoryCharges: summary ? summary.charges : { [bill.category]: part.amount },
        totalNewCharges: summary ? summary.totalNewCharges : part.amount,
        previousArrears: summary ? summary.previousOutstanding : 0,
        totalDue: summary ? summary.totalAmountDue : part.amount,
        dueDate: '',
        categoryBillId: bill._id,
        category: bill.category,
      });
      notifications.push(notice);
    }
  } catch (err) {
    console.error('WhatsApp notification error during distribution:', err);
  }

  return {
    bill,
    distribution,
    participants,
    notifications,
  };
}

module.exports = {
  getCategories,
  getMonthCategoryBills,
  createCategoryBill,
  previewDistribution,
  distributeBill,
};
