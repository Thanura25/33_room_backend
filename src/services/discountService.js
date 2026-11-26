const MonthlyDiscount = require('../models/MonthlyDiscount');
const Resident = require('../models/Resident');
const { fail, money } = require('../utils/validation');

const round = (val) => Math.round((Number(val) || 0) * 100) / 100;

/**
 * Evenly divides the total discount amount among eligible residents using cent precision.
 * Remainder cents are allocated one-by-one so the exact sum matches total discount.
 */
function divideDiscount(totalAmount, residents) {
  if (!Array.isArray(residents) || residents.length === 0) return [];
  const totalCents = Math.round(Number(totalAmount || 0) * 100);
  if (totalCents <= 0) {
    return residents.map(r => ({
      resident_id: r._id,
      resident_name: r.name,
      room_number: r.room_number || '',
      phone_number: r.phone_number || '',
      discount_amount: 0,
    }));
  }

  const count = residents.length;
  const baseCents = Math.floor(totalCents / count);
  const remainder = totalCents % count;

  return residents.map((r, index) => {
    const memberCents = baseCents + (index < remainder ? 1 : 0);
    return {
      resident_id: r._id,
      resident_name: r.name,
      room_number: r.room_number || '',
      phone_number: r.phone_number || '',
      discount_amount: Math.round(memberCents) / 100,
    };
  });
}

/**
 * Get the monthly discount record for a given year and month.
 */
async function getMonthlyDiscount(year, month) {
  const y = Number(year);
  const m = Number(month);
  if (!y || !m || m < 1 || m > 12) fail('Valid year and month are required.');

  const discount = await MonthlyDiscount.findOne({ year: y, month: m }).lean();
  const activeResidents = await Resident.find({ status: 'active' }).sort({ room_number: 1, name: 1 }).lean();

  if (!discount) {
    return {
      year: y,
      month: m,
      totalDiscount: 0,
      reason: '',
      isConfigured: false,
      memberCount: activeResidents.length,
      discountPerMember: 0,
      allocations: activeResidents.map(r => ({
        resident_id: r._id,
        resident_name: r.name,
        room_number: r.room_number || '',
        phone_number: r.phone_number || '',
        discount_amount: 0,
      })),
    };
  }

  const memberCount = discount.allocations?.length || activeResidents.length || 1;
  const discountPerMember = round(discount.total_discount / memberCount);

  return {
    id: discount._id,
    year: discount.year,
    month: discount.month,
    totalDiscount: discount.total_discount,
    reason: discount.reason || '',
    isConfigured: true,
    memberCount,
    discountPerMember,
    allocations: discount.allocations || [],
    createdAt: discount.createdAt,
    updatedAt: discount.updatedAt,
  };
}

/**
 * Preview discount division among members before committing.
 */
async function previewDiscount({ year, month, totalDiscount, residentIds, memberCount }) {
  const y = Number(year);
  const m = Number(month);
  if (!y || !m || m < 1 || m > 12) fail('Valid year and month are required.');
  const discountAmount = money(totalDiscount ?? 0, 'Total discount amount');

  let residents;
  if (Array.isArray(residentIds) && residentIds.length > 0) {
    residents = await Resident.find({ _id: { $in: residentIds } }).sort({ room_number: 1, name: 1 }).lean();
  } else {
    residents = await Resident.find({ status: 'active' }).sort({ room_number: 1, name: 1 }).lean();
    if (memberCount && Number(memberCount) > 0) {
      residents = residents.slice(0, Math.min(residents.length, Number(memberCount)));
    }
  }

  if (residents.length === 0) {
    fail('No active boarding members found to receive discount.');
  }

  const allocations = divideDiscount(discountAmount, residents);
  const discountPerMember = round(discountAmount / residents.length);

  return {
    year: y,
    month: m,
    totalDiscount: discountAmount,
    memberCount: residents.length,
    discountPerMember,
    allocations,
  };
}

/**
 * Save or update the monthly discount for a month.
 */
async function saveMonthlyDiscount({ year, month, totalDiscount, reason = '', residentIds, memberCount, userId }) {
  const y = Number(year);
  const m = Number(month);
  if (!y || !m || m < 1 || m > 12) fail('Valid year and month are required.');

  const discountAmount = money(totalDiscount ?? 0, 'Total discount amount');

  let residents;
  if (Array.isArray(residentIds) && residentIds.length > 0) {
    residents = await Resident.find({ _id: { $in: residentIds } }).sort({ room_number: 1, name: 1 }).lean();
  } else {
    residents = await Resident.find({ status: 'active' }).sort({ room_number: 1, name: 1 }).lean();
    if (memberCount && Number(memberCount) > 0) {
      residents = residents.slice(0, Math.min(residents.length, Number(memberCount)));
    }
  }

  if (residents.length === 0) {
    fail('No active boarding members found to receive discount.');
  }

  const allocations = divideDiscount(discountAmount, residents);
  const discountPerMember = round(discountAmount / residents.length);

  const updatedDoc = await MonthlyDiscount.findOneAndUpdate(
    { year: y, month: m },
    {
      $set: {
        total_discount: discountAmount,
        reason: String(reason || '').trim(),
        allocations,
        updated_by: userId,
      },
      $setOnInsert: {
        year: y,
        month: m,
        created_by: userId,
      },
    },
    { upsert: true, new: true, runValidators: true }
  ).lean();

  return {
    id: updatedDoc._id,
    year: updatedDoc.year,
    month: updatedDoc.month,
    totalDiscount: updatedDoc.total_discount,
    reason: updatedDoc.reason,
    isConfigured: true,
    memberCount: allocations.length,
    discountPerMember,
    allocations: updatedDoc.allocations,
    updatedAt: updatedDoc.updatedAt,
  };
}

/**
 * Delete / reset monthly discount.
 */
async function deleteMonthlyDiscount(year, month) {
  const y = Number(year);
  const m = Number(month);
  const result = await MonthlyDiscount.findOneAndDelete({ year: y, month: m });
  return { success: true, deleted: Boolean(result) };
}

/**
 * List all saved discounts organized by month.
 */
async function listAllDiscounts() {
  const discounts = await MonthlyDiscount.find().sort({ year: -1, month: -1 }).lean();
  return discounts.map(d => ({
    id: d._id,
    year: d.year,
    month: d.month,
    monthLabel: `${d.year}-${String(d.month).padStart(2, '0')}`,
    totalDiscount: d.total_discount,
    reason: d.reason || '',
    memberCount: d.allocations?.length || 0,
    discountPerMember: d.allocations?.length ? round(d.total_discount / d.allocations.length) : 0,
    allocations: d.allocations || [],
    updatedAt: d.updatedAt,
  }));
}

module.exports = {
  divideDiscount,
  getMonthlyDiscount,
  previewDiscount,
  saveMonthlyDiscount,
  deleteMonthlyDiscount,
  listAllDiscounts,
};
