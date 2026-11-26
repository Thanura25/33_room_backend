/**
 * Keep-Alive Service for Render.com free tier hosting.
 * Render spins down free tier instances after 15 minutes of inactivity.
 * This service automatically pings the public health endpoint every 10 minutes
 * to keep the service warm and awake without sleeping.
 */

let keepAliveInterval = null;

function startKeepAlive() {
  // Render automatically injects RENDER_EXTERNAL_URL into environment variables on Web Services
  // (e.g., https://your-backend-app.onrender.com)
  const targetUrl =
    process.env.BACKEND_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    process.env.APP_URL ||
    process.env.KEEP_ALIVE_URL;

  const intervalMinutes = Number(process.env.KEEP_ALIVE_INTERVAL_MINUTES) || 10;
  const intervalMs = intervalMinutes * 60 * 1000;

  if (!targetUrl) {
    console.log('[KeepAlive] Inactive (No BACKEND_URL or RENDER_EXTERNAL_URL defined). Set BACKEND_URL on Render dashboard to enable self-ping.');
    return null;
  }

  const baseUrl = targetUrl.replace(/\/+$/, '');
  const healthEndpoint = `${baseUrl}/api/health`;

  console.log(`[KeepAlive] Service active. Auto-pinging ${healthEndpoint} every ${intervalMinutes} minutes.`);

  const ping = async () => {
    try {
      const response = await fetch(healthEndpoint, {
        method: 'GET',
        headers: { 'User-Agent': 'RenderKeepAliveBot/1.0' },
      });
      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        console.log(`[KeepAlive] Self-ping successful (${response.status}) at ${new Date().toLocaleTimeString()} - uptime: ${Math.round(data.uptime || 0)}s`);
      } else {
        console.warn(`[KeepAlive] Self-ping returned status ${response.status}`);
      }
    } catch (err) {
      console.warn(`[KeepAlive] Self-ping failed: ${err.message}`);
    }
  };

  // Initial self-ping after 30 seconds to confirm connectivity without delaying server startup
  const initialTimeout = setTimeout(ping, 30000);
  if (initialTimeout.unref) initialTimeout.unref();

  // Scheduled interval
  keepAliveInterval = setInterval(ping, intervalMs);
  if (keepAliveInterval.unref) keepAliveInterval.unref();

  return keepAliveInterval;
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

module.exports = {
  startKeepAlive,
  stopKeepAlive,
};
