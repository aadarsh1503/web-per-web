import express from 'express';
import Account from '../models/account.js';
import { encrypt } from '../services/crypto.js';

const router = express.Router();
const pendingLogins = new Map(); // token -> { accountId, email }

const BACKEND = process.env.BACKEND_URL || 'https://web-per-web.onrender.com';

// POST /api/phone-login/prepare/:id  →  { token }
router.post('/prepare/:id', async (req, res) => {
  try {
    const account = await Account.findById(req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
    pendingLogins.set(token, { accountId: account._id.toString(), email: account.email });
    setTimeout(() => pendingLogins.delete(token), 10 * 60 * 1000);

    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/phone-login/form/:token
// Step 1: Show instructions + open moothmaro login in iframe/redirect
router.get('/form/:token', (req, res) => {
  const data = pendingLogins.get(req.params.token);
  if (!data)
    return res.status(410).send('<h2 style="font-family:sans-serif;padding:40px;color:red">Link expired.</h2>');

  const cookiePostUrl = `${BACKEND}/api/phone-login/save-cookies/${req.params.token}`;

  // After user logs in on moothmaro, they come to our /done/:token page
  // which reads document.cookie and posts to our server
  const doneUrl = `${BACKEND}/api/phone-login/done/${req.params.token}`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Login – Moothmaro</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{background:#0a0a0f;color:#e2e8f0;font-family:system-ui,sans-serif;
         display:flex;flex-direction:column;align-items:center;
         min-height:100vh;gap:16px;padding:24px 20px;text-align:center}
    h2{color:#fff;font-size:20px;margin-top:8px}
    .chip{background:#1e293b;padding:8px 16px;border-radius:8px;font-size:13px;
          color:#6ee7b7;word-break:break-all;max-width:320px}
    .card{background:#111827;border-radius:14px;padding:18px 20px;
          width:100%;max-width:360px;text-align:left}
    .step{padding:8px 0;font-size:14px;color:#cbd5e1;
          border-bottom:1px solid #1e293b;display:flex;gap:10px;align-items:flex-start}
    .step:last-child{border:none}
    .btn{padding:15px 24px;background:#6366f1;color:#fff;border:none;border-radius:14px;
         font-size:15px;font-weight:700;cursor:pointer;text-decoration:none;
         display:block;width:100%;max-width:360px}
    .btn.green{background:#10b981}
    #status{font-size:13px;min-height:18px}
  </style>
</head>
<body>
  <div style="font-size:48px">🔑</div>
  <h2>Login to Moothmaro</h2>
  <div class="chip">${data.email}</div>

  <div class="card">
    <div class="step"><span>1️⃣</span><span>Tap "Open Login Page" below</span></div>
    <div class="step"><span>2️⃣</span><span>Login with your email & password, solve the captcha</span></div>
    <div class="step"><span>3️⃣</span><span>After login, you'll be redirected back automatically</span></div>
  </div>

  <a class="btn" id="loginBtn"
     href="https://moothmaro.com/user/login/?next=${encodeURIComponent(doneUrl)}"
     target="_self">
    Open Login Page
  </a>

  <p id="status" style="color:#94a3b8"></p>
</body>
</html>`);
});

// GET /api/phone-login/done/:token
// Moothmaro redirects here after login (via ?next= param)
// We read cookies via JS and POST them to our server
router.get('/done/:token', (req, res) => {
  const data = pendingLogins.get(req.params.token);
  if (!data)
    return res.status(410).send('<h2 style="font-family:sans-serif;padding:40px;color:red">Session expired.</h2>');

  const saveUrl = `${BACKEND}/api/phone-login/save-cookies/${req.params.token}`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Saving session...</title>
  <style>
    body{background:#0a0a0f;color:#e2e8f0;font-family:system-ui,sans-serif;
         display:flex;flex-direction:column;align-items:center;justify-content:center;
         min-height:100vh;gap:16px;padding:24px;text-align:center}
    h2{color:#fff;font-size:20px}
    .spin{width:40px;height:40px;border:3px solid #1e293b;
          border-top-color:#6366f1;border-radius:50%;animation:s 0.8s linear infinite}
    @keyframes s{to{transform:rotate(360deg)}}
  </style>
</head>
<body>
  <div class="spin"></div>
  <h2 id="msg">Saving your session...</h2>
  <p id="sub" style="color:#94a3b8;font-size:14px"></p>

  <script>
    (async function() {
      // Read all cookies available on moothmaro.com domain
      // Note: httpOnly cookies won't be readable via JS — sessionid may be httpOnly
      // We collect what we can + send a signal to backend
      const cookieStr = document.cookie;
      const cookies = cookieStr.split(';').map(c => {
        const [name, ...rest] = c.trim().split('=');
        return { name: name.trim(), value: rest.join('=').trim() };
      }).filter(c => c.name);

      try {
        const resp = await fetch('${saveUrl}', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cookies, cookieStr }),
        });
        const d = await resp.json();
        if (d.success) {
          document.getElementById('msg').textContent = '✅ Login Successful!';
          document.getElementById('sub').textContent = 'Session saved. You can close this tab.';
          document.getElementById('sub').style.color = '#6ee7b7';
          if (window.opener) { try { window.opener.postMessage('mm_login_done', '*'); } catch(e){} }
          setTimeout(() => window.close(), 2500);
        } else {
          document.getElementById('msg').textContent = '❌ ' + (d.error || 'Failed');
          document.getElementById('msg').style.color = '#fca5a5';
        }
      } catch(e) {
        document.getElementById('msg').textContent = '❌ Error: ' + e.message;
        document.getElementById('msg').style.color = '#fca5a5';
      }
    })();
  </script>
</body>
</html>`);
});

// POST /api/phone-login/save-cookies/:token
// Receives cookies from the /done page JS
router.post('/save-cookies/:token', express.json(), async (req, res) => {
  const data = pendingLogins.get(req.params.token);
  if (!data) return res.status(410).json({ error: 'Session expired' });

  try {
    const { cookies = [], cookieStr = '' } = req.body;

    // Check for sessionid — may not be present if httpOnly
    const sessionCookie = cookies.find(c => c.name === 'sessionid');
    const csrfCookie = cookies.find(c => c.name === 'csrftoken');

    // Even if sessionid is httpOnly (not in JS cookies), csrftoken presence
    // means user reached moothmaro post-login page — mark as logged in
    if (!sessionCookie && !csrfCookie) {
      return res.status(401).json({
        error: 'No login cookies found. Make sure you completed login on Moothmaro.',
      });
    }

    const account = await Account.findById(data.accountId);
    if (account) {
      if (cookies.length > 0) {
        account.sessionCookiesEncrypted = encrypt(JSON.stringify(cookies));
      }
      account.lastLoginAt = new Date();
      if (account.status === 'needs_auth') account.status = 'available';
      await account.save();
    }

    pendingLogins.delete(req.params.token);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
