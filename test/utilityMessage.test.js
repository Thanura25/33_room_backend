const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createUtilityBillMessage, utilityBillTemplate } = require('../src/utils/utilityBillMessage');
const { billMessage, getDeliveryConfig } = require('../src/services/notificationService');
const { previousArrearsByResident, previousArrearsByRow, receiptTotals } = require('../src/services/arrearsService');

test('utility message preserves the exact emoji, bold and newline layout', () => {
  const notice = createUtilityBillMessage({ monthLabel: 'September 2026', electricity: 3500, water: 6500, memberCount: 2, share: 5000, previousArrears: 1200, dueDate: '2026-09-30' });
  assert.equal(notice.message, [
    '🏠 *Monthly Utility Bill – September / 2026*',
    '⚡ *Electricity Bill:* Rs. 3,500.00',
    '💧 *Water Bill:* Rs. 6,500.00',
    '👥 *Total Members:* 2',
    '💰 *Current Month Total:*',
    'Rs. 10,000.00',
    '👤 *Amount per Person:*',
    'Rs. 5,000.00',
    '📌 *Previous Outstanding Payments:*',
    '🔸 *Total Previous Arrears:* Rs. 1,200.00',
    '━━━━━━━━━━━━━━',
    '✅ *FINAL TOTAL TO PAY:*',
    '*Rs. 6,200.00*',
    '━━━━━━━━━━━━━━',
    'Please make the payment for *September / 2026* before *2026-09-30*.',
    'Thank you! 🙏',
  ].join('\n'));
  assert.equal(notice.template_parameters.length, 10);
  assert.equal(notice.message_version, 2);
  assert.equal(utilityBillTemplate.body.replace(/\{\{(\d+)\}\}/g, (_, n) => notice.template_parameters[Number(n) - 1]), notice.message);
  assert.ok(notice.template_parameters.every(value => !/[\n\r\t]/.test(value)));
});

test('preview and server use the same saved share, arrears, credit, adjustment and receipts', () => {
  const notice = billMessage({ year: 2026, month: 9, electricity: 90, water: 20, sharedCredit: 10, dueDate: new Date('2026-09-30'), participants: [{}, {}, {}] }, { amount: 33.34, previous_balance: 20.01, manual_adjustment: -1.05, paid_amount: 10 });
  assert.equal(notice.template_parameters[4], '110.00');
  assert.equal(notice.template_parameters[5], '33.34 (after Rs. 10.00 total shared credit)');
  assert.equal(notice.template_parameters[6], '20.01');
  assert.equal(notice.template_parameters[7], '42.30 (-Rs. 1.05 adjustment; Rs. 10.00 already paid)');
  assert.equal(createUtilityBillMessage({ monthLabel: 'September 2026', electricity: 10, water: 0, memberCount: 1, share: 10, paidAmount: 10 }).template_parameters[7], '0.00 (Rs. 10.00 already paid)');
});

test('automatic arrears exclude future bills and never add carried balances twice', () => {
  const bills = [{ _id: 'jan', year: 2027, month: 1 }, { _id: 'nov', year: 2026, month: 11 }, { _id: 'dec', year: 2026, month: 12 }];
  const rows = [
    { _id: 'r3', bill_id: 'jan', resident_id: { _id: 'a' }, amount: 100, previous_balance: 50, paid_amount: 0 },
    { _id: 'r1', bill_id: 'nov', resident_id: 'a', amount: 100, paid_amount: 0 },
    { _id: 'r2', bill_id: 'dec', resident_id: 'a', amount: 100, previous_balance: 100, paid_amount: 150 },
    { _id: 'other', bill_id: 'nov', resident_id: 'b', amount: 75, paid_amount: 25 },
  ];
  const receipts = new Map();
  assert.equal(previousArrearsByResident(bills, rows, receipts, { year: 2027, month: 1 }).get('a'), 50);
  assert.equal(previousArrearsByResident(bills, rows, receipts, { year: 2026, month: 12 }).get('a'), 100);
  assert.equal(previousArrearsByResident(bills, rows, receipts, { year: 2027, month: 1 }).get('b'), 50);
  const byRow = previousArrearsByRow(bills, rows, receipts);
  assert.equal(byRow.get('r1'), 0);
  assert.equal(byRow.get('r2'), 100);
  assert.equal(byRow.get('r3'), 50);
  const legacyReceipts = receiptTotals([{ resident_bill_id: 'r2', amount: 33.33 }, { resident_bill_id: 'r2', amount: 16.67 }]);
  assert.equal(previousArrearsByResident(bills, rows, legacyReceipts, { year: 2027, month: 1 }).get('a'), 0);
});

test('an old approved template cannot receive the new ten-parameter message', () => {
  const keys = ['WHATSAPP_ENABLED', 'WHATSAPP_SENDER_PHONE_NUMBER', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_API_VERSION', 'WHATSAPP_TEMPLATE_NAME', 'WHATSAPP_TEMPLATE_LANGUAGE', 'WHATSAPP_TEMPLATE_VERSION'];
  const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, { WHATSAPP_ENABLED: 'true', WHATSAPP_SENDER_PHONE_NUMBER: '+94700000001', WHATSAPP_ACCESS_TOKEN: 'test', WHATSAPP_PHONE_NUMBER_ID: '12345', WHATSAPP_API_VERSION: 'v22.0', WHATSAPP_TEMPLATE_NAME: 'test', WHATSAPP_TEMPLATE_LANGUAGE: 'en' });
    delete process.env.WHATSAPP_TEMPLATE_VERSION;
    assert.equal(getDeliveryConfig().ready, false);
    process.env.WHATSAPP_TEMPLATE_VERSION = '2';
    assert.equal(getDeliveryConfig().ready, true);
  } finally {
    for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
});
