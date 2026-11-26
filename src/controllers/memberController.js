const memberDashboardService = require('../services/memberDashboardService');
const Payment = require('../models/Payment');
const Resident = require('../models/Resident');
const User = require('../models/User');
const { fail, objectId } = require('../utils/validation');

exports.getMyDashboard = async (request, response) => {
  let residentId = request.auth?.residentId;

  if (!residentId && request.auth?.id) {
    const user = await User.findById(request.auth.id).lean();
    if (user?.resident_id) {
      residentId = user.resident_id;
    } else if (user) {
      const match = await Resident.findOne({
        $or: [
          ...(user.email ? [{ email: user.email.toLowerCase() }] : []),
          ...(user.name ? [{ name: new RegExp(`^${user.name}$`, 'i') }] : []),
        ],
      }).lean();
      if (match) residentId = match._id;
    }
  }

  if (!residentId && request.auth?.role === 'admin') {
    // Admin can preview specific member via query parameter
    if (request.query.memberId) {
      residentId = request.query.memberId;
    } else {
      const firstRes = await Resident.findOne({ status: 'active' });
      if (firstRes) residentId = firstRes._id;
    }
  }

  if (!residentId) {
    fail('No associated member profile found for this account.', 404);
  }

  const now = new Date();
  const year = Number(request.query.year || now.getFullYear());
  const month = Number(request.query.month || now.getMonth() + 1);

  const dashboard = await memberDashboardService.getMemberDashboard(residentId, year, month);
  return response.json(dashboard);
};

exports.getMyReceipt = async (request, response) => {
  objectId(request.params.id, 'Payment ID');
  const payment = await Payment.findById(request.params.id)
    .populate('resident_id', 'name room_number phone_number email')
    .lean();

  if (!payment) fail('Payment receipt not found.', 404);

  // Security check: If member, must own this receipt
  if (request.auth?.role === 'member' && String(payment.resident_id?._id) !== String(request.auth.residentId)) {
    fail('You do not have permission to view this receipt.', 403);
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
  });
};
