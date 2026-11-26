const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../src/models/User');
const { getAdminConfig, syncEnvironmentAdmin } = require('../src/services/adminService');
const app = require('../src/app');

const databaseName = `room33_test_admin_${randomUUID().replaceAll('-', '')}`;
const keys = ['ADMIN_NAME', 'ADMIN_EMAIL', 'ADMIN_PASSWORD', 'JWT_SECRET'];
const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
let server;
let baseUrl;

before(async () => {
  for (const key of keys) delete process.env[key];
  process.env.JWT_SECRET = 'isolated-admin-test-secret';
  await mongoose.connect(process.env.TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017', { dbName: databaseName, serverSelectionTimeoutMS: 5000 });
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (mongoose.connection.readyState === 1 && mongoose.connection.name === databaseName && databaseName.startsWith('room33_test_admin_')) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

async function request(route, body) {
  const response = await fetch(baseUrl + route, body ? {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  } : {});
  return { status: response.status, body: await response.json() };
}

test('environment-managed administrator creation, login and updates', async t => {
  let adminId;
  let passwordHash;
  await t.test('empty settings retain the original first-account setup', async () => {
    assert.equal(getAdminConfig(), null);
    await syncEnvironmentAdmin();
    assert.equal(await User.countDocuments(), 0);
    assert.equal((await request('/setup')).body.needsSetup, true);
  });

  await t.test('environment credentials create one admin and close public registration', async () => {
    Object.assign(process.env, { ADMIN_NAME: 'Environment Admin', ADMIN_EMAIL: ' ADMIN@example.test ', ADMIN_PASSWORD: 'a strong # test password' });
    assert.equal((await request('/setup')).body.needsSetup, false);
    assert.equal((await request('/register', { name: 'Uninvited', email: 'other@example.test', password: 'test-password' })).status, 403);
    await syncEnvironmentAdmin();
    const admin = await User.findOne({ email: 'admin@example.test' }).select('+password_hash');
    adminId = admin.id;
    passwordHash = admin.password_hash;
    assert.equal(admin.role, 'admin');
    assert.equal(admin.name, 'Environment Admin');
    assert.notEqual(passwordHash, process.env.ADMIN_PASSWORD);
    assert.equal(await bcrypt.compare(process.env.ADMIN_PASSWORD, passwordHash), true);
    const result = await request('/login', { email: 'admin@example.test', password: process.env.ADMIN_PASSWORD });
    assert.equal(result.status, 200);
    assert.equal(result.body.user.id, adminId);
    assert.equal(result.body.user.role, 'admin');
    assert.equal(JSON.stringify(result.body).includes(passwordHash), false);
    assert.equal(JSON.stringify(result.body).includes(process.env.ADMIN_PASSWORD), false);
    assert.equal((await request('/login', { email: {}, password: 'invalid' })).status, 401);
  });

  await t.test('unchanged configuration does not duplicate an admin or rehash its password', async () => {
    await syncEnvironmentAdmin();
    const admin = await User.findById(adminId).select('+password_hash');
    assert.equal(admin.password_hash, passwordHash);
    assert.equal(await User.countDocuments(), 1);
  });

  await t.test('name, email and password changes update the same initial administrator', async () => {
    Object.assign(process.env, { ADMIN_NAME: 'Updated Admin', ADMIN_EMAIL: 'new@example.test', ADMIN_PASSWORD: 'rotated test password' });
    await syncEnvironmentAdmin();
    const admin = await User.findById(adminId).select('+password_hash');
    assert.equal(admin.name, 'Updated Admin');
    assert.equal(admin.email, 'new@example.test');
    assert.notEqual(admin.password_hash, passwordHash);
    passwordHash = admin.password_hash;
    assert.equal(await User.countDocuments(), 1);
    assert.equal((await request('/login', { email: 'admin@example.test', password: 'a strong # test password' })).status, 401);
    assert.equal((await request('/login', { email: 'new@example.test', password: 'a strong # test password' })).status, 401);
    assert.equal((await request('/login', { email: 'new@example.test', password: 'rotated test password' })).status, 200);
  });

  await t.test('a blank password preserves an existing login', async () => {
    process.env.ADMIN_PASSWORD = '';
    await syncEnvironmentAdmin();
    assert.equal((await User.findById(adminId).select('+password_hash')).password_hash, passwordHash);
    assert.equal((await request('/login', { email: 'new@example.test', password: 'rotated test password' })).status, 200);
  });

  await t.test('invalid settings and an occupied email cannot overwrite other accounts', async () => {
    process.env.ADMIN_PASSWORD = 'short';
    await assert.rejects(syncEnvironmentAdmin(), /ADMIN_PASSWORD/);
    process.env.ADMIN_PASSWORD = 'é'.repeat(37);
    await assert.rejects(syncEnvironmentAdmin(), /72 bytes/);
    process.env.ADMIN_PASSWORD = '';
    process.env.ADMIN_EMAIL = 'invalid';
    await assert.rejects(syncEnvironmentAdmin(), /ADMIN_EMAIL/);
    await User.create({ name: 'Staff', email: 'staff@example.test', password_hash: passwordHash, role: 'staff' });
    process.env.ADMIN_EMAIL = 'staff@example.test';
    await assert.rejects(syncEnvironmentAdmin(), /another account/);
    assert.equal((await User.findOne({ email: 'staff@example.test' })).role, 'staff');
    assert.equal((await User.findById(adminId)).email, 'new@example.test');
  });

  await t.test('a new admin cannot be created with a blank password', async () => {
    await User.deleteOne({ _id: adminId });
    process.env.ADMIN_EMAIL = 'new@example.test';
    await assert.rejects(syncEnvironmentAdmin(), /Set ADMIN_PASSWORD/);
    assert.equal(await User.countDocuments({ role: 'admin' }), 0);
  });
});
