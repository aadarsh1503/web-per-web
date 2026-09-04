import mongoose from 'mongoose';

const switchHistorySchema = new mongoose.Schema({
  switchedAt: { type: Date, default: Date.now },
  reason: String,
}, { _id: false });

const accountSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  // AES-256 encrypted: iv:encryptedData
  passwordEncrypted: { type: String, required: true },
  status: {
    type: String,
    enum: ['available', 'active', 'cooldown', 'needs_auth'],
    default: 'available',
  },
  usageCount: { type: Number, default: 0 },
  usageLimit: { type: Number, default: 100 },
  cooldownUntil: { type: Date, default: null },
  // Encrypted session cookies from Moothmaro after login
  sessionCookiesEncrypted: { type: String, default: null },
  lastLoginAt: { type: Date, default: null },
  switchHistory: [switchHistorySchema],
}, { timestamps: true });

export default mongoose.model('Account', accountSchema);
