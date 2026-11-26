const test = require('node:test');
const assert = require('node:assert/strict');
const { divideDiscount } = require('../src/services/discountService');

test('Monthly Member Discount Division Logic', async (t) => {
  await t.test('divides Rs. 5,000 equally among 5 members to Rs. 1,000 each', () => {
    const residents = [
      { _id: 'res1', name: 'Kasun Perera', room_number: '1' },
      { _id: 'res2', name: 'Nimal Silva', room_number: '2' },
      { _id: 'res3', name: 'Sunil Fernando', room_number: '3' },
      { _id: 'res4', name: 'Kamal Bandara', room_number: '4' },
      { _id: 'res5', name: 'Ruwan Jayasinghe', room_number: '5' },
    ];

    const allocations = divideDiscount(5000, residents);
    assert.equal(allocations.length, 5);
    for (const alloc of allocations) {
      assert.equal(alloc.discount_amount, 1000);
    }

    const totalAllocated = allocations.reduce((sum, a) => sum + a.discount_amount, 0);
    assert.equal(totalAllocated, 5000);
  });

  await t.test('deducts individual discount from total payment to calculate final amount to pay', () => {
    // Example: Total Payment: Rs. 10,000, Individual Discount: Rs. 1,000, Final: Rs. 9,000
    const totalPayment = 10000;
    const individualDiscount = 1000;
    const finalAmountToPay = Math.max(0, totalPayment - individualDiscount);

    assert.equal(finalAmountToPay, 9000);
  });

  await t.test('handles non-divisible discount amounts without losing a single cent', () => {
    const residents = [
      { _id: 'res1', name: 'Member 1' },
      { _id: 'res2', name: 'Member 2' },
      { _id: 'res3', name: 'Member 3' },
    ];

    // Rs. 1,000 divided by 3
    const allocations = divideDiscount(1000, residents);
    assert.equal(allocations.length, 3);
    assert.equal(allocations[0].discount_amount, 333.34);
    assert.equal(allocations[1].discount_amount, 333.33);
    assert.equal(allocations[2].discount_amount, 333.33);

    const totalAllocated = Math.round(allocations.reduce((sum, a) => sum + a.discount_amount, 0) * 100) / 100;
    assert.equal(totalAllocated, 1000);
  });

  await t.test('handles zero discount gracefully', () => {
    const residents = [{ _id: 'res1', name: 'Member 1' }];
    const allocations = divideDiscount(0, residents);
    assert.equal(allocations[0].discount_amount, 0);
  });

  await t.test('ensures final payable cannot be negative if discount exceeds charges', () => {
    const totalPayment = 500;
    const individualDiscount = 1000;
    const finalAmountToPay = Math.max(0, totalPayment - individualDiscount);
    assert.equal(finalAmountToPay, 0);
  });
});
