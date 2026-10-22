const jwt = require('jsonwebtoken');
const env = require('../config/env');
const User = require('../models/User');
const ApiError = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { validateRegistration, verifyGoogleCredential } = require('../services/authService');

const sign = (user, remember) =>
  jwt.sign({ id: user._id }, env.jwtSecret, { expiresIn: remember ? '30d' : env.jwtExpiresIn });

exports.login = asyncHandler(async (req, res) => {
  const { email, password, remember } = req.body || {};
  if (!email || !password) throw new ApiError(400, 'Email dan kata sandi wajib diisi');
  const user = await User.findOne({ email: String(email).toLowerCase().trim() }).select('+password');
  if (user && !user.hasPassword && !user.password) {
    throw new ApiError(401, 'Akun ini belum punya kata sandi. Masuk dengan Google, lalu buat kata sandi di Pengaturan > Akun.');
  }
  if (!user || !(await user.comparePassword(String(password)))) {
    throw new ApiError(401, 'Email atau kata sandi salah');
  }
  user.lastLoginAt = new Date();
  await user.save();
  res.json({ success: true, data: { token: sign(user, Boolean(remember)), user } });
});

/** GET /api/auth/config : pengaturan halaman masuk (publik). */
exports.config = (_req, res) => {
  res.json({
    success: true,
    data: { allowRegistration: env.auth.allowRegistration, googleClientId: env.auth.googleClientId || null },
  });
};

/** POST /api/auth/register : buat akun baru (email + kata sandi), langsung masuk. */
exports.register = asyncHandler(async (req, res) => {
  if (!env.auth.allowRegistration) throw new ApiError(403, 'Pendaftaran akun baru sedang ditutup. Hubungi admin.');
  const data = validateRegistration(req.body);
  if (await User.exists({ email: data.email })) throw new ApiError(409, 'Email sudah terdaftar. Silakan masuk.');
  const user = await User.create({ ...data, role: 'operator', lastLoginAt: new Date() });
  res.status(201).json({ success: true, message: 'Akun berhasil dibuat', data: { token: sign(user, true), user } });
});

/** POST /api/auth/google : masuk/daftar dengan akun Google. */
exports.google = asyncHandler(async (req, res) => {
  const g = await verifyGoogleCredential(req.body?.credential);
  let user = await User.findOne({ googleId: g.googleId });
  if (!user) {
    user = await User.findOne({ email: g.email });
    if (user) {
      // Email sudah terdaftar dengan kata sandi -> tautkan ke akun Google yang sama.
      user.googleId = g.googleId;
      if (!user.avatarUrl) user.avatarUrl = g.avatarUrl;
    } else {
      if (!env.auth.allowRegistration) throw new ApiError(403, 'Pendaftaran akun baru sedang ditutup. Hubungi admin.');
      user = new User({ name: g.name, email: g.email, googleId: g.googleId, avatarUrl: g.avatarUrl, hasPassword: false, role: 'operator' });
    }
  }
  user.lastLoginAt = new Date();
  await user.save();
  res.json({ success: true, data: { token: sign(user, true), user } });
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
    const next = String(email).toLowerCase().trim();
    if (next !== req.user.email && (await User.exists({ email: next }))) throw new ApiError(409, 'Email sudah dipakai akun lain');
    req.user.email = next;
  }
  await req.user.save();
  res.json({ success: true, message: 'Profil diperbarui', data: { user: req.user } });
});

exports.changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const user = await User.findById(req.user._id).select('+password');
  const needsCurrent = Boolean(user.password);
  if (!newPassword || (needsCurrent && !currentPassword)) throw new ApiError(400, 'Kata sandi lama dan baru wajib diisi');
  if (String(newPassword).length < 8) throw new ApiError(400, 'Kata sandi baru minimal 8 karakter');
  if (needsCurrent && !(await user.comparePassword(String(currentPassword)))) {
    throw new ApiError(400, 'Kata sandi lama salah');
  }
  user.password = String(newPassword);
  await user.save();
  res.json({ success: true, message: needsCurrent ? 'Kata sandi berhasil diganti' : 'Kata sandi berhasil dibuat', data: { user } });
});
