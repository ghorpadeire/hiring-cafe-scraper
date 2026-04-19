'use strict';

const { spawn } = require('child_process');
const WebSocket  = require('ws');
const http       = require('http');
const os         = require('os');
const path       = require('path');
const fs         = require('fs');

const DEBUG_PORT = 9223;

const BROWSER_PATHS = {
  win32: [
    'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  ],
  darwin: [
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ],
  linux: ['google-chrome', 'chromium-browser', 'brave-browser', 'chromium'],
};

function findBrowser() {
  const candidates = BROWSER_PATHS[process.platform] || BROWSER_PATHS.linux;
  for (const p of candidates) {
    try {
      fs.accessSync(p);
      return p;
    } catch { /* not found */ }
  }
  return null;
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch { reject(new Error('Invalid JSON from debug endpoint')); }
      });
    }).on('error', reject);
  });
}

async function waitForDebugEndpoint(retries = 15) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fetchJson(`http://localhost:${DEBUG_PORT}/json`);
    } catch {
      await new Promise(r => setTimeout(r, 500));
    }
  }
  throw new Error(`Chrome debug endpoint not ready after ${retries} attempts`);
}

/**
 * Scrape hiring.cafe API pages via raw Chrome DevTools Protocol.
 * No Playwright → no navigator.webdriver injection → CF treats it as a real browser.
 *
 * @param {string} jobsUrl
 * @param {object[]} payloads
 * @returns {Promise<object[]>}
 */
async function batchViaLocalBrowser(jobsUrl, payloads) {
  const browserPath = findBrowser();
  if (!browserPath) {
    throw new Error(
      'No Chrome/Brave browser found on this machine.\n' +
      '  Install Chrome or Brave, or add APIFY_TOKEN to use the cloud fallback.'
    );
  }

  const tmpDir = path.join(os.tmpdir(), `hcs-chrome-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });

  const browser = spawn(
    browserPath,
    [
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--user-data-dir=${tmpDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-extensions',
      '--disable-breakpad',
      '--disable-component-update',
      '--disable-domain-reliability',
      '--disable-features=TranslateUI',
      '--disable-hang-monitor',
      '--disable-prompt-on-repost',
      '--password-store=basic',
      '--use-mock-keychain',
      '--metrics-recording-only',
      '--safebrowsing-disable-auto-update',
      '--window-size=1280,800',
      // No --headless flag: visible browser has no headless-detection markers
    ],
    { detached: false, stdio: 'ignore' }
  );

  let ws, cleanup;
  try {
    const tabs = await waitForDebugEndpoint();
    const tab  = tabs.find(t => t.type === 'page');
    if (!tab) throw new Error('No page tab found in Chrome debug endpoint');

    ws = new WebSocket(tab.webSocketDebuggerUrl);
    let msgId = 0;
    const pending = new Map();

    const eventListeners = new Map();

    ws.on('message', raw => {
      const msg = JSON.parse(raw);
      // Command responses
      const cb = pending.get(msg.id);
      if (cb) { pending.delete(msg.id); cb(msg); }
      // CDP events
      if (msg.method) {
        const listeners = eventListeners.get(msg.method) || [];
        for (const fn of listeners) fn(msg.params);
      }
    });

    const onceEvent = method => new Promise(res => {
      const handler = params => {
        const arr = eventListeners.get(method) || [];
        eventListeners.set(method, arr.filter(f => f !== handler));
        res(params);
      };
      eventListeners.set(method, [...(eventListeners.get(method) || []), handler]);
    });

    cleanup = () => {
      try { ws.close(); } catch {}
      try { browser.kill(); } catch {}
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    };

    await new Promise((res, rej) => {
      ws.once('open', res);
      ws.once('error', rej);
    });

    const send = (method, params = {}) => new Promise((res, rej) => {
      const id = ++msgId;
      const timer = setTimeout(() => {
        pending.delete(id);
        rej(new Error(`CDP command ${method} timed out`));
      }, 30000);
      pending.set(id, msg => {
        clearTimeout(timer);
        if (msg.error) rej(new Error(`CDP error: ${msg.error.message}`));
        else res(msg.result);
      });
      ws.send(JSON.stringify({ id, method, params }));
    });

    await send('Page.enable');
    await send('Runtime.enable');

    // Navigate to hiring.cafe — set up load listener BEFORE navigating
    const loadFired = onceEvent('Page.loadEventFired');
    await send('Page.navigate', { url: 'https://hiring.cafe' });

    // Wait for initial page load (up to 30 s) then start polling title
    await Promise.race([loadFired, new Promise(r => setTimeout(r, 30000))]);

    // Poll until CF challenge is gone (up to 60 s additional)
    let cleared = false;
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const { result } = await send('Runtime.evaluate', {
        expression: 'document.title',
        returnByValue: true,
      });
      const title = (result && result.value) || '';
      if (!title.includes('Just a moment') && !title.includes('Checking') && title.length > 3) {
        cleared = true;
        break;
      }
    }

    await new Promise(r => setTimeout(r, 1000));

    // Batch API calls from within the browser context (same origin → CF cookies are included)
    const results = [];
    for (let i = 0; i < payloads.length; i++) {
      const expr = `(async () => {
        try {
          const res = await fetch(${JSON.stringify(jobsUrl)}, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': '*/*',
              'Origin': 'https://hiring.cafe',
              'Referer': 'https://hiring.cafe/',
            },
            body: JSON.stringify(${JSON.stringify(payloads[i])}),
            credentials: 'include',
          });
          if (!res.ok) return JSON.stringify({ error: 'HTTP ' + res.status });
          const data = await res.json();
          return JSON.stringify({ data });
        } catch(e) {
          return JSON.stringify({ error: e.message });
        }
      })()`;

      const { result } = await send('Runtime.evaluate', {
        expression: expr,
        awaitPromise: true,
        returnByValue: true,
      });

      try { results.push(JSON.parse(result.value)); }
      catch { results.push({ error: 'Failed to parse response' }); }

      if (i < payloads.length - 1) await new Promise(r => setTimeout(r, 400));
    }

    return results;
  } finally {
    if (cleanup) cleanup();
  }
}

module.exports = { batchViaLocalBrowser, findBrowser };
