const billService = require('../services/billService');
const notificationService = require('../services/notificationService');
const { getDashboard } = require('../services/dashboardService');
const { fail } = require('../utils/validation');

exports.create = async (request, response) => response.status(201).json(await billService.createMonthlyBill(request.body));
exports.details = async (request, response) => response.json(await billService.getBillDetails(request.params.id));
exports.dashboard = async (request, response) => response.json(await getDashboard(request.query.month));
exports.save = async (request, response) => {
  if (request.body.sendNotifications != null && typeof request.body.sendNotifications !== 'boolean') fail('sendNotifications must be true or false.');
  const bill = await billService.saveMonthlyBill(request.params.month, request.body);
  let notificationError = '';
  try {
    if (request.body.sendNotifications) await notificationService.sendBill(bill.id);
    else await notificationService.queueBill(bill.id);
  } catch (error) {
    notificationError = error.code === 'WHATSAPP_SETUP' ? `The bill is saved. ${error.message}` : 'The bill is saved, but message processing was interrupted. Use Send pending messages to continue.';
  }
  return response.json({ ...await getDashboard(request.params.month), notificationError });
};

