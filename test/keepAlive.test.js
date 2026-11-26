const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../src/app');
const { startKeepAlive, stopKeepAlive } = require('../src/services/keepAliveService');

test('Render Keep-Alive Service and Health Endpoints', async (t) => {
  await t.test('returns null and remains inactive when no URL is provided', () => {
    const originalEnv = { ...process.env };
    delete process.env.BACKEND_URL;
    delete process.env.RENDER_EXTERNAL_URL;
    delete process.env.APP_URL;
    delete process.env.KEEP_ALIVE_URL;

    const interval = startKeepAlive();
    assert.equal(interval, null);
    stopKeepAlive();
    process.env = originalEnv;
  });

  await t.test('initializes interval timer when BACKEND_URL is defined', () => {
    const originalEnv = { ...process.env };
    process.env.BACKEND_URL = 'https://room33-api.onrender.com';
    process.env.KEEP_ALIVE_INTERVAL_MINUTES = '10';

    const interval = startKeepAlive();
    assert.ok(interval);

    stopKeepAlive();
    process.env = originalEnv;
  });

  await t.test('health endpoints /health and /api/health are reachable and return ok status', async () => {
    await new Promise((resolve, reject) => {
      const server = app.listen(0, async () => {
        try {
          const port = server.address().port;
          const res = await fetch(`http://127.0.0.1:${port}/api/health`);
          assert.equal(res.status, 200);
          const data = await res.json();
          assert.equal(data.status, 'ok');
          assert.equal(typeof data.uptime, 'number');

          const resRoot = await fetch(`http://127.0.0.1:${port}/health`);
          assert.equal(resRoot.status, 200);
          const dataRoot = await resRoot.json();
          assert.equal(dataRoot.status, 'ok');

          server.close(resolve);
        } catch (err) {
          server.close(() => reject(err));
        }
      });
    });
  });
});
