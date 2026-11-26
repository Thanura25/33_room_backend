const bcrypt = require('bcryptjs');
const Resident = require('../models/Resident');
const User = require('../models/User');
const { fail, phone, date, objectId } = require('../utils/validation');

function readField(field, validate) {
  try { return validate(); }
  catch (error) { error.field = field; throw error; }
}

function residentInput(body) {
  if (typeof body.name !== 'string' || !body.name.trim()) fail('Resident name is required.', 400, 'name');
  if (!['active', 'inactive'].includes(body.status || 'active')) fail('Invalid resident status.', 400, 'status');
  const joined = readField('joined_date', () => date(body.joined_date, 'Joined date'));
  const left = readField('left_date', () => date(body.left_date, 'Left date'));
  if (joined && left && left < joined) fail('Left date cannot be before joined date.', 400, 'left_date');
  const birthday = readField('birthday', () => date(body.birthday, 'Birthday'));
  if (birthday && birthday > new Date()) fail('Birthday cannot be in the future.', 400, 'birthday');
  const email = String(body.email || '').trim().toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Enter a valid email.', 400, 'email');
  return {
    name: body.name.trim(), phone_number: readField('phone_number', () => phone(body.phone_number)),
    room_number: String(body.room_number || '').trim(), email,
    birthday: birthday || null,
    status: body.status || 'active', ...(joined ? { joined_date: joined } : {}), left_date: left,
  };
}

exports.list = async (_request, response) => {
  const residents = await Resident.find().sort({ name: 1 }).populate('user_id', 'email role').lean();
  return response.json(residents.map(r => ({
    ...r,
    id: String(r._id),
    fullName: r.name,
    phone: r.phone_number,
    roomNumber: r.room_number || '',
    birthday: r.birthday || null,
    joinedDate: r.joined_date,
    leftDate: r.left_date,
    hasAccount: Boolean(r.user_id),
    accountEmail: r.user_id?.email || r.email || '',
  })));
};

exports.create = async (request, response) => {
  const input = residentInput(request.body);
  const resident = await Resident.create(input);

  // If password provided during creation, create member login account
  if (request.body.password && String(request.body.password).trim().length >= 6) {
    const accountEmail = (resident.email || `${resident.phone_number.replace(/\D/g, '')}@room33.local`).toLowerCase();
    const password_hash = await bcrypt.hash(String(request.body.password).trim(), 10);
    const user = await User.create({
      name: resident.name,
      email: accountEmail,
      password_hash,
      role: 'member',
      resident_id: resident._id,
    });
    resident.user_id = user._id;
    if (!resident.email) resident.email = accountEmail;
    await resident.save();
  }

  return response.status(201).json(resident);
};

exports.update = async (request, response) => {
  objectId(request.params.id, 'Resident ID');
  const resident = await Resident.findByIdAndUpdate(request.params.id, residentInput(request.body), { returnDocument: 'after', runValidators: true });
  if (!resident) return response.status(404).json({ message: 'Resident not found.' });

  // If password provided in edit, update account
  if (request.body.password && String(request.body.password).trim().length >= 6) {
    const accountEmail = (resident.email || `${resident.phone_number.replace(/\D/g, '')}@room33.local`).toLowerCase();
    const password_hash = await bcrypt.hash(String(request.body.password).trim(), 10);
    let user = resident.user_id ? await User.findById(resident.user_id) : await User.findOne({ email: accountEmail });
    if (user) {
      user.password_hash = password_hash;
      user.name = resident.name;
      user.email = accountEmail;
      user.resident_id = resident._id;
      user.role = 'member';
      await user.save();
    } else {
      user = await User.create({
        name: resident.name,
        email: accountEmail,
        password_hash,
        role: 'member',
        resident_id: resident._id,
      });
      resident.user_id = user._id;
      await resident.save();
    }
  }

  return response.json(resident);
};

exports.setAccount = async (request, response) => {
  objectId(request.params.id, 'Resident ID');
  const resident = await Resident.findById(request.params.id);
  if (!resident) fail('Resident not found.', 404);

  const { password, email } = request.body;
  if (typeof password !== 'string' || password.length < 6) fail('Password must be at least 6 characters.');
  const accountEmail = (email || resident.email || `${resident.phone_number.replace(/\D/g, '')}@room33.local`).trim().toLowerCase();

  const password_hash = await bcrypt.hash(password, 10);
  let user = resident.user_id ? await User.findById(resident.user_id) : await User.findOne({ email: accountEmail });

  if (user) {
    user.name = resident.name;
    user.email = accountEmail;
    user.password_hash = password_hash;
    user.role = 'member';
    user.resident_id = resident._id;
    await user.save();
  } else {
    user = await User.create({
      name: resident.name,
      email: accountEmail,
      password_hash,
      role: 'member',
      resident_id: resident._id,
    });
  }

  resident.user_id = user._id;
  resident.email = accountEmail;
  await resident.save();

  return response.json({
    message: 'Member account credentials updated successfully.',
    accountEmail: user.email,
    hasAccount: true,
  });
};
