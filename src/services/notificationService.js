const Notification = require('../models/Notification');
const { getBillDetails } = require('./billService');
const { objectId, fail } = require('../utils/validation');
const { createUtilityBillMessage, utilityBillTemplate } = require('../utils/utilityBillMessage');
const { getDeliveryConfig, getVerifiedSender } = require('./whatsappConfig');

function billMessage(bill, row, memberCount = bill.participants?.length) {
  const month = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(bill.year, bill.month - 1, 1)));
  return createUtilityBillMessage({
    monthLabel: month, electricity: bill.electricity ?? bill.total_amount, water: bill.water,
    memberCount, share: row.amount, previousArrears: row.previous_balance,
    manualAdjustment: row.manual_adjustment, paidAmount: row.paid_amount,
    sharedCredit: bill.sharedCredit, dueDate: bill.dueDate ? new Date(bill.dueDate).toISOString().slice(0, 10) : '',
  });
}

async function queueBill(billId) {
  const { bill, residentBills } = await getBillDetails(billId);
  for (const row of residentBills) {
    const residentId = row.resident_id?._id || row.resident_id;
    const key = `${bill.id}:${residentId}`;
    const content = billMessage(bill, row, residentBills.length);
    try {
      await Notification.updateOne({ notification_key: key }, { $setOnInsert: {
        notification_key: key, resident_id: residentId, bill_id: bill._id,
        phone_number: row.phone_number || row.resident_id?.phone_number,
        ...content,
      } }, { upsert: true, runValidators: true });
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    // Refresh unsent notices from current arrears/payments. Never change a
    // claimed, accepted or uncertain message, or retry those messages.
    await Notification.updateOne({ notification_key: key, status: { $in: ['pending', 'failed'] } }, { $set: content }, { runValidators: true });
  }
  return Notification.find({ bill_id: billId }).sort({ createdAt: 1 });
}

async function dispatchNotification(id) {
  if (!getDeliveryConfig().ready) return Notification.findById(id);
  const sender = await getVerifiedSender();
  // The atomic claim prevents duplicate sends from concurrent clicks or requests.
  const notification = await Notification.findOneAndUpdate(
    { _id: id, status: { $in: ['pending', 'failed'] }, message_version: utilityBillTemplate.version },
    { $set: { status: 'sending', error_message: '' } }, { returnDocument: 'after' },
  );
  if (!notification) return Notification.findById(id);
  let nextStatus = 'unknown';
  let errorMessage = '';
  let providerId = '';
  try {
    const response = await fetch(`https://graph.facebook.com/${sender.apiVersion}/${sender.phoneNumberId}/messages`, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${sender.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp', to: notification.phone_number.replace(/\D/g, ''), type: 'template',
        template: {
          name: sender.templateName,
          language: { code: sender.templateLanguage },
          components: [{ type: 'body', parameters: notification.template_parameters.map(text => ({ type: 'text', text })) }],
        },
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      nextStatus = response.status >= 500 ? 'unknown' : 'failed';
      errorMessage = payload.error?.message || 'WhatsApp rejected this message.';
    } else if (payload.messages?.[0]?.id) {
      nextStatus = 'sent';
      providerId = payload.messages[0].id;
    } else {
      errorMessage = 'WhatsApp returned no message ID. Check the provider before trying again.';
    }
  } catch {
    errorMessage = 'The delivery result is unknown after a connection error. Check WhatsApp Manager before retrying.';
  }
  // A provider acknowledgement means accepted, not confirmed delivery to a phone.
  return Notification.findByIdAndUpdate(id, { $set: {
    status: nextStatus, error_message: errorMessage, provider_message_id: providerId,
    sent_at: nextStatus === 'sent' ? new Date() : null,
  } }, { returnDocument: 'after' });
}

async function sendBill(billId, residentId) {
  objectId(billId, 'Bill ID');
  if (residentId) objectId(residentId, 'Resident ID');
  const queued = await queueBill(billId);
  const targets = queued.filter(item => !residentId || String(item.resident_id) === residentId);
  if (residentId && !targets.length) fail('This resident is not included in the saved bill.', 404);
  const unsent = targets.filter(item => ['pending', 'failed'].includes(item.status));
  // Small batches avoid one recipient's failure preventing everyone else's message.
  for (let index = 0; index < unsent.length; index += 4) {
    await Promise.all(unsent.slice(index, index + 4).map(item => dispatchNotification(item.id)));
  }
  return Notification.find({ bill_id: billId }).sort({ createdAt: 1 });
}

module.exports = { getDeliveryConfig, billMessage, queueBill, sendBill, dispatchNotification };

