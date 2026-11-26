const CategoryBill = require('../models/CategoryBill');
const MemberBillRecord = require('../models/MemberBillRecord');
const Payment = require('../models/Payment');
const Resident = require('../models/Resident');
const MonthlyDiscount = require('../models/MonthlyDiscount');
const { getMonthlyFinancialSummary } = require('./financialService');
const { CATEGORIES, getCategoryName } = require('../models/BillCategory');

const round = (val) => Math.round((Number(val) || 0) * 100) / 100;

async function generateReport({ type, year, month, memberId, category }) {
  const y = Number(year);
  const m = month ? Number(month) : null;

  switch (type) {
    case 'monthly_bills': {
      const query = { year: y };
      if (m) query.month = m;
      if (category && category !== 'all') query.category = category;

      const bills = await CategoryBill.find(query).sort({ month: -1, createdAt: -1 }).lean();
      return {
        type: 'Monthly Bills Report',
        data: bills.map(b => ({
          month: `${b.year}-${String(b.month).padStart(2, '0')}`,
          category: getCategoryName(b.category),
          totalAmount: b.total_amount,
          description: b.description || '—',
          status: b.is_distributed ? 'Distributed' : 'Draft / Undistributed',
          distributedAt: b.distributed_at ? new Date(b.distributed_at).toLocaleDateString() : '—',
          participantsCount: b.participants?.length || 0,
        })),
        summary: {
          totalBills: bills.length,
          totalAmount: round(bills.reduce((sum, b) => sum + b.total_amount, 0)),
        },
      };
    }

    case 'member_bills': {
      const query = { year: y };
      if (m) query.month = m;
      if (memberId && memberId !== 'all') query.resident_id = memberId;
      if (category && category !== 'all') query.category = category;

      const records = await MemberBillRecord.find(query).sort({ month: -1, resident_name: 1 }).lean();
      return {
        type: 'Member-wise Bill Report',
        data: records.map(r => ({
          month: `${r.year}-${String(r.month).padStart(2, '0')}`,
          memberName: r.resident_name || 'Member',
          roomNumber: r.room_number || '—',
          category: getCategoryName(r.category),
          amount: r.amount,
          paidAmount: r.paid_amount,
          status: r.status,
        })),
        summary: {
          totalRecords: records.length,
          totalBilled: round(records.reduce((sum, r) => sum + r.amount, 0)),
          totalPaid: round(records.reduce((sum, r) => sum + r.paid_amount, 0)),
        },
      };
    }

    case 'category_expenses': {
      const query = { year: y };
      if (m) query.month = m;
      if (category && category !== 'all') query.category = category;

      const bills = await CategoryBill.find(query).lean();
      const byCategory = {};
      for (const cat of CATEGORIES) {
        if (!category || category === 'all' || category === cat.code) {
          byCategory[cat.code] = { category: cat.name, totalAmount: 0, count: 0 };
        }
      }

      for (const b of bills) {
        if (byCategory[b.category]) {
          byCategory[b.category].totalAmount += b.total_amount;
          byCategory[b.category].count += 1;
        }
      }

      const rows = Object.values(byCategory).map(item => ({
        category: item.category,
        totalAmount: round(item.totalAmount),
        billCount: item.count,
      }));

      return {
        type: 'Category-wise Expense Report',
        data: rows,
        summary: {
          totalExpenses: round(rows.reduce((sum, r) => sum + r.totalAmount, 0)),
          totalBills: rows.reduce((sum, r) => sum + r.billCount, 0),
        },
      };
    }

    case 'payment_collections': {
      const query = { year: y };
      if (m) query.month = m;
      if (memberId && memberId !== 'all') query.resident_id = memberId;

      const payments = await Payment.find(query).populate('resident_id', 'name room_number').sort({ paid_date: -1 }).lean();
      return {
        type: 'Monthly Payment Collection Report',
        data: payments.map(p => ({
          receiptNumber: p.receipt_number || '—',
          date: new Date(p.paid_date).toLocaleDateString(),
          memberName: p.resident_id?.name || 'Member',
          roomNumber: p.resident_id?.room_number || '—',
          amount: p.amount,
          method: p.method,
          reference: p.reference || '—',
        })),
        summary: {
          totalPayments: payments.length,
          totalCollected: round(payments.reduce((sum, p) => sum + p.amount, 0)),
        },
      };
    }

    case 'outstanding_balances': {
      const currentMonth = m || new Date().getMonth() + 1;
      let summary = await getMonthlyFinancialSummary(y, currentMonth);
      if (memberId && memberId !== 'all') {
        summary = summary.filter(s => s.residentId === String(memberId));
      }

      return {
        type: 'Outstanding Balance Report',
        data: summary.map(s => ({
          memberName: s.name,
          roomNumber: s.roomNumber || '—',
          previousArrears: s.previousOutstanding,
          newCharges: s.totalNewCharges,
          grossAmount: s.grossAmount ?? round(s.previousOutstanding + s.totalNewCharges),
          discount: s.discount || 0,
          finalPayableDue: s.totalAmountDue,
          totalPaid: s.totalPaidAmount,
          remainingBalance: s.remainingBalance,
          paymentStatus: s.paymentStatus,
        })),
        summary: {
          totalMembers: summary.length,
          totalOutstanding: round(summary.reduce((sum, s) => sum + s.remainingBalance, 0)),
          totalPaid: round(summary.reduce((sum, s) => sum + s.totalPaidAmount, 0)),
          totalDiscount: round(summary.reduce((sum, s) => sum + (s.discount || 0), 0)),
        },
      };
    }

    case 'monthly_discounts': {
      const query = { year: y };
      if (m) query.month = m;

      const discounts = await MonthlyDiscount.find(query).sort({ month: -1 }).lean();
      const allRows = [];
      for (const disc of discounts) {
        for (const alloc of disc.allocations || []) {
          allRows.push({
            month: `${disc.year}-${String(disc.month).padStart(2, '0')}`,
            memberName: alloc.resident_name || 'Member',
            roomNumber: alloc.room_number || '—',
            phone: alloc.phone_number || '—',
            memberDiscount: alloc.discount_amount,
            totalHouseDiscount: disc.total_discount,
            reason: disc.reason || '—',
          });
        }
      }
      return {
        type: 'Monthly Member Discounts Report',
        data: allRows,
        summary: {
          totalDiscountsRecorded: discounts.length,
          totalDiscountAmount: round(discounts.reduce((sum, d) => sum + d.total_discount, 0)),
          allocatedMembers: allRows.length,
        },
      };
    }

    case 'unpaid_members': {
      const currentMonth = m || new Date().getMonth() + 1;
      let summary = await getMonthlyFinancialSummary(y, currentMonth);
      summary = summary.filter(s => s.remainingBalance > 0);
      if (memberId && memberId !== 'all') {
        summary = summary.filter(s => s.residentId === String(memberId));
      }

      return {
        type: 'Unpaid Members Report',
        data: summary.map(s => ({
          memberName: s.name,
          roomNumber: s.roomNumber || '—',
          phone: s.phone,
          previousArrears: s.previousOutstanding,
          newCharges: s.totalNewCharges,
          totalDue: s.totalAmountDue,
          paidSoFar: s.totalPaidAmount,
          outstandingBalance: s.remainingBalance,
          status: s.paymentStatus,
        })),
        summary: {
          unpaidCount: summary.length,
          totalOwed: round(summary.reduce((sum, s) => sum + s.remainingBalance, 0)),
        },
      };
    }

    case 'payment_history':
    default: {
      const query = {};
      if (y) query.year = y;
      if (m) query.month = m;
      if (memberId && memberId !== 'all') query.resident_id = memberId;

      const payments = await Payment.find(query).populate('resident_id', 'name room_number').sort({ paid_date: -1 }).lean();
      return {
        type: 'Payment History Report',
        data: payments.map(p => ({
          receiptNumber: p.receipt_number || '—',
          paymentDate: new Date(p.paid_date).toLocaleDateString(),
          memberName: p.resident_id?.name || 'Member',
          roomNumber: p.resident_id?.room_number || '—',
          amount: p.amount,
          method: p.method,
          reference: p.reference || '—',
          notes: p.notes || '—',
        })),
        summary: {
          count: payments.length,
          totalAmount: round(payments.reduce((sum, p) => sum + p.amount, 0)),
        },
      };
    }
  }
}

module.exports = {
  generateReport,
};
