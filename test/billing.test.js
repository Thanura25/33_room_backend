const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const { splitBill } = require('../src/utils/calculateBill');
const { money, phone, monthParts } = require('../src/utils/validation');

process.env.JWT_SECRET = 'isolated-test-secret-not-for-production';
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.WHATSAPP_ENABLED = 'false';
const app = require('../src/app');
const Notification = require('../src/models/Notification');
const ResidentBill = require('../src/models/ResidentBill');
const { sendBill, queueBill } = require('../src/services/notificationService');
const nativeFetch = global.fetch;
const databaseName = `room33_test_${randomUUID().replaceAll('-', '')}`;
let server;
let baseUrl;
let token;

before(async () => {
  await mongoose.connect(process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017', { dbName: databaseName, serverSelectionTimeoutMS:5000 });
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(async () => {
  global.fetch = nativeFetch;
  if (server) await new Promise(resolve => server.close(resolve));
  if (mongoose.connection.readyState === 1 && mongoose.connection.name === databaseName && databaseName.startsWith('room33_test_')) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
});

async function api(path, method = 'GET', body, expected = 200, authenticated = true) {
  const response = await nativeFetch(`${baseUrl}${path}`, {
    method, headers: { 'Content-Type': 'application/json', ...(token && authenticated ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`);
  return result;
}

test('money and recipient validation', () => {
  assert.deepEqual(splitBill(100, ['a', 'b', 'c']).map(row => row.amount), [33.34, 33.33, 33.33]);
  assert.deepEqual(splitBill(0.01, ['a', 'b', 'c']).map(row => row.amount), [0.01, 0, 0]);
  assert.throws(() => splitBill(1, []));
  assert.throws(() => splitBill(1, ['a', 'a']));
  assert.throws(() => money(-2));
  assert.throws(() => money('1.001'));
  assert.throws(() => money(true));
  assert.throws(() => monthParts('2026-13'));
  assert.equal(phone('077 123 4567'), '+94771234567');
  assert.equal(phone('+94 77 123 4567'), '+94771234567');
  assert.throws(() => phone('123'));
});

test('complete monthly billing, payments and WhatsApp workflow', async t => {
  await api('/dashboard?month=2026-09', 'GET', null, 401);
  assert.equal((await api('/auth/setup')).needsSetup, true);
  const credentials = { name: 'Test Admin', email: 'admin@example.test', password: 'test-password-123' };
  await api('/auth/register', 'POST', credentials, 201);
  assert.equal((await api('/auth/setup')).needsSetup, false);
  await api('/auth/register', 'POST', credentials, 403);
  token = (await api('/auth/login', 'POST', credentials)).token;
  assert.equal((await api('/dashboard?month=2026-09')).users.length, 0);
  await api('/dashboard?month=invalid', 'GET', null, 400);

  const residents = [];
  for (let index = 0; index < 4; index++) residents.push(await api('/residents', 'POST', {
    name: `Resident ${index + 1}`, phone_number: `077123450${index}`,
    room_number: `${index + 1}`, joined_date: '2026-01-01', status: index === 2 ? 'inactive' : 'active',
  }, 201));
  for (const number of ['0771234500', '077 123 4500', '+94 77 123 4500', '0094771234500']) {
    const duplicate = await api('/residents', 'POST', { name: 'Duplicate', phone_number: number }, 400);
    assert.equal(duplicate.field, 'phone_number');
    assert.equal(duplicate.message, 'This phone number is already assigned to another user.');
  }
  assert.equal((await api('/residents', 'POST', { name: 'No phone' }, 400)).field, 'phone_number');
  assert.equal((await api('/residents', 'POST', { name: 'Bad date', phone_number: '0772222222', joined_date: '2026-02-30' }, 400)).field, 'joined_date');
  assert.equal((await api('/residents', 'POST', { name: 'Bad stay', phone_number: '0772222222', joined_date: '2026-09-01', left_date: '2026-08-31' }, 400)).field, 'left_date');
  assert.equal((await api('/residents', 'POST', { name: 'Bad email', phone_number: '0772222222', email: 'invalid' }, 400)).field, 'email');

  const input = {
    electricity: '90.00', water: '20.00', sharedCredit: '10.00',
    dueDate: '2026-09-30', residentIds: residents.slice(0, 3).map(person => person._id), sendNotifications: true,
  };
  await api('/bills/2026-09', 'PUT', { ...input, residentIds: [] }, 400);
  await api('/bills/2026-09', 'PUT', { ...input, residentIds: [residents[0]._id, residents[0]._id] }, 400);
  await api('/bills/2026-09', 'PUT', { ...input, electricity: '-1' }, 400);
  await api('/bills/2026-09', 'PUT', { ...input, sharedCredit: '999' }, 400);
  await api('/bills/2026-09', 'PUT', { ...input, dueDate: '2026-02-30' }, 400);
  let dashboard = await api('/bills/2026-09', 'PUT', input);
  const billId = dashboard.bill.id;
  const firstRow = dashboard.allocations.find(row => row.userId === residents[0]._id);

  await t.test('only selected residents share the bill, including a selected inactive resident', () => {
    assert.equal(dashboard.allocations.length, 3);
    assert.equal(dashboard.summary.totalBill, 100);
    assert.equal(dashboard.summary.selectedUsers, 3);
    assert.equal(dashboard.allocations.reduce((sum, row) => sum + Math.round(row.shareAmount * 100), 0), 10000);
    assert.equal(dashboard.allocations.some(row => row.userId === residents[3]._id), false);
    assert.equal(dashboard.notifications.length, 3);
    assert.ok(dashboard.notifications.every(item => item.status === 'pending'));
    assert.match(dashboard.notifications[0].message, /September \/ 2026/);
    assert.ok(dashboard.notifications.every(item => item.phone.startsWith('+94')));
    assert.equal(dashboard.delivery.ready, false);
  });

  await t.test('payment and save retries preserve the same rows and amounts', async () => {
    const payment = { paidAmount: '10', paymentMethod: 'cash' };
    await api(`/allocations/${firstRow.id}/payment`, 'PATCH', { paidAmount: '1000' }, 400);
    await api(`/allocations/${firstRow.id}/payment`, 'PATCH', payment);
    dashboard = await api(`/allocations/${firstRow.id}/payment`, 'PATCH', payment);
    assert.equal(dashboard.summary.collected, 10);
    dashboard = await api('/bills/2026-09', 'PUT', input);
    assert.equal(dashboard.summary.collected, 10);
    assert.equal(dashboard.allocations.find(row => row.userId === residents[0]._id).id, firstRow.id);
    assert.equal(dashboard.notifications.length, 3);
    await api('/bills/2026-09', 'PUT', { ...input, electricity: '91' }, 409);
    assert.equal((await api('/dashboard?month=2026-10')).bill, null);
  });

  await t.test('an interrupted row initialization safely recovers without resetting payments', async () => {
    const unpaidRow = dashboard.allocations.find(row => row.userId === residents[1]._id);
    await ResidentBill.deleteOne({ _id: unpaidRow.id, paid_amount: 0 });
    dashboard = await api('/dashboard?month=2026-09');
    assert.equal(dashboard.allocations.length, 3);
    assert.equal(dashboard.summary.collected, 10);
  });

  await t.test('resident edits leave saved month and recipient snapshots intact', async () => {
    await api(`/residents/${residents[0]._id}`, 'PUT', { name: 'Changed name', phone_number: '0779999999', status: 'inactive' });
    dashboard = await api('/dashboard?month=2026-09');
    const row = dashboard.allocations.find(item => item.userId === residents[0]._id);
    assert.equal(row.fullName, 'Resident 1');
    assert.equal(row.phone, '+94771234500');
  });

  let calls = [];
  let failOne = true;
  await t.test('a different Meta sender cannot send or claim any saved notice', async () => {
    Object.assign(process.env, { WHATSAPP_ENABLED: 'true', WHATSAPP_SENDER_PHONE_NUMBER: '+94700000001', WHATSAPP_ACCESS_TOKEN: 'mock-wrong-sender-token', WHATSAPP_PHONE_NUMBER_ID: '12345', WHATSAPP_API_VERSION: 'v22.0', WHATSAPP_TEMPLATE_NAME: 'room33_monthly_utility_bill_v2', WHATSAPP_TEMPLATE_LANGUAGE: 'en', WHATSAPP_TEMPLATE_VERSION: '2' });
    global.fetch = async (_url, options) => {
      assert.equal(options.method, 'GET', 'a mismatched sender must never reach the message POST');
      return Response.json({ id: '12345', display_phone_number: '+94700000002' });
    };
    const result = await api(`/bills/${billId}/notifications`, 'POST', {}, 503);
    assert.match(result.message, /does not match/);
    dashboard = await api('/bills/2026-09', 'PUT', input);
    assert.match(dashboard.notificationError, /The bill is saved.*does not match/);
    assert.equal(dashboard.summary.collected, 10);
    assert.ok(dashboard.notifications.every(item => item.status === 'pending'));
    assert.equal(dashboard.delivery.senderPhoneNumber, '+94700000001');
    assert.equal(JSON.stringify(dashboard).includes('mock-wrong-sender-token'), false);
  });

  await t.test('WhatsApp acceptance and one recipient failure are stored independently', async () => {
    Object.assign(process.env, { WHATSAPP_ENABLED: 'true', WHATSAPP_SENDER_PHONE_NUMBER: '+94700000001', WHATSAPP_ACCESS_TOKEN: 'mock-token', WHATSAPP_PHONE_NUMBER_ID: '12345', WHATSAPP_API_VERSION: 'v22.0', WHATSAPP_TEMPLATE_NAME: 'room33_monthly_utility_bill_v2', WHATSAPP_TEMPLATE_LANGUAGE: 'en', WHATSAPP_TEMPLATE_VERSION: '2' });
    global.fetch = async (url, options) => {
      assert.ok(String(url).startsWith('https://graph.facebook.com/'));
      if (options.method === 'GET') return Response.json({ id: '12345', display_phone_number: '+94 70 000 0001' });
      assert.equal(String(url), 'https://graph.facebook.com/v22.0/12345/messages');
      const body = JSON.parse(options.body);
      calls.push(body);
      assert.equal(body.type, 'template');
      assert.equal(body.template.components[0].parameters.length, 10);
      assert.equal(body.template.components[0].parameters[0].text, 'September / 2026');
      if (body.to === '94771234501' && failOne) return new Response(JSON.stringify({ error: { message: 'Test recipient rejected' } }), { status: 400 });
      return new Response(JSON.stringify({ messages: [{ id: `mock-${body.to}` }] }), { status: 200 });
    };
    dashboard = await api(`/bills/${billId}/notifications`, 'POST', {});
    assert.equal(calls.length, 3);
    assert.equal(dashboard.notifications.filter(item => item.status === 'sent').length, 2);
    assert.equal(dashboard.notifications.filter(item => item.status === 'failed').length, 1);
  });

  await t.test('concurrent retries send only the failed recipient once', async () => {
    failOne = false;
    await Promise.all([sendBill(billId), sendBill(billId)]);
    assert.equal(calls.length, 4);
    assert.equal(await Notification.countDocuments({ bill_id: billId, status: 'sent' }), 3);
    await sendBill(billId);
    assert.equal(calls.length, 4);
  });

  await t.test('unknown delivery is not automatically retried', async () => {
    process.env.WHATSAPP_ENABLED = 'false';
    const next = await api('/bills/2026-10', 'PUT', { ...input, residentIds: [residents[1]._id] });
    process.env.WHATSAPP_ENABLED = 'true';
    let attempts = 0;
    global.fetch = async () => { attempts++; throw new Error('Simulated timeout'); };
    await sendBill(next.bill.id);
    await sendBill(next.bill.id);
    assert.equal(attempts, 1);
    assert.equal((await Notification.findOne({ bill_id: next.bill.id })).status, 'unknown');
  });

  await t.test('arrears, payment totals and pending notices stay aligned across months', async () => {
    process.env.WHATSAPP_ENABLED = 'false';
    const nextInput = { electricity: '100', water: '0', sharedCredit: '0', dueDate: '2027-01-31', residentIds: [residents[3]._id], sendNotifications: false };
    await api('/bills/2026-11', 'PUT', nextInput);
    const december = await api('/bills/2026-12', 'PUT', nextInput);
    assert.equal(december.allocations[0].previousBalance, 100);
    assert.equal(december.allocations[0].payableAmount, 200);
    await api('/allocations/' + december.allocations[0].id + '/payment', 'PATCH', { paidAmount: '150', previousBalance: '999', manualAdjustment: '0' });
    const january = await api('/bills/2027-01', 'PUT', nextInput);
    assert.equal(january.allocations[0].previousBalance, 50);
    assert.equal(january.allocations[0].payableAmount, 150);
    assert.equal(january.users.find(user => user.id === residents[3]._id).previousArrears, 50);
    assert.match(january.notifications[0].message, /Total Previous Arrears:\* Rs\. 50\.00/);
    const adjusted = await api('/allocations/' + january.allocations[0].id + '/payment', 'PATCH', { paidAmount: '5', manualAdjustment: '10' });
    assert.match(adjusted.notifications[0].message, /Rs\. 155\.00/);
    await Notification.updateOne({ bill_id: january.bill.id }, { $set: { message: 'Old template', template_parameters: ['old'], message_version: 1 } });
    await queueBill(january.bill.id);
    let notice = await Notification.findOne({ bill_id: january.bill.id });
    assert.equal(notice.message_version, 2);
    assert.equal(notice.template_parameters.length, 10);
    assert.equal(notice.template_parameters[7], '155.00 (+Rs. 10.00 adjustment; Rs. 5.00 already paid)');
    await Notification.updateOne({ _id: notice._id }, { $set: { status: 'sent' } });
    const sentMessage = notice.message;
    await api('/allocations/' + january.allocations[0].id + '/payment', 'PATCH', { paidAmount: '160', manualAdjustment: '10' });
    await queueBill(january.bill.id);
    notice = await Notification.findById(notice._id);
    assert.equal(notice.message, sentMessage, 'accepted messages keep their original content');
    const february = await api('/bills/2027-02', 'PUT', nextInput);
    assert.equal(february.allocations[0].previousBalance, 0);
    assert.equal(february.allocations[0].payableAmount, 100);
  });
});
