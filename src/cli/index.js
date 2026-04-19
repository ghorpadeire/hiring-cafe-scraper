'use strict';

const { Command } = require('commander');
const pkg         = require('../../package.json');

const { scrape }           = require('../scraper');
const { resolveLocation }  = require('../locations');
const { writeOutput }      = require('../output');
const LOG                  = require('../utils/logger');

function buildCli() {
  const program = new Command();

  program
    .name('hiring-cafe-scraper')
    .description('Scrape job listings from hiring.cafe by tech stack and location')
    .version(pkg.version, '-v, --version')
    .addHelpText('afterAll', `
Examples:
  $ hiring-cafe-scraper --tech Java --location Dublin
  $ hiring-cafe-scraper --tech React --location London --days 7 --format csv --output jobs
  $ hiring-cafe-scraper --tech Python --location remote --remote --seniority senior
  $ hiring-cafe-scraper --location list

Environment:
  APIFY_TOKEN    Apify API token for proxy-based Cloudflare bypass (optional on home internet)
                 Get one at: https://console.apify.com/account/integrations

Locations:
  Run --location list to see all ~80 supported cities and countries.

GitHub / Contributing:
  https://github.com/ghorpadeire/hiring-cafe-scraper
`);

  program
    .option('-t, --tech <stack>',       'Tech stack to search (e.g. "Java", "React TypeScript", "Python Django")')
    .option('-l, --location <place>',   'Location: city, country, ISO code, or "remote"  (use "list" to see all)', 'remote')
    .option('-q, --query <text>',       'Additional free-text query (e.g. "fintech", "startup")')
    .option('-d, --days <n>',           'How many days back to search', v => parseInt(v), 90)
    .option('-s, --seniority <level>',  'Seniority: junior | mid | senior | lead | all  (or comma-separated)', 'all')
    .option('-r, --remote',             'Remote jobs only', false)
    .option('-f, --format <fmt>',       'Output format: table | json | csv', 'table')
    .option('-o, --output <path>',      'Output file path (without extension)')
    .option('-p, --pages <n>',          'Max pages to fetch (1000 jobs/page)', v => parseInt(v), 50)
    .option('--no-filter',              'Disable client-side tech keyword filter')
    .option('--proxy-group <group>',    'Apify proxy group: RESIDENTIAL | DATACENTER', 'RESIDENTIAL')
    .option('--apify-token <token>',    'Apify token (overrides APIFY_TOKEN env var)')
    .option('--cf-cookie <value>',      'Cloudflare cf_clearance cookie (see README for how to obtain)')
    .action(run);

  return program;
}

async function run(opts) {
  // ── Load .env if present ──────────────────────────────────────────────────
  try { require('dotenv').config(); } catch {}

  const apifyToken = opts.apifyToken || process.env.APIFY_TOKEN || null;
  const cfCookie   = opts.cfCookie   || process.env.CF_CLEARANCE || null;

  // ── Print header ──────────────────────────────────────────────────────────
  LOG.bold(`\nhiring-cafe-scraper v${require('../../package.json').version}`);
  LOG.dim('─'.repeat(50));

  // ── Resolve location ──────────────────────────────────────────────────────
  const location = resolveLocation(opts.location);
  LOG.info(`Location:   ${location.formatted_address}`);
  if (opts.tech)   LOG.info(`Tech:       ${opts.tech}`);
  if (opts.query)  LOG.info(`Query:      ${opts.query}`);
  LOG.info(`Days back:  ${opts.days}`);
  LOG.info(`Seniority:  ${opts.seniority}`);
  LOG.info(`Remote:     ${opts.remote ? 'yes' : 'no'}`);
  if (apifyToken)  LOG.info(`Proxy:      Apify ${opts.proxyGroup}`);
  else             LOG.info(`Proxy:      none (trying direct)`);
  if (cfCookie)    LOG.info(`CF cookie:  provided (direct bypass mode)`);
  LOG.dim('─'.repeat(50));

  // ── Run scraper ───────────────────────────────────────────────────────────
  let jobs, meta;
  try {
    ({ jobs, meta } = await scrape({
      location,
      tech:       opts.tech,
      query:      opts.query,
      days:       opts.days,
      remote:     opts.remote,
      seniority:  opts.seniority,
      maxPages:   opts.pages,
      noFilter:   opts.noFilter === false ? false : !opts.filter,
      apifyToken,
      proxyGroup: opts.proxyGroup,
      cfCookie,
    }));
  } catch (err) {
    if (err.isCloudflare) {
      LOG.error('\nCloudflare blocked the request.\n');
      console.error(err.message);
    } else {
      LOG.error(`Scraper error: ${err.message}`);
      if (process.env.DEBUG) console.error(err.stack);
    }
    process.exit(1);
  }

  // ── Stats summary ─────────────────────────────────────────────────────────
  LOG.dim('─'.repeat(50));
  LOG.bold(`\n  ${jobs.length} jobs found`);

  if (jobs.length === 0) {
    LOG.warn('No jobs matched your filters. Try:');
    LOG.info('  • Wider seniority:    --seniority all');
    LOG.info('  • More days:          --days 180');
    LOG.info('  • Disable filter:     --no-filter');
    LOG.info('  • Different location: --location list');
    process.exit(2);  // Exit code 2 = success but zero results
  }

  // Quick stats
  const tally = key => jobs.reduce((m, j) => { const k = j[key] || 'Unknown'; m[k] = (m[k]||0)+1; return m; }, {});
  const topN  = (obj, n) => Object.entries(obj).sort((a,b) => b[1]-a[1]).slice(0,n);

  const byWorkplace = topN(tally('workplaceType'), 4);
  const bySeniority = topN(tally('seniority'), 4);

  if (byWorkplace.length) LOG.info('  Workplace: ' + byWorkplace.map(([k,v]) => `${k} (${v})`).join(', '));
  if (bySeniority.length) LOG.info('  Seniority: ' + bySeniority.map(([k,v]) => `${k} (${v})`).join(', '));

  // ── Write output ──────────────────────────────────────────────────────────
  LOG.dim('─'.repeat(50));
  writeOutput(jobs, meta, { format: opts.format, output: opts.output });
}

module.exports = { buildCli };
