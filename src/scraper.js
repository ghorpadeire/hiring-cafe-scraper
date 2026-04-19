'use strict';

const { post, postDirect, batchViaApifyActor } = require('./api/client');
const { batchViaLocalBrowser, findBrowser }   = require('./transport/local-chrome');
const { readCfClearance }  = require('./utils/brave-cookie');
const { buildPayload, expandTech } = require('./api/payload');
const { normalise }  = require('./api/normalise');
const sleep          = require('./utils/sleep');
const LOG            = require('./utils/logger');

const BASE_URL  = 'https://hiring.cafe';
const COUNT_URL = `${BASE_URL}/api/search-jobs/get-total-count`;
const JOBS_URL  = `${BASE_URL}/api/search-jobs`;
const PAGE_SIZE = 1000;

function extractJobs(data) {
  for (const key of ['results', 'jobs', 'data', 'hits', 'items']) {
    if (data[key] && Array.isArray(data[key])) return data[key];
  }
  return Array.isArray(data) ? data : [];
}

/**
 * Main scraper.
 * @param {object} config
 * @param {object} config.location    - Resolved location preset object
 * @param {string} config.tech        - Tech stack filter (e.g. "Java")
 * @param {string} config.query       - General search query
 * @param {number} config.days        - How many days back to search
 * @param {boolean} config.remote     - Remote-only flag
 * @param {string} config.seniority   - Seniority level filter
 * @param {number} config.maxPages    - Max pages to fetch
 * @param {boolean} config.noFilter   - Skip client-side tech filter
 * @param {string} config.apifyToken  - Optional Apify token for proxy
 * @param {string} config.proxyGroup  - Apify proxy group (default: RESIDENTIAL)
 * @returns {Promise<{jobs: object[], meta: object}>}
 */
async function scrape(config) {
  const {
    location,
    tech,
    query,
    days     = 90,
    remote   = false,
    seniority,
    maxPages = 50,
    noFilter = false,
    apifyToken,
    proxyGroup = 'RESIDENTIAL',
    cfCookie,
  } = config;

  // Auto-read CF cookie from browser profile (works when Chrome/Brave is closed)
  let resolvedCfCookie = cfCookie;
  if (!resolvedCfCookie) {
    const auto = await readCfClearance();
    if (auto) {
      resolvedCfCookie = auto;
      LOG.info('CF cookie auto-read from browser profile');
    }
  }

  const postOpts = { apifyToken, proxyGroup, cfCookie: resolvedCfCookie };
  let usedProxy  = false;
  let proxyDetected = false;

  const payloadConfig = { tech, query, location, days, remote, seniority, pageSize: PAGE_SIZE };

  // ── Step 1: Get total count (direct only — proxy not needed for this) ───────
  let totalJobs = 0;
  try {
    const data = await postDirect(COUNT_URL, buildPayload(payloadConfig, 0), resolvedCfCookie);
    totalJobs = data?.total ?? data?.count ?? data?.totalCount ?? 0;
    if (totalJobs) LOG.success(`Found ${totalJobs.toLocaleString()} matching jobs`);
  } catch (err) {
    if (!err.isCloudflare) {
      LOG.warn(`Count endpoint unavailable: ${err.message}. Will paginate until empty.`);
    }
    // CF block on count endpoint is normal — proceed without the total
  }

  const totalPages = totalJobs
    ? Math.min(Math.ceil(totalJobs / PAGE_SIZE), maxPages)
    : maxPages;

  // ── Step 2: Paginate ──────────────────────────────────────────────────────
  const allJobs  = [];
  const seenKeys = new Set();

  // Try direct pagination first; if Cloudflare blocks, fall back to Apify actor
  let useActor = false;
  let cloudflareHit = false;

  // Probe page 0 to decide transport (direct first, then actor if blocked)
  LOG.step(`[1/${totalPages}] Fetching page...`);
  try {
    // Always try direct first (with CF cookie if available)
    const data = await postDirect(JOBS_URL, buildPayload(payloadConfig, 0), resolvedCfCookie);
    const pageJobs = extractJobs(data);
    LOG.ok(` +${pageJobs.length} jobs`);
    for (const raw of pageJobs) {
      const job = normalise(raw);
      const key = job.id || job.applyUrl || `${job.title}|${job.company}`;
      if (key && !seenKeys.has(key)) { seenKeys.add(key); allJobs.push(job); }
    }
    if (pageJobs.length === 0) { LOG.ok(' empty'); }
    LOG.success('Direct connection works — no proxy needed');
  } catch (err) {
    cloudflareHit = true;
    if (resolvedCfCookie && err.isCloudflare) {
      LOG.warn('Provided CF cookie was rejected (expired?) — falling back to browser/actor.');
    }
    const localBrowserPath = findBrowser();
    const hasLocalBrowser  = !!localBrowserPath;
    useActor = !hasLocalBrowser && !!apifyToken;

    if (!hasLocalBrowser && !apifyToken) {
      const cfErr = new Error(
        'Cloudflare blocked the direct request.\n\n' +
        '  ── Quick fix: use your browser\'s CF cookie ──────────────────────────\n' +
        '  1. Open https://hiring.cafe in Chrome or Brave\n' +
        '  2. Open DevTools (F12) → Application → Cookies → hiring.cafe\n' +
        '  3. Copy the value of "cf_clearance"\n' +
        '  4. Re-run with:  --cf-cookie <paste-value-here>\n' +
        '     Or set:       CF_CLEARANCE=<value> in .env\n\n' +
        '  ── Cloud bypass (requires Apify paid plan) ───────────────────────────\n' +
        '  Add APIFY_TOKEN=apify_api_... to .env\n' +
        '  Get a token at: https://console.apify.com/account/integrations\n' +
        '  Note: Cloudflare bypass in cloud requires Apify\'s RESIDENTIAL plan.'
      );
      cfErr.isCloudflare = true;
      throw cfErr;
    }

    if (hasLocalBrowser) {
      LOG.warn(`Direct request blocked — switching to local browser (${localBrowserPath.split(/[\\/]/).pop()})`);
    } else {
      LOG.warn(`Direct request blocked (${err.message.split('\n')[0]}) — switching to Apify actor`);
    }
  }

  if (cloudflareHit && findBrowser()) {
    // ── Local browser path: raw CDP, no Playwright markers, CF clears on residential IPs ──
    LOG.step(`Building ${totalPages} page payloads for local browser run...`);
    const payloads = Array.from({ length: totalPages }, (_, p) => buildPayload(payloadConfig, p));
    LOG.ok(' done');
    LOG.info(`Launching local browser (this takes ~30-60s for Cloudflare to clear)...`);

    let browserResults;
    try {
      browserResults = await batchViaLocalBrowser(JOBS_URL, payloads);
    } catch (err) {
      if (apifyToken) {
        LOG.warn(`Local browser failed (${err.message.split('\n')[0]}) — trying Apify actor`);
        useActor = true;
      } else {
        throw new Error(`Local browser failed: ${err.message}`);
      }
    }

    if (browserResults) {
      for (const result of browserResults) {
        if (result.error) { LOG.warn(`Browser page error: ${result.error}`); continue; }
        const pageJobs = extractJobs(result.data || {});
        for (const raw of pageJobs) {
          const job = normalise(raw);
          const key = job.id || job.applyUrl || `${job.title}|${job.company}`;
          if (key && !seenKeys.has(key)) { seenKeys.add(key); allJobs.push(job); }
        }
      }
      LOG.success(`Browser run complete — ${allJobs.length} raw jobs collected`);
    }
  }

  if (useActor) {
    // ── Apify actor path: batch all page payloads in one actor run ──────────
    LOG.step(`Building ${totalPages} page payloads for actor run...`);
    const payloads = Array.from({ length: totalPages }, (_, p) => buildPayload(payloadConfig, p));
    LOG.ok(' done');
    LOG.info(`Launching Apify playwright-scraper actor (this takes ~60-90s)...`);

    let actorResults;
    try {
      actorResults = await batchViaApifyActor(JOBS_URL, payloads, apifyToken);
    } catch (err) {
      throw new Error(`Apify actor failed: ${err.message}`);
    }

    for (const result of actorResults) {
      if (result.error) { LOG.warn(`Actor page error: ${result.error}`); continue; }
      const pageJobs = extractJobs(result.data || {});
      for (const raw of pageJobs) {
        const job = normalise(raw);
        const key = job.id || job.applyUrl || `${job.title}|${job.company}`;
        if (key && !seenKeys.has(key)) { seenKeys.add(key); allJobs.push(job); }
      }
    }
    LOG.success(`Actor run complete — ${allJobs.length} raw jobs collected`);
    usedProxy = true;

  } else if (!cloudflareHit) {
    // ── Direct path: paginate normally from page 1 onwards ─────────────────
    const startMs = Date.now();
    for (let p = 1; p < totalPages; p++) {
      const elapsed = Date.now() - startMs;
      const eta = p > 1 ? `  ETA ~${Math.round((elapsed / (p-1)) * (totalPages - p) / 1000)}s` : '';
      LOG.step(`[${p + 1}/${totalPages}] Fetching page...${eta}`);

      let data;
      try {
        const result = await post(JOBS_URL, buildPayload(payloadConfig, p), {
          ...postOpts, skipDirect: usedProxy,
        });
        data = result.data;
        if (result.usedProxy) usedProxy = true;
      } catch (err) {
        if (err.isCloudflare) throw err;
        LOG.ok(`\nError on page ${p}: ${err.message}`);
        break;
      }

      const pageJobs = extractJobs(data);
      if (pageJobs.length === 0) { LOG.ok(' empty — done'); break; }

      let added = 0;
      for (const raw of pageJobs) {
        const job = normalise(raw);
        const key = job.id || job.applyUrl || `${job.title}|${job.company}`;
        if (key && !seenKeys.has(key)) { seenKeys.add(key); allJobs.push(job); added++; }
      }
      LOG.ok(` +${added} (${allJobs.length} total)`);
      if (p < totalPages - 1) await sleep(350);
    }
  }

  // ── Step 3: Client-side tech filter ──────────────────────────────────────
  let filtered = allJobs;

  if (!noFilter && tech) {
    const { filterTerms } = expandTech(tech);
    filtered = allJobs.filter(job => {
      const text = `${job.title} ${job.description} ${job.skills.join(' ')}`.toLowerCase();
      return filterTerms.some(t => text.includes(t));
    });
    LOG.info(`Tech filter (${tech}): kept ${filtered.length} / ${allJobs.length} jobs`);
  }

  // Sort newest first
  filtered.sort((a, b) => {
    if (!a.postedDate && !b.postedDate) return 0;
    if (!a.postedDate) return 1;
    if (!b.postedDate) return -1;
    return new Date(b.postedDate) - new Date(a.postedDate);
  });

  const meta = {
    query:             query || tech || '(any)',
    tech:              tech  || '',
    location:          location?.formatted_address || 'Unknown',
    days,
    remote,
    seniority:         seniority || 'all',
    scrapedAt:         new Date().toISOString(),
    totalFetched:      allJobs.length,
    totalAfterFilter:  filtered.length,
    usedProxy,
    toolVersion:       require('../package.json').version,
  };

  return { jobs: filtered, meta };
}

module.exports = { scrape };
