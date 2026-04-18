'use strict';

const fs   = require('fs');
const path = require('path');

function writeJson(jobs, meta, outputPath) {
  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const out = { _meta: meta, jobs };
  fs.writeFileSync(outputPath, JSON.stringify(out, null, 2));
  return outputPath;
}

module.exports = { writeJson };
