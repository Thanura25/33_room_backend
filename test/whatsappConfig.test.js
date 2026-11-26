const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getDeliveryConfig, getVerifiedSender } = require('../src/services/whatsappConfig');

const config = {
  WHATSAPP_ENABLED: 'true', WHATSAPP_SENDER_PHONE_NUMBER: '070 000 0001',
  WHATSAPP_PHONE_NUMBER_ID: '12345', WHATSAPP_ACCESS_TOKEN: 'unit-test-token',
  WHATSAPP_API_VERSION: 'v22.0', WHATSAPP_TEMPLATE_NAME: 'room33_monthly_utility_bill_v2',
  WHATSAPP_TEMPLATE_LANGUAGE: 'en', WHATSAPP_TEMPLATE_VERSION: '2',
};

test('sender verification blocks incomplete, mismatched and unverified identities', async t => {
  const saved = Object.fromEntries(Object.keys(config).map(key => [key, process.env[key]]));
  const originalFetch = global.fetch;
  try {
    Object.assign(process.env, config);
    await t.test('missing credentials stay pending without calling Meta or exposing secrets', async () => {
      process.env.WHATSAPP_ACCESS_TOKEN = '';
      global.fetch = async () => { assert.fail('incomplete configuration must not contact Meta'); };
      const delivery = getDeliveryConfig();
      assert.equal(delivery.ready, false);
      assert.equal(delivery.senderPhoneNumber, '+94700000001');
      assert.deepEqual(delivery.missingFields, ['WHATSAPP_ACCESS_TOKEN']);
      await assert.rejects(getVerifiedSender(), /incomplete/);
      process.env.WHATSAPP_ACCESS_TOKEN = config.WHATSAPP_ACCESS_TOKEN;
      assert.equal(JSON.stringify(getDeliveryConfig()).includes(config.WHATSAPP_ACCESS_TOKEN), false);
    });
    await t.test('a successful sender match is shared across concurrent checks', async () => {
      let calls = 0;
      global.fetch = async (url, options) => {
        calls++;
        assert.equal(url, 'https://graph.facebook.com/v22.0/12345?fields=id,display_phone_number');
        assert.equal(options.method, 'GET');
        assert.equal(options.headers.Authorization, 'Bearer unit-test-token');
        return Response.json({ id: '12345', display_phone_number: '+94 70 000 0001' });
      };
      const senders = await Promise.all([getVerifiedSender(), getVerifiedSender(), getVerifiedSender()]);
      assert.equal(calls, 1);
      assert.ok(senders.every(sender => sender.senderPhoneNumber === '+94700000001'));
    });
    await t.test('changing credentials requires a new match and failures can be retried', async () => {
      process.env.WHATSAPP_ACCESS_TOKEN = 'rotated-unit-test-token';
      global.fetch = async () => Response.json({ id: '12345', display_phone_number: '+94700000002' });
      await assert.rejects(getVerifiedSender(), /does not match/);
      global.fetch = async () => { throw new Error('simulated network failure'); };
      await assert.rejects(getVerifiedSender(), /Could not verify/);
      global.fetch = async () => Response.json({ error: { message: 'private provider detail' } }, { status: 401 });
      await assert.rejects(getVerifiedSender(), error => error.code === 'WHATSAPP_SETUP' && /HTTP 401/.test(error.message) && !error.message.includes('private provider detail'));
      global.fetch = async () => Response.json({ id: '12345' });
      await assert.rejects(getVerifiedSender(), /does not match/);
      global.fetch = async () => Response.json(null);
      await assert.rejects(getVerifiedSender(), error => error.code === 'WHATSAPP_SETUP');
      global.fetch = async () => Response.json({ id: '12345', display_phone_number: '94700000001' });
      assert.equal((await getVerifiedSender()).senderPhoneNumber, '+94700000001');
    });
    await t.test('invalid sender settings cannot enable sending', () => {
      process.env.WHATSAPP_SENDER_PHONE_NUMBER = 'invalid';
      assert.equal(getDeliveryConfig().ready, false);
      process.env.WHATSAPP_SENDER_PHONE_NUMBER = config.WHATSAPP_SENDER_PHONE_NUMBER;
      process.env.WHATSAPP_PHONE_NUMBER_ID = '+94700000001';
      assert.equal(getDeliveryConfig().ready, false);
    });
  } finally {
    global.fetch = originalFetch;
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
