const discountService = require('../services/discountService');

exports.getDiscount = async (req, res) => {
  const { year, month } = req.query;
  if (year && month) {
    const data = await discountService.getMonthlyDiscount(Number(year), Number(month));
    return res.json(data);
  }
  const allDiscounts = await discountService.listAllDiscounts();
  return res.json(allDiscounts);
};

exports.previewDiscount = async (req, res) => {
  const { year, month, totalDiscount, residentIds, memberCount } = req.body;
  const result = await discountService.previewDiscount({
    year,
    month,
    totalDiscount,
    residentIds,
    memberCount,
  });
  return res.json(result);
};

exports.saveDiscount = async (req, res) => {
  const { year, month, totalDiscount, reason, residentIds, memberCount } = req.body;
  const result = await discountService.saveMonthlyDiscount({
    year,
    month,
    totalDiscount,
    reason,
    residentIds,
    memberCount,
    userId: req.auth?.id,
  });
  return res.status(200).json(result);
};

exports.deleteDiscount = async (req, res) => {
  const { year, month } = req.query;
  const result = await discountService.deleteMonthlyDiscount(Number(year), Number(month));
  return res.json(result);
};
