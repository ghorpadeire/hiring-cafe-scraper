'use strict';

const fs   = require('fs');
const path = require('path');

const COLUMNS = [
  { key: 'title',       label: 'Title' },
  { key: 'company',     label: 'Company' },
  { key: 'location',    label: 'Location' },
  { key: 'workplaceType', label: 'WorkplaceType' },
  { key: 'commitment',  label: 'Commitment' },
  { key: 'seniority',   label: 'Seniority' },
  { key: 'salary',      label: 'Salary' },
  { key: 'postedDate',  label: 'PostedDate' },
  { key: 'views',       label: 'Views' },
  { key: 'applications', label: 'Applications' },
  { key: 'applyUrl',    label: 'ApplyURL' },
];

const esc = v => `"${String(v ?? '').replace(/"/g, '""').replace(/\n/g, ' ').trim()}"`;

function writeCsv(jobs, outputPath) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const header = COLUMNS.map(c => c.label).join(',');
  const rows   = jobs.map(j => COLUMNS.map(c => esc(j[c.key])).join(','));

  fs.writeFileSync(outputPath, [header, ...rows].join('\n'));
  return outputPath;
}

module.exports = { writeCsv };
