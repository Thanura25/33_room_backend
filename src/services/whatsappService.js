const Notification = require('../models/Notification');
const { getDeliveryConfig, getVerifiedSender } = require('./whatsappConfig');
const { phone: formatPhone } = require('../utils/validation');

const formatMoney = (val) => new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(val || 0));

function buildBoardingBillMessage({ memberName, monthName, year, categoryCharges, totalNewCharges, previousArrears, totalDue, dueDate }) {
  const dueNotice = dueDate ? `before *${dueDate}*` : 'at your earliest convenience';
  
  const categoryLines = [];
  if (categoryCharges.electricity > 0) categoryLines.push(`⚡ Electricity: Rs. ${formatMoney(categoryCharges.electricity)}`);
  if (categoryCharges.water > 0) categoryLines.push(`💧 Water: Rs. ${formatMoney(categoryCharges.water)}`);
  if (categoryCharges.telecom > 0) categoryLines.push(`📶 Telecom: Rs. ${formatMoney(categoryCharges.telecom)}`);
  if (categoryCharges.restaurant > 0) categoryLines.push(`🍽️ Restaurant: Rs. ${formatMoney(categoryCharges.restaurant)}`);
  if (categoryCharges.other > 0) categoryLines.push(`🧾 Other Expenses: Rs. ${formatMoney(categoryCharges.other)}`);
  
  if (categoryLines.length === 0) {
    categoryLines.push(`Total Charges: Rs. ${formatMoney(totalNewCharges)}`);
  }

  return [
    `Hello ${memberName},`,
    '',
    `Your monthly boarding bill has been updated.`,
    '',
    `Month: *${monthName} ${year}*`,
    '',
    'Bill Details:',
    categoryLines.join('\n'),
    '',
    `Total New Bill: *Rs. ${formatMoney(totalNewCharges)}*`,
    '',
    `Previous Outstanding: *Rs. ${formatMoney(previousArrears)}*`,
    '',
    `Total Amount Due: *Rs. ${formatMoney(totalDue)}*`,
    '',
    `Please settle your outstanding balance ${dueNotice}.`,
    '',
    'Thank you! 🙏'
  ].join('\n');
}

function getClickToChatUrl(rawPhone, message) {
  try {
    const cleanNumber = rawPhone.replace(/\D/g, '');
    return `https://wa.me/${cleanNumber}?text=${encodeURIComponent(message)}`;
  } catch {
    return '';
  }
}

async function dispatchOrQueueWhatsApp({ resident, month, year, categoryCharges, totalNewCharges, previousArrears, totalDue, dueDate, categoryBillId, category }) {
  const monthName = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(year, month - 1, 1)));
  const memberName = resident.name;
  const phoneNumber = formatPhone(resident.phone_number);

  const messageText = buildBoardingBillMessage({
    memberName,
    monthName,
    year,
    categoryCharges,
    totalNewCharges,
    previousArrears,
    totalDue,
    dueDate,
  });

  const clickToChatUrl = getClickToChatUrl(phoneNumber, messageText);
  const notificationKey = `catbill:${year}-${month}:${category || 'all'}:${resident._id}`;

  let notification = await Notification.findOne({ notification_key: notificationKey });
  if (!notification) {
    notification = await Notification.create({
      notification_key: notificationKey,
      resident_id: resident._id,
      category_bill_id: categoryBillId,
      category: category || '',
      phone_number: phoneNumber,
      message: messageText,
      click_to_chat_url: clickToChatUrl,
      status: 'pending',
    });
  } else if (['pending', 'failed'].includes(notification.status)) {
    notification.message = messageText;
    notification.click_to_chat_url = clickToChatUrl;
    await notification.save();
  }

  const delivery = getDeliveryConfig();
  if (delivery.ready) {
    try {
      const sender = await getVerifiedSender();
      const response = await fetch(`https://graph.facebook.com/${sender.apiVersion}/${sender.phoneNumberId}/messages`, {
        method: 'POST',
        signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${sender.accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: phoneNumber.replace(/\D/g, ''),
          type: 'text',
          text: { preview_url: false, body: messageText },
        }),
      });
      const data = await response.json();
      if (response.ok && data.messages?.[0]?.id) {
        notification.status = 'sent';
        notification.provider_message_id = data.messages[0].id;
        notification.sent_at = new Date();
        notification.error_message = '';
      } else {
        notification.status = 'failed';
        notification.error_message = data.error?.message || 'Failed to deliver message via WhatsApp API.';
      }
      await notification.save();
    } catch (err) {
      notification.status = 'failed';
      notification.error_message = err.message || 'WhatsApp Cloud API connection error.';
      await notification.save();
    }
  }

  return notification;
}

module.exports = {
  buildBoardingBillMessage,
  getClickToChatUrl,
  dispatchOrQueueWhatsApp,
};
