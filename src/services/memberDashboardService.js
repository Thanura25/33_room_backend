const Resident = require('../models/Resident');
const MemberBillRecord = require('../models/MemberBillRecord');
const CategoryBill = require('../models/CategoryBill');
const MonthlyBill = require('../models/MonthlyBill');
const Payment = require('../models/Payment');
const Notification = require('../models/Notification');
const MonthlyDiscount = require('../models/MonthlyDiscount');
const { getMonthlyFinancialSummary } = require('./financialService');
const { CATEGORIES, getCategoryName } = require('../models/BillCategory');
const { fail } = require('../utils/validation');

const round = (val) => Math.round((Number(val) || 0) * 100) / 100;

async function getMemberDashboard(residentId, year, month) {
  const resident = await Resident.findById(residentId).lean();
  if (!resident) fail('Member profile not found.', 404);

  // Active residents count (for estimating per-member shares when pending distribution)
  const activeResidents = await Resident.find({ status: 'active' }).lean();
  const activeCount = Math.max(1, activeResidents.length);

  // Get financial summary for current selected month
  const monthlySummaries = await getMonthlyFinancialSummary(year, month);
  const mySummary = monthlySummaries.find(s => s.residentId === String(resident._id)) || {
    charges: { electricity: 0, water: 0, telecom: 0, restaurant: 0, other: 0 },
    previousOutstanding: 0,
    totalNewCharges: 0,
    totalAmountDue: 0,
    totalPaidAmount: 0,
    remainingBalance: 0,
    paymentStatus: 'Paid',
  };

  // Get all bill records for this member for current month
  const currentBillRecords = await MemberBillRecord.find({
    resident_id: resident._id,
    year: Number(year),
    month: Number(month),
  }).lean();

  // Fetch house category bills for this month entered by admin
  const allCategoryBills = await CategoryBill.find({
    year: Number(year),
    month: Number(month),
  }).lean();

  // Fetch monthly discount configured for this month
  const discountDoc = await MonthlyDiscount.findOne({
    year: Number(year),
    month: Number(month),
  }).lean();

  // Check legacy MonthlyBill (for combined billing flow utility entries)
  const legacyBill = await MonthlyBill.findOne({
    year: Number(year),
    month: Number(month),
  }).lean();

  const categoryBreakdown = CATEGORIES.map(cat => {
    const cb = allCategoryBills.find(b => b.category === cat.code);
    let totalBill = cb ? cb.total_amount : 0;
    let isDistributed = Boolean(cb?.is_distributed);
    let description = cb ? (cb.description || '') : '';
    let documentUrl = cb ? (cb.document_url || '') : '';
    let documentName = cb ? (cb.document_name || '') : '';
    let participants = cb ? (cb.participants || []) : [];

    // Fallback to legacy MonthlyBill if category is electricity or water and not recorded in CategoryBill
    if (!cb && legacyBill) {
      if (cat.code === 'electricity' && legacyBill.electricity > 0) {
        totalBill = legacyBill.electricity;
        isDistributed = true;
        description = 'Monthly electricity utility bill';
        participants = legacyBill.participants || [];
      } else if (cat.code === 'water' && legacyBill.water > 0) {
        totalBill = legacyBill.water;
        isDistributed = true;
        description = 'Monthly water utility bill';
        participants = legacyBill.participants || [];
      }
    }

    const myParticipant = participants.find(p => String(p.resident_id) === String(resident._id));
    const matchedRecords = currentBillRecords.filter(r => r.category === cat.code);
    const recAmount = matchedRecords.reduce((sum, r) => sum + r.amount, 0);
    const financialCharge = mySummary.charges ? (mySummary.charges[cat.code] || 0) : 0;

    const memberShare = financialCharge || (myParticipant ? myParticipant.amount : 0) || recAmount || 0;
    const isIncluded = Boolean(memberShare > 0 || myParticipant);
    const participantCount = participants.length > 0 ? participants.length : (isDistributed ? 0 : activeCount);
    const perPersonAmount = participantCount > 0 ? round(totalBill / participantCount) : 0;
    const estimatedShare = totalBill > 0 ? round(totalBill / activeCount) : 0;

    let statusText = 'No Charge';
    if (totalBill > 0) {
      if (isDistributed) {
        statusText = isIncluded ? 'Included' : 'Exempt';
      } else {
        statusText = 'Pending Split';
      }
    }

    return {
      code: cat.code,
      name: cat.name,
      icon: cat.icon,
      totalBill,
      totalAmount: totalBill,
      isRecorded: totalBill > 0,
      isDistributed,
      description,
      documentUrl,
      documentName,
      participantCount,
      perPersonAmount,
      estimatedShare,
      memberShare,
      amount: isDistributed ? memberShare : (totalBill > 0 ? estimatedShare : 0),
      isIncluded,
      isBilled: totalBill > 0,
      statusText,
    };
  });

  // Payment history for this member (all time or sorted newest first)
  const payments = await Payment.find({
    resident_id: resident._id,
  }).sort({ paid_date: -1 }).limit(50).lean();

  // Historical months for this member (distinct months where member had bills)
  const historyRecords = await MemberBillRecord.aggregate([
    { $match: { resident_id: resident._id } },
    { $group: {
      _id: { year: '$year', month: '$month' },
      totalCharges: { $sum: '$amount' },
      billCount: { $sum: 1 },
    } },
    { $sort: { '_id.year': -1, '_id.month': -1 } },
    { $limit: 12 },
  ]);

  const monthHistory = historyRecords.map(h => ({
    year: h._id.year,
    month: h._id.month,
    monthLabel: new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(h._id.year, h._id.month - 1, 1))),
    totalCharges: h.totalCharges,
    billCount: h.billCount,
  }));

  // WhatsApp notification history for this member
  const notifications = await Notification.find({
    resident_id: resident._id,
  }).sort({ createdAt: -1 }).limit(10).lean();

  // Combine CategoryBills with any legacy utility bills
  const combinedCategoryBills = [...allCategoryBills];
  if (legacyBill) {
    if (legacyBill.electricity > 0 && !combinedCategoryBills.some(b => b.category === 'electricity')) {
      combinedCategoryBills.push({
        _id: `legacy-elec-${legacyBill._id}`,
        category: 'electricity',
        total_amount: legacyBill.electricity,
        description: 'Monthly electricity bill',
        is_distributed: true,
        distributed_at: legacyBill.created_at || legacyBill.createdAt,
        participants: legacyBill.participants || [],
      });
    }
    if (legacyBill.water > 0 && !combinedCategoryBills.some(b => b.category === 'water')) {
      combinedCategoryBills.push({
        _id: `legacy-water-${legacyBill._id}`,
        category: 'water',
        total_amount: legacyBill.water,
        description: 'Monthly water bill',
        is_distributed: true,
        distributed_at: legacyBill.created_at || legacyBill.createdAt,
        participants: legacyBill.participants || [],
      });
    }
  }

  const categoryBills = combinedCategoryBills.map(cb => {
    const participants = cb.participants || [];
    const myParticipant = participants.find(p => String(p.resident_id) === String(resident._id));
    const participantCount = participants.length > 0 ? participants.length : (cb.is_distributed ? 0 : activeCount);
    const perPersonAmount = participantCount > 0 ? round(cb.total_amount / participantCount) : 0;
    const myShare = myParticipant ? myParticipant.amount : (cb.is_distributed ? 0 : round(cb.total_amount / activeCount));
    return {
      id: cb._id,
      category: cb.category,
      categoryName: getCategoryName(cb.category),
      totalAmount: cb.total_amount,
      participantCount,
      perPersonAmount,
      myShare,
      isIncluded: Boolean(myParticipant || !cb.is_distributed),
      description: cb.description || '',
      documentName: cb.document_name || '',
      documentUrl: cb.document_url || '',
      isDistributed: Boolean(cb.is_distributed),
      distributedAt: cb.distributed_at,
      participants: participants.map(p => ({
        residentId: p.resident_id,
        name: p.name,
        roomNumber: p.room_number || '',
        phone: p.phone_number || '',
        amount: p.amount,
        isMe: String(p.resident_id) === String(resident._id),
      })),
    };
  });

  return {
    member: {
      id: resident._id,
      name: resident.name,
      roomNumber: resident.room_number || 'N/A',
      phone: resident.phone_number,
      email: resident.email,
      status: resident.status,
    },
    month,
    year,
    summary: {
      currentMonthTotalBill: mySummary.totalNewCharges,
      previousOutstandingBalance: mySummary.previousOutstanding,
      grossAmount: mySummary.grossAmount ?? round(mySummary.totalNewCharges + mySummary.previousOutstanding),
      discount: mySummary.discount || 0,
      totalAmountDue: mySummary.totalAmountDue,
      totalPaid: mySummary.totalPaidAmount,
      remainingBalance: mySummary.remainingBalance,
      paymentStatus: mySummary.paymentStatus,
    },
    monthlyDiscount: {
      totalDiscount: discountDoc ? discountDoc.total_discount : 0,
      discountPerMember: discountDoc?.allocations?.length ? round(discountDoc.total_discount / discountDoc.allocations.length) : 0,
      memberCount: discountDoc?.allocations?.length || 0,
      myDiscount: mySummary.discount || 0,
      reason: discountDoc?.reason || '',
      isConfigured: Boolean(discountDoc && discountDoc.total_discount > 0),
    },
    categoryBreakdown,
    categoryBills,
    billRecords: currentBillRecords.map(b => ({
      id: b._id,
      category: b.category,
      categoryName: getCategoryName(b.category),
      amount: b.amount,
      paidAmount: b.paid_amount,
      status: b.status,
    })),
    paymentHistory: payments.map(p => ({
      id: p._id,
      receiptNumber: p.receipt_number || `RCP-${p._id.toString().slice(-6).toUpperCase()}`,
      amount: p.amount,
      method: p.method,
      reference: p.reference,
      notes: p.notes,
      paidDate: p.paid_date,
      month: p.month,
      year: p.year,
    })),
    monthHistory,
    notifications: notifications.map(n => ({
      id: n._id,
      message: n.message,
      status: n.status,
      clickToChatUrl: n.click_to_chat_url,
      sentAt: n.sent_at || n.createdAt,
    })),
  };
}

module.exports = {
  getMemberDashboard,
};
