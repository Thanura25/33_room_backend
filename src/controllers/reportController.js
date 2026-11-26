const reportService = require('../services/reportService');
const { fail } = require('../utils/validation');

exports.getReport = async (request, response) => {
  const { type, year, month, memberId, category } = request.query;
  if (!type) fail('Report type is required.');
  const y = Number(year || new Date().getFullYear());
  const m = month ? Number(month) : null;

  const result = await reportService.generateReport({
    type,
    year: y,
    month: m,
    memberId,
    category,
  });

  return response.json(result);
};
