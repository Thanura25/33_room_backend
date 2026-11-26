const test = require('node:test');
const assert = require('node:assert/strict');
const { divideDiscount } = require('../src/services/discountService');

test('Monthly Member Discount Full Math & Scenario Tests', async (t) => {
  await t.test('User Scenario: Rs. 5,000 discount with 5 members, Rs. 10,000 total payment', () => {
    const residents = [
      { _id: '1', name: 'Member 1', room_number: '1' },
      { _id: '2', name: 'Member 2', room_number: '2' },
      { _id: '3', name: 'Member 3', room_number: '3' },
      { _id: '4', name: 'Member 4', room_number: '4' },
      { _id: '5', name: 'Member 5', room_number: '5' },
    ];

    // Total Discount: Rs. 5,000
    const allocations = divideDiscount(5000, residents);

    // Each member gets Rs. 1,000
    assert.equal(allocations.length, 5);
    for (const alloc of allocations) {
      assert.equal(alloc.discount_amount, 1000);

      // Total Payment: Rs. 10,000
      const totalPayment = 10000;
      // Individual Discount: Rs. 1,000
      const individualDiscount = alloc.discount_amount;
      // Final Amount to Pay: Rs. 9,000
      const finalPayable = Math.max(0, totalPayment - individualDiscount);

      assert.equal(finalPayable, 9000);

      // Remaining balance after paying final amount
      const paidAmount = 9000;
      const remainingBalance = Math.max(0, finalPayable - paidAmount);
      assert.equal(remainingBalance, 0);
    }
  });

  await t.test('Arbitrary discount amounts: e.g. Rs. 7,350 for 4 members', () => {
    const residents = [
      { _id: '1', name: 'Member A' },
      { _id: '2', name: 'Member B' },
      { _id: '3', name: 'Member C' },
      { _id: '4', name: 'Member D' },
    ];

    const allocations = divideDiscount(7350, residents);
    assert.equal(allocations.length, 4);
    // 7350 / 4 = 1837.50 exactly
    for (const alloc of allocations) {
      assert.equal(alloc.discount_amount, 1837.50);
    }
    const sum = allocations.reduce((s, a) => s + a.discount_amount, 0);
    assert.equal(sum, 7350);
  });
});
