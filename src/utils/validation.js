const mongoose = require('mongoose');

function fail(message, statusCode = 400, field) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (field) error.field = field;
  throw error;
}

function money(value, label = 'Amount', { negative = false } = {}) {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') fail(`${label} is required.`);
  const amount = Number(value);
  const cents = Math.round(amount * 100);
  if (!Number.isFinite(amount) || Math.abs(cents) > 100000000000 || (!negative && amount < 0)
    || Math.abs(amount * 100 - cents) > 0.00001) fail(`${label} must be a valid amount with at most two decimal places.`);
  return cents / 100;
}

function monthParts(value) {
  if (typeof value !== 'string' || !/^(20\d{2}|21\d{2})-(0[1-9]|1[0-2])$/.test(value)) fail('Choose a valid billing month (YYYY-MM).');
  const [year, month] = value.split('-').map(Number);
  return { year, month };
}

function objectId(value, label = 'ID') {
  if (typeof value !== 'string' || !mongoose.isObjectIdOrHexString(value)) fail(`${label} is invalid.`);
  return value;
}

function phone(value) {
  if (typeof value !== 'string' || !/^[+\d\s()-]+$/.test(value.trim())) fail('Enter a valid WhatsApp phone number.');
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (/^0\d{9}$/.test(digits)) digits = `94${digits.slice(1)}`;
  if (!/^[1-9]\d{7,14}$/.test(digits)) fail('Use a Sri Lankan number like 0771234567 or a number with its country code.');
  return `+${digits}`;
}

function date(value, label = 'Date') {
  if (!value) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value) || Number.isNaN(Date.parse(value))) fail(`${label} is invalid.`);
  const day = value.slice(0, 10);
  if (new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) !== day) fail(`${label} is invalid.`);
  return new Date(value);
}

module.exports = { fail, money, monthParts, objectId, phone, date };
