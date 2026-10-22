const test = require('node:test');
const assert = require('node:assert/strict');
const env = require('../src/config/env');
const { validateRegistration, verifyGoogleCredential } = require('../src/services/authService');

test('validateRegistration merapikan dan menerima data yang benar', () => {
  const d = validateRegistration({ name: '  Des  ', email: ' Des@Mail.COM ', password: 'tahu1234' });
  assert.deepEqual(d, { name: 'Des', email: 'des@mail.com', password: 'tahu1234' });
});

test('validateRegistration menolak data yang salah', () => {
  assert.throws(() => validateRegistration({ name: 'D', email: 'a@b.co', password: 'tahu1234' }), /Nama minimal/);
  assert.throws(() => validateRegistration({ name: 'Des', email: 'bukan-email', password: 'tahu1234' }), /email tidak valid/);
  assert.throws(() => validateRegistration({ name: 'Des', email: 'a@b.co', password: 'pendek1' }), /minimal 8/);
  assert.throws(() => validateRegistration({ name: 'Des', email: 'a@b.co', password: 'hanyahuruf' }), /huruf dan angka/);
});

test('verifyGoogleCredential: nonaktif jika GOOGLE_CLIENT_ID kosong', async () => {
  const old = env.auth.googleClientId;
  env.auth.googleClientId = '';
  await assert.rejects(verifyGoogleCredential('x'), /belum diaktifkan/);
  env.auth.googleClientId = old;
});

test('verifyGoogleCredential: memetakan payload dan menolak email belum terverifikasi', async () => {
  const old = env.auth.googleClientId;
  env.auth.googleClientId = 'test-client.apps.googleusercontent.com';
  const ok = await verifyGoogleCredential('tok', async () => ({
    sub: '123', email: 'Des@Gmail.com', email_verified: true, name: 'Des', picture: 'https://x/p.png',
  }));
  assert.deepEqual(ok, { googleId: '123', email: 'des@gmail.com', name: 'Des', avatarUrl: 'https://x/p.png' });
  await assert.rejects(
    verifyGoogleCredential('tok', async () => ({ sub: '1', email: 'a@b.co', email_verified: false })),
    /belum terverifikasi/
  );
  await assert.rejects(verifyGoogleCredential('tok', async () => { throw new Error('bad'); }), /tidak valid/);
  env.auth.googleClientId = old;
});
