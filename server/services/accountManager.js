import Account from '../models/account.js';
import { encrypt, decrypt } from './crypto.js';
import { loginWithBrowser } from './puppeteerLogin.js';

// Cooldown duration: 24 hours (adjust per Moothmaro's actual rules)
const COOLDOWN_HOURS = 24;

/** Get the current active account */
export const getActiveAccount = async () => {
  return Account.findOne({ status: 'active' });
};

/** Get next available account (not in cooldown, not active already) */
export const getNextAvailableAccount = async () => {
  const now = new Date();
  // First: auto-recover any accounts whose cooldown has expired
  await Account.updateMany(
    { status: 'cooldown', cooldownUntil: { $lte: now } },
    { $set: { status: 'available', cooldownUntil: null, usageCount: 0 } }
  );
  return Account.findOne({ status: 'available', sessionCookiesEncrypted: { $ne: null } });
};

/** Switch to next available account */
export const switchToNextAccount = async (reason = 'quota_reached') => {
  // Deactivate current active account
  const current = await getActiveAccount();
  if (current) {
    const cooldownUntil = new Date(Date.now() + COOLDOWN_HOURS * 60 * 60 * 1000);
    current.status = reason === 'quota_reached' ? 'cooldown' : 'available';
    current.cooldownUntil = reason === 'quota_reached' ? cooldownUntil : null;
    current.switchHistory.push({ reason });
    await current.save();
  }

  const next = await getNextAvailableAccount();
  if (!next) return null;

  next.status = 'active';
  next.switchHistory.push({ reason: 'auto_selected' });
  await next.save();
  return next;
};

/** Mark usage on active account, auto-switch if quota reached */
export const recordUsage = async () => {
  const account = await getActiveAccount();
  if (!account) throw new Error('No active account');

  account.usageCount += 1;
  if (account.usageCount >= account.usageLimit) {
    return switchToNextAccount('quota_reached');
  }

  await account.save();
  return account;
};

/** Trigger browser login for a specific account */
export const loginAccount = async (accountId) => {
  const account = await Account.findById(accountId);
  if (!account) throw new Error('Account not found');

  const cookies = await loginWithBrowser(account);
  const cookiesJson = JSON.stringify(cookies);

  account.sessionCookiesEncrypted = encrypt(cookiesJson);
  account.lastLoginAt = new Date();
  if (account.status === 'needs_auth') {
    account.status = 'available';
  }
  await account.save();
  return account;
};

/** Add a new account */
export const addAccount = async ({ email, password, usageLimit = 100 }) => {
  const existing = await Account.findOne({ email });
  if (existing) throw new Error('Account with this email already exists');

  const account = new Account({
    email,
    passwordEncrypted: encrypt(password),
    usageLimit,
    status: 'available',
  });
  await account.save();
  return account;
};

/** Get all accounts (safe, no decrypted data) */
export const getAllAccounts = async () => {
  return Account.find({}, '-passwordEncrypted -sessionCookiesEncrypted').lean();
};
