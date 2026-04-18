'use strict';

const COLS = [
  { key: 'title',       label: 'Title',    width: 38 },
  { key: 'company',     label: 'Company',  width: 22 },
  { key: 'location',    label: 'Location', width: 18 },
  { key: 'workplaceType', label: 'Type',   width: 8 },
  { key: 'seniority',   label: 'Level',    width: 12 },
  { key: 'salary',      label: 'Salary',   width: 18 },
];

function pad(str, n) {
  const s = String(str || '');
  return s.length >= n ? s.substring(0, n - 1) + '…' : s.padEnd(n);
}

function printTable(jobs) {
  if (jobs.length === 0) {
    console.log('\n  No jobs found.\n');
    return;
  }

  const divider = '+' + COLS.map(c => '-'.repeat(c.width + 2)).join('+') + '+';
  const header  = '|' + COLS.map(c => ' ' + pad(c.label, c.width) + ' ').join('|') + '|';

  console.log('\n' + divider);
  console.log(header);
  console.log(divider);

  for (const job of jobs) {
    const row = '|' + COLS.map(c => ' ' + pad(job[c.key], c.width) + ' ').join('|') + '|';
    console.log(row);
  }

  console.log(divider);
  console.log(`\n  ${jobs.length} job${jobs.length !== 1 ? 's' : ''} found\n`);

  // Print apply URLs below table (too long for inline)
  console.log('  Apply links:');
  jobs.slice(0, 10).forEach((j, i) => {
    if (j.applyUrl) console.log(`  [${i + 1}] ${j.title.substring(0, 40)} → ${j.applyUrl}`);
  });
  if (jobs.length > 10) console.log(`  ... and ${jobs.length - 10} more. Use --format json or --format csv for full export.\n`);
}

module.exports = { printTable };
