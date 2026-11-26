const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const { getDeliveryConfig, getVerifiedSender } = require('../src/services/whatsappConfig');

async function check() {
  const delivery = getDeliveryConfig();
  console.log(`Configured sender: ${delivery.senderPhoneNumber || 'not configured'}`);
  if (!delivery.ready) {
    console.error(delivery.reason);
    if (delivery.missingFields.length) console.error(`Set these backend .env fields: ${delivery.missingFields.join(', ')}`);
    process.exitCode = 1;
    return;
  }
  const sender = await getVerifiedSender();
  console.log(`Meta confirmed the Phone Number ID belongs to ${sender.senderPhoneNumber}.`);
  console.log(`Configured template: ${sender.templateName} (${sender.templateLanguage}), format v${sender.templateVersion}.`);
  console.log('Check that this exact ten-parameter template is APPROVED in WhatsApp Manager before sending.');
  console.log('This check does not verify template approval or message delivery. No messages were sent.');
}

check().catch(error => {
  console.error(error.code === 'WHATSAPP_SETUP' ? error.message : 'WhatsApp setup check failed.');
  process.exitCode = 1;
});
