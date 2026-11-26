const Notification = require('../models/Notification');
const notificationService = require('../services/notificationService');
const { getDashboard } = require('../services/dashboardService');
const { getBillDetails } = require('../services/billService');
const { objectId } = require('../utils/validation');

exports.list = async (request, response) => {
  const filter = request.query.billId ? { bill_id: objectId(request.query.billId, 'Bill ID') } : {};
  return response.json(await Notification.find(filter).sort({ createdAt: -1 }));
};
exports.send = async (request, response) => {
  const billId = request.params.id || request.body.bill_id;
  const { bill } = await getBillDetails(billId);
  await notificationService.sendBill(billId, request.body.resident_id);
  return response.json(await getDashboard(`${bill.year}-${String(bill.month).padStart(2, '0')}`));
};

