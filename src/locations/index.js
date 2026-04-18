'use strict';

const presets = require('./presets.json');

// ISO 2-letter code → preset key map
const ISO_MAP = {};
for (const [key, val] of Object.entries(presets)) {
  if (key.startsWith('_')) continue;
  const country = val.address_components?.find(c => c.types.includes('country'));
  if (country?.short_name) {
    ISO_MAP[country.short_name.toLowerCase()] = key;
  }
}

/**
 * Resolves a user-supplied location string to a hiring.cafe location payload.
 * Accepts: city name, "City, Country", country name, ISO-2 code, "remote".
 * Returns the preset object or exits with a helpful error.
 */
function resolveLocation(input) {
  if (!input || input.trim() === '') return presets['remote'];

  const raw = input.trim().toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();

  // Special value: list all presets and exit
  if (raw === 'list') {
    printLocationList();
    process.exit(0);
  }

  // 1. Direct exact match
  if (presets[raw]) return presets[raw];

  // 2. ISO-2 country code match (e.g. "IE", "DE", "GB")
  if (ISO_MAP[raw]) return presets[ISO_MAP[raw]];

  // 3. Substring match — input contains a preset key (e.g. "Dublin, Ireland" → "dublin")
  for (const key of Object.keys(presets)) {
    if (key.startsWith('_')) continue;
    if (raw.includes(key)) return presets[key];
  }

  // 4. Reverse: a preset key contains the input (e.g. "san fran" → "san francisco")
  for (const key of Object.keys(presets)) {
    if (key.startsWith('_')) continue;
    if (key.includes(raw)) return presets[key];
  }

  // 5. No match — show helpful error
  const LOG = require('../utils/logger');
  LOG.error(`Location "${input}" not recognised.`);
  LOG.info('Available locations (run --location list to see all):');
  const cityKeys = Object.keys(presets)
    .filter(k => !k.startsWith('_') && presets[k].id === 'user_city')
    .sort()
    .slice(0, 30);
  LOG.info('  ' + cityKeys.join(', ') + ', ...');
  LOG.info('  Tip: use --location remote for worldwide remote jobs.');
  process.exit(1);
}

function printLocationList() {
  const LOG = require('../utils/logger');
  const entries = Object.entries(presets).filter(([k]) => !k.startsWith('_'));

  const countries = entries.filter(([, v]) => v.id === 'user_country' || v.id === 'user_anywhere');
  const cities    = entries.filter(([, v]) => v.id === 'user_city');

  LOG.bold('\nAvailable locations for --location flag\n');

  LOG.bold('Special:');
  console.log('  remote              Worldwide / fully remote jobs\n');

  LOG.bold('Countries:');
  const countryLines = countries.map(([k, v]) => k.padEnd(22) + v.formatted_address);
  for (let i = 0; i < countryLines.length; i += 3) {
    console.log('  ' + countryLines.slice(i, i + 3).join('  '));
  }

  LOG.bold('\nCities:');
  const cityLines = cities.map(([k, v]) => k.padEnd(22) + v.formatted_address);
  for (let i = 0; i < cityLines.length; i += 2) {
    console.log('  ' + cityLines.slice(i, i + 2).join('  '));
  }

  console.log('\nUsage examples:');
  console.log('  --location Dublin');
  console.log('  --location "San Francisco"');
  console.log('  --location IE');
  console.log('  --location remote\n');
  console.log('Want to add your city? Open a PR: https://github.com/your-username/hiring-cafe-scraper\n');
}

module.exports = { resolveLocation, printLocationList };
