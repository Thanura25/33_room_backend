const billCategoryService = require('../services/billCategoryService');
const CategoryBill = require('../models/CategoryBill');
const { fail, objectId } = require('../utils/validation');

exports.getCategories = (_request, response) => {
  return response.json(billCategoryService.getCategories());
};

exports.getMonthBills = async (request, response) => {
  const { year, month } = request.query;
  if (!year || !month) fail('Year and month are required.');
  const bills = await billCategoryService.getMonthCategoryBills(year, month);
  return response.json(bills);
};

exports.createBill = async (request, response) => {
  const { month, year, category, totalAmount, description, documentUrl, documentName } = request.body;
  const bill = await billCategoryService.createCategoryBill({
    month,
    year,
    category,
    totalAmount,
    description,
    documentUrl,
    documentName,
    createdBy: request.auth?.id,
  });
  return response.status(201).json(bill);
};

exports.previewDistribution = async (request, response) => {
  const { billId, residentIds } = request.body;
  const preview = await billCategoryService.previewDistribution({ billId, residentIds });
  return response.json(preview);
};

exports.distributeBill = async (request, response) => {
  const { billId, residentIds, sendWhatsApp } = request.body;
  const result = await billCategoryService.distributeBill({
    billId,
    residentIds,
    sendWhatsApp: sendWhatsApp !== false,
    distributedBy: request.auth?.id,
  });
  return response.json(result);
};

exports.deleteBill = async (request, response) => {
  objectId(request.params.id, 'Bill ID');
  const bill = await CategoryBill.findById(request.params.id);
  if (!bill) fail('Bill not found.', 404);
  if (bill.is_distributed) fail('Distributed bills cannot be deleted to preserve financial audit integrity.', 400);
  await CategoryBill.findByIdAndDelete(request.params.id);
  return response.json({ message: 'Bill removed successfully.' });
};
