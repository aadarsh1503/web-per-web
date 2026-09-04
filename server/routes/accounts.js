import express from 'express';
import {
  getAllAccounts,
  addAccount,
  loginAccount,
  getActiveAccount,
  switchToNextAccount,
  recordUsage,
} from '../services/accountManager.js';
import Account from '../models/account.js';

const router = express.Router();

// GET /api/accounts — list all accounts
router.get('/', async (req, res) => {
  try {
    const accounts = await getAllAccounts();
    res.json(accounts);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/accounts — add new account
router.post('/', async (req, res) => {
  try {
    const { email, password, usageLimit } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    const account = await addAccount({ email, password, usageLimit });
    res.status(201).json({ _id: account._id, email: account.email, status: account.status });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE /api/accounts/:id — remove account
router.delete('/:id', async (req, res) => {
  try {
    await Account.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/accounts/:id/login — open browser, autofill, wait for user captcha
router.post('/:id/login', async (req, res) => {
  try {
    const account = await loginAccount(req.params.id);
    res.json({ success: true, email: account.email, status: account.status, lastLoginAt: account.lastLoginAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/accounts/:id/activate — set as active account
router.post('/:id/activate', async (req, res) => {
  try {
    // Deactivate all others
    await Account.updateMany({ status: 'active' }, { $set: { status: 'available' } });
    const account = await Account.findByIdAndUpdate(
      req.params.id,
      { status: 'active', $push: { switchHistory: { reason: 'manual_select' } } },
      { new: true, select: '-passwordEncrypted -sessionCookiesEncrypted' }
    );
    res.json(account);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/accounts/switch — auto switch to next available
router.post('/switch', async (req, res) => {
  try {
    const account = await switchToNextAccount(req.body.reason || 'manual');
    if (!account) return res.status(404).json({ error: 'No available accounts' });
    res.json({ _id: account._id, email: account.email, status: account.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/accounts/usage — record one usage tick on active account
router.post('/usage', async (req, res) => {
  try {
    const account = await recordUsage();
    res.json({ _id: account._id, email: account.email, usageCount: account.usageCount, status: account.status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/accounts/:id — update usageLimit or status
router.patch('/:id', async (req, res) => {
  try {
    const allowed = ['usageLimit', 'status'];
    const updates = {};
    for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
    const account = await Account.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      select: '-passwordEncrypted -sessionCookiesEncrypted',
    });
    res.json(account);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
