# hiring-cafe-scraper

> Scrape tech job listings from [hiring.cafe](https://hiring.cafe) by tech stack and location — export to JSON, CSV, or a pretty terminal table.

[![npm version](https://img.shields.io/npm/v/hiring-cafe-scraper.svg)](https://www.npmjs.com/package/hiring-cafe-scraper)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

---

## Quick Start

No install required on Node 18+:

```bash
npx hiring-cafe-scraper --tech Java --location Dublin
```

Or install globally:

```bash
npm install -g hiring-cafe-scraper
hiring-cafe-scraper --tech Python --location London --days 7
```

---

## Examples

```bash
# Java jobs in Dublin (last 90 days)
hiring-cafe-scraper --tech Java --location Dublin

# Senior React jobs in London — export to CSV
hiring-cafe-scraper --tech React --location London --seniority senior --format csv --output london-react

# Remote Python jobs posted in the last week
hiring-cafe-scraper --tech Python --location remote --remote --days 7

# DevOps/Kubernetes jobs in Germany — table view
hiring-cafe-scraper --tech "DevOps Kubernetes" --location Germany

# Any tech, Dublin, last 30 days — JSON output
hiring-cafe-scraper --location Dublin --days 30 --format json --output ./my-search/results

# See all supported locations
hiring-cafe-scraper --location list
```

---

## All Options

| Flag | Default | Description |
|------|---------|-------------|
| `-t, --tech <stack>` | (any) | Tech stack: `Java`, `React TypeScript`, `Python Django`, etc. |
| `-l, --location <place>` | `remote` | City, country, ISO-2 code, or `remote`. Run `--location list` to see all. |
| `-q, --query <text>` | — | Extra free-text query: `fintech`, `startup`, `healthcare` |
| `-d, --days <n>` | `90` | How many days back to search |
| `-s, --seniority <level>` | `all` | `junior` · `mid` · `senior` · `lead` · `all` (or comma-separated) |
| `-r, --remote` | `false` | Remote-only jobs |
| `-f, --format <fmt>` | `table` | `table` · `json` · `csv` |
| `-o, --output <path>` | — | Output file path (extension auto-added) |
| `-p, --pages <n>` | `50` | Max pages to fetch (1000 jobs/page) |
| `--no-filter` | — | Disable client-side keyword filter |
| `--proxy-group <g>` | `RESIDENTIAL` | Apify proxy group: `RESIDENTIAL` or `DATACENTER` |
| `--apify-token <tok>` | — | Apify token (overrides `APIFY_TOKEN` env var) |
| `-v, --version` | — | Show version |
| `-h, --help` | — | Show help |

---

## Location Guide

Run this to see all ~80 supported cities and countries:

```bash
hiring-cafe-scraper --location list
```

The `--location` flag accepts:

| Input | Matches |
|-------|---------|
| `Dublin` | Dublin, Ireland |
| `"San Francisco"` | San Francisco, CA, USA |
| `IE` | Ireland (ISO code) |
| `Germany` | Germany (country-level) |
| `DE` | Germany (ISO code) |
| `remote` | Worldwide / fully remote |

**My city isn't listed?** Open a [Pull Request](https://github.com/ghorpadeire/hiring-cafe-scraper/blob/main/CONTRIBUTING.md#adding-a-location) — it takes 10 lines of JSON.

---

## Cloudflare & Proxy Guide

hiring.cafe uses Cloudflare Turnstile to block bots.

| Your environment | What happens | What to do |
|-----------------|--------------|------------|
| Home internet (residential IP) | ✅ Works directly | Nothing — just run the tool |
| Corporate network / VPN | ⚠️ May be blocked | Try without VPN first |
| Cloud server (AWS, VPS, GitHub Actions) | ❌ Blocked | Set `APIFY_TOKEN` (see below) |

### Setting up Apify Proxy (for cloud servers)

1. Create a free account at [apify.com](https://apify.com)
2. Go to **Account → Integrations** and copy your API token
3. Add it to a `.env` file in your project:

```env
APIFY_TOKEN=apify_api_xxxxxxxxxxxxxxxxxxxx
```

Or pass it directly:

```bash
hiring-cafe-scraper --tech Java --location Dublin --apify-token apify_api_xxx
```

> **Note:** Cloudflare bypass requires Apify's **RESIDENTIAL** proxy plan. The free tier includes datacenter proxies which may or may not work. If `RESIDENTIAL` fails, try `--proxy-group DATACENTER`.

---

## Output Formats

### Table (default — great for quick searches)

```
+----------------------------------------+------------------------+--------------------+----------+--------------+--------------------+
| Title                                  | Company                | Location           | Type     | Level        | Salary             |
+----------------------------------------+------------------------+--------------------+----------+--------------+--------------------+
| Senior Java Developer                  | Stripe                 | Dublin, Ireland    | Hybrid   | Senior Level | €90,000 - €120,000 |
| Backend Engineer (Spring Boot)         | HubSpot                | Dublin, Ireland    | Onsite   | Mid Level    |                    |
| Java / Kotlin Developer                | Workday                | Dublin, Ireland    | Remote   | Senior Level | €80,000 - €110,000 |
+----------------------------------------+------------------------+--------------------+----------+--------------+--------------------+
```

### JSON (`--format json`)

```json
{
  "_meta": {
    "tech": "Java",
    "location": "Dublin, Ireland",
    "days": 90,
    "scrapedAt": "2025-04-18T10:30:00.000Z",
    "totalFetched": 142,
    "totalAfterFilter": 89,
    "toolVersion": "1.0.0"
  },
  "jobs": [
    {
      "id": "...",
      "title": "Senior Java Developer",
      "company": "Stripe",
      "location": "Dublin, Ireland",
      "workplaceType": "Hybrid",
      "commitment": "Full Time",
      "seniority": "Senior Level",
      "salary": "€90,000 - €120,000",
      "applyUrl": "https://...",
      "postedDate": "2025-04-15T00:00:00.000Z",
      "views": 1204,
      "applications": 47
    }
  ]
}
```

### CSV (`--format csv`)

Opens directly in Excel / Google Sheets. Columns: Title, Company, Location, WorkplaceType, Commitment, Seniority, Salary, PostedDate, Views, Applications, ApplyURL.

---

## Supported Tech Stacks

The `--tech` flag understands these terms (and their ecosystem synonyms automatically):

`Java` · `Kotlin` · `Python` · `JavaScript` · `TypeScript` · `React` · `Angular` · `Vue` · `Go` · `Rust` · `.NET` · `PHP` · `Ruby` · `Swift` · `Android` · `DevOps` · `Cloud` · `Kubernetes` · `Data` · `ML` · `Security` · `Scala` · `Elixir` · `SQL`

Example: `--tech Java` automatically expands to also match Spring Boot, Hibernate, Maven, JVM, Quarkus, etc.

For stacks not in the list, the tool still searches — it just won't do synonym expansion. Use `--no-filter` to skip client-side filtering entirely.

---

## Use as a Library

```js
const { scrape } = require('hiring-cafe-scraper');
const { resolveLocation } = require('hiring-cafe-scraper/src/locations');

const location = resolveLocation('Dublin');

const { jobs, meta } = await scrape({
  location,
  tech: 'React',
  days: 30,
  seniority: 'senior',
  remote: true,
  apifyToken: process.env.APIFY_TOKEN,  // optional
});

console.log(`Found ${jobs.length} jobs`);
console.log(jobs[0]);
```

---

## Contributing

Contributions welcome! The easiest way to contribute:

### Adding a Location

Edit [`src/locations/presets.json`](src/locations/presets.json) and add an entry:

```json
"your city": {
  "formatted_address": "Your City, Country",
  "types": ["locality"],
  "geometry": { "location": { "lat": "XX.XXXX", "lon": "XX.XXXX" } },
  "id": "user_city",
  "address_components": [
    { "long_name": "Your City", "short_name": "Your City", "types": ["locality"] },
    { "long_name": "Country",   "short_name": "ISO2",      "types": ["country"] }
  ],
  "options": { "flexible_regions": ["anywhere_in_continent", "anywhere_in_world"] }
}
```

Find coordinates at [latlong.net](https://www.latlong.net).

### Adding a Tech Synonym

Edit the `TECH_SYNONYMS` map in [`src/api/payload.js`](src/api/payload.js).

### PR Guidelines

- One change per PR
- Update the relevant section in README if adding a feature
- No new runtime dependencies without discussion

---

## Disclaimer

This tool is for personal job-search use only. Please respect [hiring.cafe's Terms of Service](https://hiring.cafe/terms). Do not use this tool for commercial purposes or bulk data collection. The API endpoints used are the same ones the hiring.cafe web application calls — no private data is accessed.

---

## License

[MIT](LICENSE) © [Pranav Ghorpade](https://github.com/ghorpadeire)

---

*Built to help developers find their next role. If it helped you land a job, consider leaving a ⭐*
