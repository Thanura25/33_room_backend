const fs = require('node:fs');
const path = require('node:path');
const { utilityBillTemplate, createUtilityBillMessage } = require('../src/utils/utilityBillMessage');

const directory = path.resolve(__dirname, '../whatsapp');
const sample = createUtilityBillMessage({
  monthLabel: 'September 2026', electricity: 3500, water: 6500,
  memberCount: 2, share: 5000, previousArrears: 1200, dueDate: '2026-09-30',
});
const template = {
  name: utilityBillTemplate.name,
  language: 'en',
  category: 'UTILITY',
  parameter_format: 'POSITIONAL',
  components: [{ type: 'BODY', text: utilityBillTemplate.body, example: { body_text: [sample.template_parameters] } }],
};
fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(directory, 'monthly-utility-bill-v2.json'), JSON.stringify(template, null, 2) + '\n');
fs.writeFileSync(path.join(directory, 'monthly-utility-bill-v2.txt'), utilityBillTemplate.body + '\n');
fs.writeFileSync(path.join(directory, 'monthly-utility-bill-example.txt'), sample.message + '\n');
console.log('WhatsApp template body, API definition and filled example written to 33-backend/whatsapp.');
