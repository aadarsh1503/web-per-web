import express from 'express';
import axios from 'axios';
import * as cheerio from 'cheerio';
import Account from '../models/account.js';
import { decrypt, encrypt } from '../services/crypto.js';

const router = express.Router();
const pendingLogins = new Map(); // token -> { accountId, email, password }

const MOOTHMARO = 'https://moothmaro.com';
const LOGIN_PATH = '/user/login/';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';

// ── helpers ──────────────────────────────────────────────────────────────────

function cookieHeader(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

function parseCookies(setCookieArr = []) {
  const jar = {};
  for (const c of setCookieArr) {
    const [pair] = c.split(';');
    const eq = pair.indexOf('=');
    if (eq > 0) jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return jar;
}

// ── routes ───────────────────────────────────────────────────────────────────

// POST /api/phone-login/prepare/:id  →  { token }
router.post('/prepare/:id', async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const password = decrypt(account.passwordEncrypted);
    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    pendingLogins.set(token, {
      accountId: account._id.toString(),
      email: account.email,
      password,
      cookieJar: {},       // session cookies from Moothmaro GET
      csrfToken: '',
    });
    setTimeout(() => pendingLogins.delete(token), 10 * 60 * 1000);
    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/phone-login/form/:token
// Fetches Moothmaro login page, injects autofill JS, serves on our domain
// reCAPTCHA loads from moothmaro.com domain via absolute src — works fine
router.get('/form/:token', async (req, res) => {
  const data = pendingLogins.get(req.params.token);
  if (!data) return res.status(410).send('<h2 style="font-family:sans-serif;padding:40px;color:red">Link expired. Try again.</h2>');

  try {
    const getResp = await axios.get(`${MOOTHMARO}${LOGIN_PATH}`, {
      headers: { 'User-Agent': UA },
      timeout: 10000,
    });

    // Store cookies from GET response
    const newCookies = parseCookies(getResp.headers['set-cookie']);
    data.cookieJar = { ...data.cookieJar, ...newCookies };
    data.csrfToken = newCookies.csrftoken || data.csrfToken;

    const $ = cheerio.load(getResp.data);

    // Fix all asset URLs to absolute moothmaro.com
    $('[src]').each((_, el) => {
      const src = $(el).attr('src');
      if (src && src.startsWith('/')) $(el).attr('src', MOOTHMARO + src);
    });
    $('[href]').each((_, el) => {
      const href = $(el).attr('href');
      if (href && href.startsWith('/')) $(el).attr('href', MOOTHMARO + href);
    });

    // Point form action to our submit endpoint
    $('form[method="post"]').attr('action', `/api/phone-login/submit/${req.params.token}`);

    // Autofill script + green banner
    $('body').prepend(`
      <div id="mmBanner" style="position:fixed;top:0;left:0;right:0;z-index:99999;
        background:#6366f1;color:#fff;font-size:14px;font-weight:700;
        text-align:center;padding:12px 16px;font-family:sans-serif;">
        ✅ Email &amp; Password filled — solve reCAPTCHA then tap Login
      </div>
      <div style="height:44px"></div>
    `);

    $('body').append(`<script>
      document.addEventListener('DOMContentLoaded', function() {
        var u = document.getElementById('id_username');
        var p = document.getElementById('id_password');
        if (u) { u.value = ${JSON.stringify(data.email)}; }
        if (p) { p.value = ${JSON.stringify(data.password)}; }
      });
    </script>`);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send($.html());
  } catch (err) {
    res.status(500).send(`<h3 style="font-family:sans-serif;padding:40px">Error: ${err.message}</h3>`);
  }
});

// POST /api/phone-login/submit/:token
// Receives the form submit (with reCAPTCHA token user solved),
// forwards to real Moothmaro, captures session cookies
router.post('/submit/:token', express.urlencoded({ extended: true }), async (req, res) => {
  const data = pendingLogins.get(req.params.token);
  if (!data) return res.status(410).send('<h2 style="font-family:sans-serif;padding:40px;color:red">Session expired.</h2>');

  try {
    const params = new URLSearchParams({
      csrfmiddlewaretoken: req.body.csrfmiddlewaretoken || data.csrfToken,
      username: data.email,
      password: data.password,
      'g-recaptcha-response': req.body['g-recaptcha-response'] || '',
    });

    const loginResp = await axios.post(`${MOOTHMARO}${LOGIN_PATH}`, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': UA,
        Cookie: cookieHeader(data.cookieJar),
        Referer: `${MOOTHMARO}${LOGIN_PATH}`,
        Origin: MOOTHMARO,
      },
      maxRedirects: 5,
      validateStatus: () => true,
      timeout: 15000,
    });

    const respCookies = parseCookies(loginResp.headers['set-cookie']);
    const sessionId = respCookies.sessionid;

    if (!sessionId) {
      // Login failed — re-show login form with error
      return res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8">
        <meta name="viewport" content="width=device-width,initial-scale=1">
        <style>body{font-family:sans-serif;background:#0a0a0f;color:#fff;display:flex;
          flex-direction:column;align-items:center;justify-content:center;min-height:100vh;
          gap:16px;padding:24px;text-align:center}
          .err{background:#2d0a0a;border:1px solid #ef4444;color:#fca5a5;padding:14px 20px;
               border-radius:12px;font-size:14px}
          a{color:#6366f1;font-size:15px}</style></head><body>
        <div class="err">❌ Login failed — wrong credentials or reCAPTCHA expired</div>
        <a href="/api/phone-login/form/${req.params.token}">← Try Again</a>
      </body></html>`);
    }

    // Save session to MongoDB
    const account = await Account.findById(data.accountId);
    if (account) {
      const allCookies = { ...data.cookieJar, ...respCookies };
      const cookieArr = Object.entries(allCookies).map(([name, value]) => ({ name, value }));
      account.sessionCookiesEncrypted = encrypt(JSON.stringify(cookieArr));
      account.lastLoginAt = new Date();
      account.status = account.status === 'needs_auth' ? 'available' : account.status;
      await account.save();
    }

    pendingLogins.delete(req.params.token);

    // Show success page
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8">
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <style>*{box-sizing:border-box;margin:0;padding:0}
        body{background:#0a0a0f;color:#e2e8f0;font-family:system-ui,sans-serif;
             display:flex;flex-direction:column;align-items:center;justify-content:center;
             min-height:100vh;gap:20px;padding:24px;text-align:center}
        h2{color:#fff;font-size:22px} p{color:#6ee7b7;font-size:14px}
        .close-btn{padding:14px 32px;background:#6366f1;color:#fff;border:none;
                   border-radius:14px;font-size:16px;font-weight:700;cursor:pointer;margin-top:8px}</style>
      </head><body>
      <div style="font-size:72px">✅</div>
      <h2>Login Successful!</h2>
      <p>Session saved. Dashboard updated.</p>
      <button class="close-btn" onclick="window.close()">Close Tab</button>
      <script>
        // Also notify opener/dashboard if possible
        if (window.opener) { try { window.opener.postMessage('mm_login_done', '*'); } catch(e){} }
        setTimeout(function(){ window.close(); }, 3000);
      </script>
    </body></html>`);
  } catch (err) {
    res.status(500).send(`<h3 style="font-family:sans-serif;padding:40px;color:red">Error: ${err.message}</h3>`);
  }
});

export default router;
