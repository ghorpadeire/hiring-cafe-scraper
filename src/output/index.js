'use strict';

const path       = require('path');
const { writeJson } = require('./json');
const { writeCsv  } = require('./csv');
const { printTable} = require('./table');
const LOG            = require('../utils/logger');

/**
 * Writes output in the requested format.
 * @param {object[]} jobs
 * @param {object}   meta
 * @param {object}   options  { format, output }
 */
function writeOutput(jobs, meta, { format = 'table', output } = {}) {
  switch (format) {
    case 'json': {
      const filePath = resolveOutputPath(output, '.json');
      const written  = writeJson(jobs, meta, filePath);
      LOG.success(`JSON → ${written}`);
      return written;
    }
    case 'csv': {
      const filePath = resolveOutputPath(output, '.csv');
      const written  = writeCsv(jobs, filePath);
      LOG.success(`CSV  → ${written}`);
      return written;
    }
    case 'table':
    default:
      printTable(jobs);
      if (output) {
        // Also write JSON when --output is given alongside table
        const jsonPath = resolveOutputPath(output, '.json');
        writeJson(jobs, meta, jsonPath);
        LOG.success(`JSON → ${jsonPath}`);
      }
      return null;
  }
}

function resolveOutputPath(output, ext) {
  if (!output) {
    return path.join(process.cwd(), `results/jobs_${Date.now()}${ext}`);
  }
  // If output has an extension already, use it; otherwise append ext
  return path.extname(output) ? output : output + ext;
}

module.exports = { writeOutput };
