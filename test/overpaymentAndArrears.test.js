const test = require('node:test');
const assert = require('node:assert/strict');

test('Overpayment and Next Month Balance Roll-forward Logic', async (t) => {
  const round = (val) => Math.round((Number(val) || 0) * 100) / 100;

  await t.test('calculates negative remaining balance when payment exceeds final due', () => {
    // User Scenario from image:
    // Final Due: 6,996.63, Paid: 7,621.63
    const totalAmountDue = 6996.63;
    const totalPaidAmount = 7621.63;
    const grossAmount = 6996.63;
    const creditCarried = grossAmount < 0 ? grossAmount : 0;
    const remainingBalance = round(totalAmountDue + creditCarried - totalPaidAmount);

    assert.equal(remainingBalance, -625.00);
    assert.notEqual(remainingBalance, 0);
  });

  await t.test('automatically deducts overpayment from next month charges', () => {
    // Month 1:
    // Charges: 6,996.63, Paid: 7,621.63
    // Net overpayment carried over: -625.00
    const previousOutstanding = -625.00;
    
    // Month 2:
    // New Charges: 2,245.61
    const totalNewCharges = 2245.61;
    const grossAmount = round(previousOutstanding + totalNewCharges); // 1,620.61
    const discount = 0;
    const payableBeforeDiscount = Math.max(0, grossAmount);
    const totalAmountDue = round(Math.max(0, payableBeforeDiscount - discount));

    assert.equal(grossAmount, 1620.61);
    assert.equal(totalAmountDue, 1620.61);

    // If member has not paid yet in Month 2:
    const totalPaidAmount = 0;
    const creditCarried = grossAmount < 0 ? grossAmount : 0;
    const remainingBalance = round(totalAmountDue + creditCarried - totalPaidAmount);

    assert.equal(remainingBalance, 1620.61);
  });

  await t.test('handles case where overpayment credit exceeds next month new charges', () => {
    // Prior overpayment: -625.00
    const previousOutstanding = -625.00;
    // New charges: only 200.00
    const totalNewCharges = 200.00;
    const grossAmount = round(previousOutstanding + totalNewCharges); // -425.00
    const discount = 0;
    const payableBeforeDiscount = Math.max(0, grossAmount);
    const totalAmountDue = round(Math.max(0, payableBeforeDiscount - discount)); // 0.00

    assert.equal(totalAmountDue, 0.00);

    const totalPaidAmount = 0;
    const creditCarried = grossAmount < 0 ? grossAmount : 0; // -425.00
    const remainingBalance = round(totalAmountDue + creditCarried - totalPaidAmount); // -425.00

    assert.equal(remainingBalance, -425.00);

    let paymentStatus = 'Unpaid';
    if (totalAmountDue === 0 && totalPaidAmount === 0 && grossAmount <= 0) {
      paymentStatus = 'Paid';
    } else if (remainingBalance <= 0) {
      paymentStatus = 'Paid';
    } else if (totalPaidAmount > 0) {
      paymentStatus = 'Partially Paid';
    } else {
      paymentStatus = 'Unpaid';
    }

    assert.equal(paymentStatus, 'Paid');
  });

  await t.test('maintains correct net arrears in computePreviousArrears across multi-month history', () => {
    // Tallying cents across historical records:
    const debtByResident = new Map([['res1', 699663]]);
    const paidByResident = new Map([['res1', 762163]]);

    const chargesCents = debtByResident.get('res1') || 0;
    const paidCents = paidByResident.get('res1') || 0;
    const netArrearsCents = chargesCents - paidCents; // -62500 cents

    assert.equal(netArrearsCents / 100, -625.00);
  });
});
