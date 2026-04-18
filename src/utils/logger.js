'use strict';

// ANSI colour codes — no external dependency
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  red:    '\x1b[31m',
  cyan:   '\x1b[36m',
  grey:   '\x1b[90m',
};

const noColor = process.env.NO_COLOR || process.env.CI;
const c = (code, str) => noColor ? str : `${code}${str}${C.reset}`;

const LOG = {
  info:    (msg) => console.error(c(C.cyan,   `  ${msg}`)),
  success: (msg) => console.error(c(C.green,  `✓ ${msg}`)),
  warn:    (msg) => console.error(c(C.yellow, `⚠ ${msg}`)),
  error:   (msg) => console.error(c(C.red,    `✗ ${msg}`)),
  dim:     (msg) => console.error(c(C.grey,   `  ${msg}`)),
  bold:    (msg) => console.error(c(C.bold,   msg)),
  step:    (msg) => process.stderr.write(c(C.cyan, `  ${msg}`)),
  ok:      (msg) => process.stderr.write(c(C.green, ` ${msg}\n`)),
  raw:     (msg) => process.stderr.write(msg),
};

module.exports = LOG;
