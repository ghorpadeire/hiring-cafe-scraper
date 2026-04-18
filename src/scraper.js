'use strict';

const { post }       = require('./api/client');
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
  } = config;

  const postOpts = { apifyToken, proxyGroup };
  let usedProxy  = false;
  let proxyDetected = false;

  const payloadConfig = { tech, query, location, days, remote, seniority, pageSize: PAGE_SIZE };

  // ── Step 1: Get total count ───────────────────────────────────────────────
  let totalJobs = 0;
  try {
    const { data, usedProxy: p } = await post(COUNT_URL, buildPayload(payloadConfig, 0), postOpts);
    if (p) { usedProxy = true; proxyDetected = true; }
    totalJobs = data?.total ?? data?.count ?? data?.totalCount ?? 0;
    if (totalJobs) LOG.success(`Found ${totalJobs.toLocaleString()} matching jobs`);
  } catch (err) {
    if (err.isCloudflare) throw err;  // Bubble up — show user the helpful message
    LOG.warn(`Count endpoint unavailable: ${err.message}. Will paginate until empty.`);
  }

  if (!proxyDetected) {
    LOG.success('Direct connection successful (no proxy needed)');
  }

  const totalPages = totalJobs
    ? Math.min(Math.ceil(totalJobs / PAGE_SIZE), maxPages)
    : maxPages;

  // ── Step 2: Paginate ──────────────────────────────────────────────────────
  const allJobs  = [];
  const seenKeys = new Set();
  const startMs  = Date.now();

  for (let p = 0; p < totalPages; p++) {
    const eta = p > 0
      ? `  ETA ~${Math.round(((Date.now() - startMs) / p) * (totalPages - p) / 1000)}s`
      : '';

    LOG.step(`[${p + 1}/${totalPages}] Fetching page...${eta}`);

    let data;
    try {
      const result = await post(JOBS_URL, buildPayload(payloadConfig, p), {
        ...postOpts,
        skipDirect: usedProxy,  // once proxy is confirmed, skip direct attempt
      });
      data = result.data;
      if (result.usedProxy) usedProxy = true;
    } catch (err) {
      if (err.isCloudflare) throw err;
      LOG.ok(`\nError on page ${p}: ${err.message}`);
      break;
    }

    const pageJobs = extractJobs(data);
    if (pageJobs.length === 0) {
      LOG.ok(' empty — done');
      break;
    }

    let added = 0;
    for (const raw of pageJobs) {
      const job = normalise(raw);
      const key = job.id || job.applyUrl || `${job.title}|${job.company}`;
      if (key && !seenKeys.has(key)) {
        seenKeys.add(key);
        allJobs.push(job);
        added++;
      }
    }

    LOG.ok(` +${added} jobs (${allJobs.length} total)`);
    if (p < totalPages - 1) await sleep(350);
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
