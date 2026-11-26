const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const app = require('../src/app');

process.env.JWT_SECRET = 'financial-test-secret-key-33room';
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.WHATSAPP_ENABLED = 'false';

const databaseName = `room33_test_fin_${randomUUID().replaceAll('-', '')}`;
let server;
let baseUrl;
let adminToken;
let memberToken;
let residentA;
let residentB;

before(async () => {
  await mongoose.connect(process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017', {
    dbName: databaseName,
    serverSelectionTimeoutMS: 5000,
  });
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (mongoose.connection.readyState === 1 && mongoose.connection.name === databaseName) {
    await mongoose.connection.dropDatabase();
  }
  await mongoose.disconnect();
});

async function api(path, method = 'GET', body, token, expected = 200) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  assert.equal(response.status, expected, `${method} ${path} returned ${response.status}: ${JSON.stringify(data)}`);
  return data;
}

test('Monthly Bill Management & Financial Module Complete Workflow', async (t) => {
  // 1. Setup Admin
  const adminRes = await api('/auth/register', 'POST', {
    name: 'Boarding Admin',
    email: 'admin@boarding.test',
    password: 'admin-password-123',
  }, null, 201);
  const loginRes = await api('/auth/login', 'POST', {
    email: 'admin@boarding.test',
    password: 'admin-password-123',
  });
  adminToken = loginRes.token;

  // 2. Add Boarding Members
  residentA = await api('/residents', 'POST', {
    name: 'Alice Perera',
    phone_number: '0771112233',
    room_number: '101',
    email: 'alice@boarding.test',
    password: 'alice-password-123',
  }, adminToken, 201);

  residentB = await api('/residents', 'POST', {
    name: 'Bob Fernando',
    phone_number: '0774445566',
    room_number: '102',
    email: 'bob@boarding.test',
    password: 'bob-password-123',
  }, adminToken, 201);

  // 3. Test member login
  const memberLogin = await api('/auth/login', 'POST', {
    email: 'alice@boarding.test',
    password: 'alice-password-123',
  });
  assert.equal(memberLogin.user.role, 'member');
  assert.equal(memberLogin.user.name, 'Alice Perera');
  memberToken = memberLogin.token;

  // 4. Test categories list
  const categories = await api('/category-bills/categories', 'GET', null, adminToken);
  assert.equal(categories.length, 5);
  const codes = categories.map(c => c.code);
  assert.deepEqual(codes, ['electricity', 'water', 'telecom', 'restaurant', 'other']);

  await t.test('create and distribute category bills (Electricity & Restaurant)', async () => {
    // Create Electricity Bill: Rs. 15,000 for month 11/2026
    const elecBill = await api('/category-bills', 'POST', {
      month: 11,
      year: 2026,
      category: 'electricity',
      totalAmount: 15000,
      description: 'Main house CEB power bill',
    }, adminToken, 201);
    assert.equal(elecBill.total_amount, 15000);
    assert.equal(elecBill.is_distributed, false);

    // Preview distribution for 2 members
    const preview = await api('/category-bills/preview-distribution', 'POST', {
      billId: elecBill._id,
      residentIds: [residentA._id, residentB._id],
    }, adminToken);
    assert.equal(preview.memberCount, 2);
    assert.equal(preview.preview[0].amount, 7500);
    assert.equal(preview.preview[1].amount, 7500);

    // Distribute Electricity Bill
    const distResult = await api('/category-bills/distribute', 'POST', {
      billId: elecBill._id,
      residentIds: [residentA._id, residentB._id],
      sendWhatsApp: true,
    }, adminToken);
    assert.equal(distResult.bill.is_distributed, true);
    assert.equal(distResult.participants.length, 2);

    // Prevent duplicate distribution
    await api('/category-bills/distribute', 'POST', {
      billId: elecBill._id,
      residentIds: [residentA._id, residentB._id],
    }, adminToken, 409);

    // Create Restaurant Bill: Rs. 4,000 for month 11/2026, distributed only to Alice
    const restBill = await api('/category-bills', 'POST', {
      month: 11,
      year: 2026,
      category: 'restaurant',
      totalAmount: 4000,
      description: 'Shared catering dinner',
    }, adminToken, 201);

    await api('/category-bills/distribute', 'POST', {
      billId: restBill._id,
      residentIds: [residentA._id],
    }, adminToken);
  });

  await t.test('financial summary balances calculation', async () => {
    const balances = await api('/financial/balances?year=2026&month=11', 'GET', null, adminToken);
    assert.equal(balances.length, 2);

    const alice = balances.find(b => b.residentId === String(residentA._id));
    const bob = balances.find(b => b.residentId === String(residentB._id));

    // Alice: Electricity 7,500 + Restaurant 4,000 = 11,500
    assert.equal(alice.charges.electricity, 7500);
    assert.equal(alice.charges.restaurant, 4000);
    assert.equal(alice.totalNewCharges, 11500);
    assert.equal(alice.totalAmountDue, 11500);
    assert.equal(alice.totalPaidAmount, 0);
    assert.equal(alice.remainingBalance, 11500);
    assert.equal(alice.paymentStatus, 'Unpaid');

    // Bob: Electricity 7,500, no restaurant charges
    assert.equal(bob.charges.electricity, 7500);
    assert.equal(bob.charges.restaurant, 0);
    assert.equal(bob.totalNewCharges, 7500);
    assert.equal(bob.totalAmountDue, 7500);
    assert.equal(bob.remainingBalance, 7500);
  });

  let receiptId;
  await t.test('record partial and full payments with receipt generation', async () => {
    // Alice pays partial Rs. 5,000
    const pay1 = await api('/financial/payments', 'POST', {
      residentId: residentA._id,
      month: 11,
      year: 2026,
      amount: 5000,
      method: 'bank_transfer',
      reference: 'TXN-998877',
      notes: 'Initial partial payment',
    }, adminToken, 201);

    assert.ok(pay1.payment.receiptNumber.startsWith('RCP-202611-'));
    assert.equal(pay1.payment.remainingBalance, 6500);
    assert.equal(pay1.payment.paymentStatus, 'Partially Paid');
    receiptId = pay1.payment.id;

    // View receipt
    const receipt = await api(`/financial/receipts/${receiptId}`, 'GET', null, adminToken);
    assert.equal(receipt.amount, 5000);
    assert.equal(receipt.memberName, 'Alice Perera');
    assert.equal(receipt.remainingBalance, 6500);

    // Alice pays remaining Rs. 6,500
    const pay2 = await api('/financial/payments', 'POST', {
      residentId: residentA._id,
      month: 11,
      year: 2026,
      amount: 6500,
      method: 'cash',
      notes: 'Settled full balance',
    }, adminToken, 201);

    assert.equal(pay2.payment.remainingBalance, 0);
    assert.equal(pay2.payment.paymentStatus, 'Paid');

    // Check balances again
    const updatedBalances = await api('/financial/balances?year=2026&month=11', 'GET', null, adminToken);
    const updatedAlice = updatedBalances.find(b => b.residentId === String(residentA._id));
    assert.equal(updatedAlice.totalPaidAmount, 11500);
    assert.equal(updatedAlice.remainingBalance, 0);
    assert.equal(updatedAlice.paymentStatus, 'Paid');
  });

  await t.test('Member Dashboard access and security isolation', async () => {
    // Alice accesses her dashboard
    const aliceDashboard = await api('/member/dashboard?year=2026&month=11', 'GET', null, memberToken);
    assert.equal(aliceDashboard.member.name, 'Alice Perera');
    assert.equal(aliceDashboard.summary.currentMonthTotalBill, 11500);
    assert.equal(aliceDashboard.summary.totalPaid, 11500);
    assert.equal(aliceDashboard.summary.remainingBalance, 0);
    assert.equal(aliceDashboard.paymentHistory.length, 2);

    // Alice can view her own receipt
    const myReceipt = await api(`/member/receipts/${receiptId}`, 'GET', null, memberToken);
    assert.equal(myReceipt.memberName, 'Alice Perera');

    // Alice cannot access admin balances or bill management
    await api('/financial/balances?year=2026&month=11', 'GET', null, memberToken, 403);
    await api('/category-bills', 'POST', {
      month: 11,
      year: 2026,
      category: 'telecom',
      totalAmount: 1000,
    }, memberToken, 403);
  });

  await t.test('Monthly Reports generation', async () => {
    // 1. Monthly bills report
    const billsReport = await api('/reports?type=monthly_bills&year=2026&month=11', 'GET', null, adminToken);
    assert.equal(billsReport.data.length, 2);
    assert.equal(billsReport.summary.totalBills, 2);

    // 2. Category expenses report
    const catReport = await api('/reports?type=category_expenses&year=2026&month=11', 'GET', null, adminToken);
    assert.ok(catReport.data.length >= 5);
    const elecEntry = catReport.data.find(d => d.category === 'Electricity Bill');
    assert.equal(elecEntry.totalAmount, 15000);

    // 3. Payment collections report
    const collectionsReport = await api('/reports?type=payment_collections&year=2026&month=11', 'GET', null, adminToken);
    assert.equal(collectionsReport.data.length, 2);
    assert.equal(collectionsReport.summary.totalCollected, 11500);

    // 4. Outstanding balances report
    const outReport = await api('/reports?type=outstanding_balances&year=2026&month=11', 'GET', null, adminToken);
    assert.equal(outReport.data.length, 2);
  });
});
