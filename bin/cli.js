#!/usr/bin/env node
'use strict';

const { buildCli } = require('../src/cli/index');

buildCli().parseAsync(process.argv).catch(err => {
  console.error(err.message);
  process.exit(1);
});
