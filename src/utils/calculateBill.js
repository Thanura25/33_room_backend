function splitBill(totalAmount, residentIds) {
  if (!Array.isArray(residentIds) || !residentIds.length) throw new Error('Select at least one resident.');
  if (new Set(residentIds.map(String)).size !== residentIds.length) throw new Error('Residents must be unique.');
  if (!Number.isFinite(totalAmount) || totalAmount < 0 || !Number.isSafeInteger(Math.round(totalAmount * 100))) throw new Error('Invalid bill amount.');
  const cents = Math.round(Number(totalAmount) * 100);
  const base = Math.floor(cents / residentIds.length);
  const remainder = cents % residentIds.length;

  return residentIds.map((residentId, index) => ({
    resident_id: residentId,
    amount: (base + (index < remainder ? 1 : 0)) / 100,
  }));
}

module.exports = { splitBill };
