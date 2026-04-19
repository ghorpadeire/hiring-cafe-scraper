'use strict';

const http  = require('http');
const https = require('https');
const { ApifyClient } = require('apify-client');

const BASE_URL  = 'https://hiring.cafe';
const PROXY_HOST = 'proxy.apify.com';
const PROXY_PORT = 8000;

const BROWSER_HEADERS = {
  'Accept':          '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Content-Type':    'application/json',
  'Origin':          BASE_URL,
  'Referer':         BASE_URL + '/',
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'sec-ch-ua':       '"Chromium";v="124", "Google Chrome";v="124"',
  'sec-ch-ua-mobile':   '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest':  'empty',
  'sec-fetch-mode':  'cors',
  'sec-fetch-site':  'same-origin',
};

function isCloudflareBlock(status, body) {
  return status === 403 && (body.includes('Just a moment') || body.includes('cf_chl') || body.includes('Cloudflare'));
}

/**
 * Direct POST — works on residential IPs. Returns parsed JSON or throws.
 */
async function postDirect(url, payload, cfCookie) {
  const body = JSON.stringify(payload);
  const parsed = new URL(url);
  const extraHeaders = cfCookie ? { Cookie: `cf_clearance=${cfCookie}` } : {};

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: parsed.hostname,
      port:     443,
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers:  { ...BROWSER_HEADERS, ...extraHeaders, 'Content-Length': Buffer.byteLength(body) },
    });

    req.setTimeout(30000, () => req.destroy(new Error('Request timeout')));

    req.on('response', res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (isCloudflareBlock(res.statusCode, data)) {
          return reject(Object.assign(new Error('CLOUDFLARE_BLOCKED'), { isCloudflare: true }));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0, 200)}`));
        }
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error('Invalid JSON: ' + data.substring(0, 200))); }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * POST via Apify Residential Proxy — bypasses Cloudflare Turnstile.
 * Requires a valid APIFY_TOKEN with proxy access.
 */
function getProxyUser(proxyGroup) {
  // Apify proxy username conventions:
  // 'auto'        → shared datacenter (free tier)
  // 'groups-RESIDENTIAL' → residential IPs (paid)
  if (!proxyGroup || proxyGroup.toUpperCase() === 'DATACENTER') return 'auto';
  if (proxyGroup.startsWith('groups-')) return proxyGroup;
  return `groups-${proxyGroup}`;
}

function postViaProxy(url, payload, apifyToken, proxyGroup = 'RESIDENTIAL') {
  const body    = JSON.stringify(payload);
  const target  = new URL(url);
  const proxyUser = getProxyUser(proxyGroup);
  const proxyAuth = Buffer.from(`${proxyUser}:${apifyToken}`).toString('base64');

  return new Promise((resolve, reject) => {
    const connect = http.request({
      host:   PROXY_HOST,
      port:   PROXY_PORT,
      method: 'CONNECT',
      path:   `${target.hostname}:443`,
      headers: {
        'Proxy-Authorization': `Basic ${proxyAuth}`,
        'User-Agent': BROWSER_HEADERS['User-Agent'],
      }
    });

    connect.setTimeout(20000, () => connect.destroy(new Error('Proxy CONNECT timeout')));

    connect.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        return reject(new Error(`Proxy CONNECT failed: ${res.statusCode} ${res.statusMessage}`));
      }

      const agent = new https.Agent({ socket, keepAlive: false });
      const req = https.request({
        hostname: target.hostname,
        port:     443,
        path:     target.pathname + target.search,
        method:   'POST',
        agent,
        headers:  { ...BROWSER_HEADERS, 'Content-Length': Buffer.byteLength(body) },
      });

      req.setTimeout(30000, () => req.destroy(new Error('Request timeout through proxy')));

      req.on('response', response => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          if (isCloudflareBlock(response.statusCode, data)) {
            return reject(new Error('Cloudflare blocked even through proxy. Your Apify plan may not include RESIDENTIAL proxies.'));
          }
          if (response.statusCode !== 200) {
            return reject(new Error(`HTTP ${response.statusCode}: ${data.substring(0, 200)}`));
          }
          try { resolve(JSON.parse(data)); }
          catch { reject(new Error('Invalid JSON: ' + data.substring(0, 200))); }
        });
      });

      req.on('error', reject);
      req.write(body);
      req.end();
    });

    connect.on('error', reject);
    connect.end();
  });
}

/**
 * Smart POST: tries direct first, falls back to Apify proxy if Cloudflare blocked.
 * Returns { data, usedProxy }.
 */
async function post(url, payload, options = {}) {
  const { apifyToken, proxyGroup = 'RESIDENTIAL', skipDirect = false, cfCookie } = options;

  if (!skipDirect) {
    try {
      const data = await postDirect(url, payload, cfCookie);
      return { data, usedProxy: false };
    } catch (err) {
      if (!err.isCloudflare) throw err;
      // Cloudflare detected — fall through to proxy
    }
  }

  if (!apifyToken) {
    const err = new Error(
      'Cloudflare blocked the direct request.\n\n' +
      '  This usually happens on cloud/datacenter IPs (VPS, GitHub Actions).\n' +
      '  On home internet it typically works without a proxy.\n\n' +
      '  To bypass: add your Apify token to .env:\n' +
      '    APIFY_TOKEN=apify_api_...\n\n' +
      '  Get a free token at: https://console.apify.com/account/integrations\n' +
      '  Note: Cloudflare bypass requires Apify\'s RESIDENTIAL proxy plan.'
    );
    err.isCloudflare = true;
    throw err;
  }

  const data = await postViaProxy(url, payload, apifyToken, proxyGroup);
  return { data, usedProxy: true };
}

/**
 * Batch-fetch multiple API pages via an Apify playwright-scraper actor run.
 * The actor navigates to hiring.cafe (Cloudflare auto-clears inside Apify),
 * then makes all the fetch() calls from within the browser and returns results.
 *
 * @param {string} jobsUrl   - The /api/search-jobs endpoint
 * @param {object[]} payloads - Array of page payloads to fetch in one actor run
 * @param {string} apifyToken
 * @returns {Promise<object[]>} - Array of API responses (one per payload)
 */
async function batchViaApifyActor(jobsUrl, payloads, apifyToken) {
  const client = new ApifyClient({ token: apifyToken });

  // Navigate to a neutral page first so Crawlee's 403-block detection doesn't fire on CF.
  // Then inside pageFunction we explicitly goto hiring.cafe with waitUntil:'load',
  // which lets the CF JS challenge run and resolve before we make API calls.
  const pageFunction = /* js */`
    async ({ page, request, log }) => {
      const { jobsUrl, payloads } = request.userData;

      log.info('Navigating to hiring.cafe (letting CF challenge resolve)...');
      try {
        await page.goto('https://hiring.cafe', { waitUntil: 'load', timeout: 60000 });
      } catch (e) {
        log.warning('goto warning (may be normal for SPA): ' + e.message);
      }

      // Wait up to 30 s for CF to clear
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        const title = await page.title();
        if (!title.includes('Just a moment') && !title.includes('Checking') && title.length > 3) break;
        await page.waitForTimeout(2000);
      }
      log.info('Page title after wait: ' + (await page.title()));
      await page.waitForTimeout(1500);

      const results = [];
      for (let i = 0; i < payloads.length; i++) {
        log.info('Fetching payload ' + (i + 1) + '/' + payloads.length);
        const result = await page.evaluate(async ({ url, body }) => {
          try {
            const res = await fetch(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Accept': '*/*',
                'Origin': 'https://hiring.cafe',
                'Referer': 'https://hiring.cafe/',
              },
              body: JSON.stringify(body),
              credentials: 'include',
            });
            if (!res.ok) return { error: 'HTTP ' + res.status };
            return { data: await res.json() };
          } catch (e) {
            return { error: e.message };
          }
        }, { url: jobsUrl, body: payloads[i] });

        results.push(result);
        if (i < payloads.length - 1) await page.waitForTimeout(400);
      }

      return { results };
    }
  `;

  const run = await client.actor('apify/playwright-scraper').call({
    // Start at a neutral page — Crawlee's 403-block detection won't fire here.
    // hiring.cafe navigation happens inside pageFunction via page.goto().
    startUrls: [{
      url: 'https://www.google.com',
      userData: { jobsUrl, payloads }
    }],
    pageFunction,
    launchContext: { stealth: true, useChrome: true },
    maxRequestsPerCrawl: 1,
    navigationTimeoutSecs: 30,
    pageLoadTimeoutSecs: 30,
    proxyConfiguration: { useApifyProxy: true },
  }, { waitSecs: 360 });

  if (run.status !== 'SUCCEEDED') {
    throw new Error(`Apify actor run failed (status: ${run.status}). Check: https://console.apify.com/actors/runs/${run.id}`);
  }

  const { items } = await client.dataset(run.defaultDatasetId).listItems({ clean: true });
  const allResults = [];
  for (const item of items) {
    if (item.results) allResults.push(...item.results);
  }
  return allResults;
}

module.exports = { post, postDirect, postViaProxy, batchViaApifyActor };
