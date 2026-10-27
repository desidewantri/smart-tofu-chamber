const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // Wajib untuk akun email biasa; boleh kosong untuk akun yang dibuat lewat Google.
    password: {
      type: String,
      minlength: 6,
      select: false,
      required() {
        return !this.googleId;
      },
    },
    hasPassword: { type: Boolean, default: true },
    googleId: { type: String, default: undefined, index: { unique: true, sparse: true } },
    avatarUrl: { type: String, default: null },
    role: { type: String, enum: ['admin', 'operator'], default: 'operator' },
    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true }
);

userSchema.pre('save', async function () {
  if (this.isModified('password') && this.password) {
    this.password = await bcrypt.hash(this.password, 10);
    this.hasPassword = true;
  }
  if (this.isNew && !this.password) this.hasPassword = false;
});

userSchema.methods.comparePassword = function (plain) {
  if (!this.password) return Promise.resolve(false);
  return bcrypt.compare(plain, this.password);
};

userSchema.set('toJSON', {
  transform: (_doc, ret) => {
    delete ret.password;
    delete ret.googleId;
    delete ret.__v;
    if (ret.hasPassword === undefined) ret.hasPassword = true;
    return ret;
  },
});

module.exports = mongoose.model('User', userSchema);
