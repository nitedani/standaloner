const _ = require('lodash'); const standaloner = require('standaloner'); async function run() { await standaloner({ input: 'index.js', outDir: 'dist' }); } run();
