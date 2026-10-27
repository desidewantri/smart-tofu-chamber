const jwt = require('jsonwebtoken');
const env = require('../config/env');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');

const sign = (user, remember) =>
  jwt.sign({ id: user._id }, env.jwtSecret, { expiresIn: remember ? '30d' : env.jwtExpiresIn });

exports.login = asyncHandler(async (req, res) => {
  const { email, password, remember } = req.body || {};
  if (!email || !password) throw new ApiError(400, 'Email dan password wajib diisi');
  const user = await User.findOne({ email: String(email).toLowerCase().trim() }).select('+password');
  if (!user || !(await user.comparePassword(String(password)))) {
    throw new ApiError(401, 'Email atau password salah');
  }
  res.json({ success: true, data: { token: sign(user, Boolean(remember)), user } });
});

exports.me = asyncHandler(async (req, res) => {
  res.json({ success: true, data: { user: req.user } });
});

exports.updateProfile = asyncHandler(async (req, res) => {
  const { name, email } = req.body || {};
  if (name !== undefined) {
    if (!String(name).trim()) throw new ApiError(400, 'Nama tidak boleh kosong');
    req.user.name = String(name).trim();
  }
  if (email !== undefined) {
    if (!/^\S+@\S+\.\S+$/.test(String(email))) throw new ApiError(400, 'Format email tidak valid');
    req.user.email = String(email).toLowerCase().trim();
  }
  await req.user.save();
  res.json({ success: true, message: 'Profil diperbarui', data: { user: req.user } });
});

exports.changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!currentPassword || !newPassword) throw new ApiError(400, 'Password lama dan baru wajib diisi');
  if (String(newPassword).length < 6) throw new ApiError(400, 'Password baru minimal 6 karakter');
  const user = await User.findById(req.user._id).select('+password');
  if (!(await user.comparePassword(String(currentPassword)))) {
    throw new ApiError(400, 'Password lama salah');
  }
  user.password = String(newPassword);
  await user.save();
  res.json({ success: true, message: 'Password berhasil diganti' });
});
