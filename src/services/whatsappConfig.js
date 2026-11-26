const { phone } = require('../utils/validation');
const { utilityBillTemplate } = require('../utils/utilityBillMessage');

let senderVerification;

function settings() {
  const value = key => process.env[key]?.trim() || '';
  let senderPhoneNumber = '';
  try { senderPhoneNumber = phone(value('WHATSAPP_SENDER_PHONE_NUMBER')); } catch { /* Report invalid or missing configuration below. */ }
  return {
    enabled: value('WHATSAPP_ENABLED') === 'true',
    senderPhoneNumber,
    phoneNumberId: value('WHATSAPP_PHONE_NUMBER_ID'),
    accessToken: value('WHATSAPP_ACCESS_TOKEN'),
    apiVersion: value('WHATSAPP_API_VERSION'),
    templateName: value('WHATSAPP_TEMPLATE_NAME'),
    templateLanguage: value('WHATSAPP_TEMPLATE_LANGUAGE'),
    templateVersion: value('WHATSAPP_TEMPLATE_VERSION'),
  };
}

function getDeliveryConfig() {
  const config = settings();
  const fields = {
    WHATSAPP_SENDER_PHONE_NUMBER: config.senderPhoneNumber,
    WHATSAPP_PHONE_NUMBER_ID: config.phoneNumberId,
    WHATSAPP_ACCESS_TOKEN: config.accessToken,
    WHATSAPP_API_VERSION: config.apiVersion,
    WHATSAPP_TEMPLATE_NAME: config.templateName,
    WHATSAPP_TEMPLATE_LANGUAGE: config.templateLanguage,
    WHATSAPP_TEMPLATE_VERSION: config.templateVersion,
  };
  const missingFields = Object.keys(fields).filter(key => !fields[key]);
  let reason = '';
  if (!config.enabled) reason = 'WhatsApp sending is disabled. Messages are saved as pending.';
  else if (missingFields.length) reason = `WhatsApp setup${config.senderPhoneNumber ? ` for ${config.senderPhoneNumber}` : ''} is incomplete. Messages are saved as pending until the sender and approved billing template are connected.`;
  else if (!/^\d+$/.test(config.phoneNumberId)) reason = 'The WhatsApp sender ID is invalid. Use the Phone Number ID provided by Meta.';
  else if (!/^v\d+\.\d+$/.test(config.apiVersion)) reason = 'The WhatsApp API version is invalid.';
  else if (config.templateVersion !== String(utilityBillTemplate.version)) reason = 'The new utility bill template must be approved and configured before sending. Messages remain pending.';
  return { enabled: config.enabled, ready: !reason, channel: 'WhatsApp', senderPhoneNumber: config.senderPhoneNumber, missingFields, reason };
}

function setupError(message) {
  return Object.assign(new Error(message), { code: 'WHATSAPP_SETUP', statusCode: 503 });
}

async function verifySender(config) {
  let response;
  let payload;
  try {
    response = await fetch(`https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}?fields=id,display_phone_number`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.accessToken}` },
      signal: AbortSignal.timeout(15000),
    });
    payload = await response.json();
  } catch {
    throw setupError('Could not verify the WhatsApp sender with Meta. Messages remain pending; check the connection and try again.');
  }
  if (!response.ok) throw setupError(`Meta could not verify the WhatsApp sender (HTTP ${response.status}). Check the sender ID and access token permissions. No messages were sent.`);
  let actualNumber = '';
  try { actualNumber = phone(payload?.display_phone_number); } catch { /* Missing or malformed sender data must block sending. */ }
  if (String(payload?.id) !== config.phoneNumberId || actualNumber !== config.senderPhoneNumber) {
    throw setupError(`The Meta Phone Number ID does not match the configured sender ${config.senderPhoneNumber}. Messages remain pending.`);
  }
  return config;
}

// Share concurrent checks and cache a successful match for five minutes.
// A change to any credential or sender setting requires a new check.
async function getVerifiedSender() {
  const delivery = getDeliveryConfig();
  if (!delivery.ready) throw setupError(delivery.reason);
  const config = settings();
  const key = JSON.stringify(config);
  if (senderVerification?.key === key && senderVerification.expiresAt > Date.now()) return senderVerification.promise;
  const entry = { key, expiresAt: Infinity };
  entry.promise = verifySender(config).then(result => {
    entry.expiresAt = Date.now() + 5 * 60 * 1000;
    return result;
  }).catch(error => {
    if (senderVerification === entry) senderVerification = undefined;
    throw error;
  });
  senderVerification = entry;
  return entry.promise;
}

module.exports = { getDeliveryConfig, getVerifiedSender };
