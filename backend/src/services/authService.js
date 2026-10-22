const { OAuth2Client } = require('google-auth-library');
const env = require('../config/env');
const ApiError = require('../utils/ApiError');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validasi isian pendaftaran. Mengembalikan data yang sudah dirapikan. */
function validateRegistration(body = {}) {
  const name = String(body.name || '').trim();
  const email = String(body.email || '').toLowerCase().trim();
  const password = String(body.password || '');
  if (name.length < 2) throw new ApiError(400, 'Nama minimal 2 karakter');
  if (name.length > 80) throw new ApiError(400, 'Nama maksimal 80 karakter');
  if (!EMAIL_RE.test(email)) throw new ApiError(400, 'Format email tidak valid');
  if (password.length < 8) throw new ApiError(400, 'Kata sandi minimal 8 karakter');
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new ApiError(400, 'Kata sandi harus berisi huruf dan angka');
  }
  return { name, email, password };
}

let client = null;
/**
 * Verifikasi ID token dari tombol "Masuk dengan Google" (Google Identity Services).
 * Mengembalikan { googleId, email, name, avatarUrl }.
 */
async function verifyGoogleCredential(credential, verifier) {
  if (!env.auth.googleClientId) throw new ApiError(400, 'Masuk dengan Google belum diaktifkan di server');
  if (!credential) throw new ApiError(400, 'Token Google tidak ada');
  let payload;
  try {
    if (verifier) {
      payload = await verifier(credential);
    } else {
      client = client || new OAuth2Client(env.auth.googleClientId);
      const ticket = await client.verifyIdToken({ idToken: credential, audience: env.auth.googleClientId });
      payload = ticket.getPayload();
    }
  } catch {
    throw new ApiError(401, 'Token Google tidak valid atau sudah kedaluwarsa');
  }
  if (!payload || !payload.sub || !payload.email) throw new ApiError(401, 'Token Google tidak valid atau sudah kedaluwarsa');
  if (payload.email_verified === false) throw new ApiError(401, 'Email Google belum terverifikasi');
  return {
    googleId: String(payload.sub),
    email: String(payload.email).toLowerCase(),
    name: payload.name || String(payload.email).split('@')[0],
    avatarUrl: payload.picture || null,
  };
}

module.exports = { validateRegistration, verifyGoogleCredential, EMAIL_RE };
