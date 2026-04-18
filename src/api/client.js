'use strict';

const http  = require('http');
const https = require('https');

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
async function postDirect(url, payload) {
  const body = JSON.stringify(payload);
  const parsed = new URL(url);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: parsed.hostname,
      port:     443,
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers:  { ...BROWSER_HEADERS, 'Content-Length': Buffer.byteLength(body) },
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
function postViaProxy(url, payload, apifyToken, proxyGroup = 'RESIDENTIAL') {
  const body    = JSON.stringify(payload);
  const target  = new URL(url);
  const proxyUser = `groups-${proxyGroup}`;
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
  const { apifyToken, proxyGroup = 'RESIDENTIAL', skipDirect = false } = options;

  if (!skipDirect) {
    try {
      const data = await postDirect(url, payload);
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

module.exports = { post, postDirect, postViaProxy };
