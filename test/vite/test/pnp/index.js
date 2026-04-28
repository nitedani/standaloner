const _ = require('lodash'); const { builder } = require('standaloner'); async function run() { await builder({ entry: 'index.js', outDir: 'dist' }); } run();
