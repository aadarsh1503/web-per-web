import puppeteer from 'puppeteer';
import { decrypt } from './crypto.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

const LOGIN_URL = 'https://moothmaro.com/user/login/';
const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

export const loginWithBrowser = async (account) => {
  const password = decrypt(account.passwordEncrypted);

  // Fresh temp dir — no conflict with your running Chrome at all
  const tmpDir = path.join(os.tmpdir(), `mmtro_${Date.now()}`);
  fs.mkdirSync(path.join(tmpDir, 'Default'), { recursive: true });

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    executablePath: CHROME_PATH,
    userDataDir: tmpDir,
    args: [
      '--profile-directory=Default',
      '--start-maximized',
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-extensions',
      '--disable-popup-blocking',
    ],
  });

  const [page] = await browser.pages();

  await page.evaluateOnNewDocument(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  await page.goto(LOGIN_URL, { waitUntil: 'networkidle2', timeout: 30000 });

  // Fill email
  await page.waitForSelector('#id_username', { visible: true, timeout: 15000 });
  await page.click('#id_username', { clickCount: 3 });
  await page.type('#id_username', account.email, { delay: 60 });

  // Fill password
  await page.waitForSelector('#id_password', { visible: true });
  await page.click('#id_password', { clickCount: 3 });
  await page.type('#id_password', password, { delay: 60 });

  // Green banner
  await page.evaluate(() => {
    document.title = '✅ Solve reCAPTCHA then click Login';
    const hint = document.createElement('div');
    hint.innerText = '👆 Email & Password filled! Please solve reCAPTCHA and click Login.';
    hint.style.cssText = `
      position:fixed;top:0;left:0;right:0;z-index:99999;
      background:#10b981;color:#fff;font-size:16px;font-weight:bold;
      text-align:center;padding:12px;font-family:sans-serif;
    `;
    document.body.prepend(hint);
  });

  // Wait for user to solve captcha and login
  try {
    await page.waitForFunction(
      () => !window.location.pathname.includes('/user/login/'),
      { timeout: 5 * 60 * 1000 }
    );
  } catch {
    await browser.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    throw new Error('Login timed out — reCAPTCHA not completed within 5 minutes.');
  }

  const cookies = await page.cookies();
  await browser.close();
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }

  return cookies;
};

export const makeAuthRequest = async (cookiesJson, url, options = {}) => {
  const { default: axios } = await import('axios');
  const cookies = JSON.parse(cookiesJson);
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

  return axios.get(url, {
    ...options,
    headers: {
      Cookie: cookieHeader,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      ...(options.headers || {}),
    },
    withCredentials: true,
  });
};
