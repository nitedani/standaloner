import { execFileSync, execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('=== Testing Yarn PnP ===\n');

// Yarn's file: protocol needs forward slashes
const fileDep = dir => 'file:' + dir.replace(/\\/g, '/');

// A temporary directory outside this pnpm workspace, so Yarn doesn't pick up its packageManager
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'standaloner-pnp-test-'));
console.log(`Created temporary Yarn PnP project: ${tmpDir}`);

try {
  fs.writeFileSync(
    path.join(tmpDir, 'package.json'),
    JSON.stringify(
      { name: 'standaloner-pnp-test', private: true, type: 'module', packageManager: 'yarn@4.10.3' },
      null,
      2
    )
  );
  fs.writeFileSync(path.join(tmpDir, 'yarn.lock'), '');

  console.log('Installing dependencies (lodash4, lodash, esbuild, dual, cjs-parent, linked, linked-renamed, dual-fork, fork-user, linked-bundled, uses-a, uses-b, utils, utils-a-renamed, alias-v3, alias-v4, local standaloner)...');
  execFileSync(
    'corepack',
    [
      'yarn',
      'add',
      // an npm: alias, which PnP keeps under the name of the package it installs
      'lodash4@npm:lodash@^4.17.21',
      // a local lodash 3.10.1, next to the npm lodash 3.10.1 alias-v3 requires
      `lodash@portal:${path.join(__dirname, 'lodash-fork').replace(/\\/g, '/')}`,
      'esbuild',
      `dual@${fileDep(path.join(__dirname, 'dual'))}`,
      // requires dual, so its require export is traced
      `cjs-parent@${fileDep(path.join(__dirname, 'cjs-parent'))}`,
      // each requires lodash-alias, an npm: alias of a different lodash version
      `alias-v3@${fileDep(path.join(__dirname, 'alias-v3'))}`,
      `alias-v4@${fileDep(path.join(__dirname, 'alias-v4'))}`,
      // portal: keeps the package outside any node_modules folder, as for a workspace
      `linked@portal:${path.join(__dirname, 'linked').replace(/\\/g, '/')}`,
      // its package.json says it is dual 1.0.0, like the real dual
      `dual-fork@portal:${path.join(__dirname, 'dual-fork').replace(/\\/g, '/')}`,
      // requires dual-local, a local dual 2.0.0, as dual: the app keeps its own dual 1.0.0
      `fork-user@portal:${path.join(__dirname, 'fork-user').replace(/\\/g, '/')}`,
      // each requires a different portal: package as utils
      `uses-a@portal:${path.join(__dirname, 'uses-a').replace(/\\/g, '/')}`,
      `uses-b@portal:${path.join(__dirname, 'uses-b').replace(/\\/g, '/')}`,
      // the app's own utils is uses-b's, though uses-a's folder sorts first
      `utils@portal:${path.join(__dirname, 'utils-b').replace(/\\/g, '/')}`,
      // uses-a's utils, which the app also imports under another name
      `utils-a-renamed@portal:${path.join(__dirname, 'utils-a').replace(/\\/g, '/')}`,
      // the same package, bundled under another name: its import export
      `linked-bundled@portal:${path.join(__dirname, 'linked').replace(/\\/g, '/')}`,
      // the same package, imported under another name through a symlinked folder
      `linked-renamed@portal:${path.join(__dirname, 'linked-symlink').replace(/\\/g, '/')}`,
      `standaloner@${fileDep(path.resolve(__dirname, '../../standaloner'))}`,
    ],
    { stdio: 'inherit', cwd: tmpDir }
  );

  fs.writeFileSync(
    path.join(tmpDir, 'index.js'),
    `import _ from 'lodash4';
import lodashFork from 'lodash';
import { transformSync } from 'esbuild';
import { format } from 'dual';
import cjsParent from 'cjs-parent';
import { linked } from 'linked';
import { linked as renamed } from 'linked-renamed';
import { linked as bundled } from 'linked-bundled';
import fork from 'dual-fork';
import forkUser from 'fork-user';
import usesA from 'uses-a';
import usesB from 'uses-b';
import utils from 'utils';
import utilsA from 'utils-a-renamed';
import v3 from 'alias-v3';
import v4 from 'alias-v4';
console.log(format(_.defaults({ a: 1 }, { a: 3, b: 2 })), transformSync('let a = 1').code.trim(), cjsParent, lodashFork.VERSION, linked, renamed, bundled, fork, forkUser, usesA + usesB, utils, utilsA, v3, v4);
`
  );
  fs.writeFileSync(
    path.join(tmpDir, 'build.js'),
    `import standaloner from 'standaloner';
await standaloner({ input: 'index.js', outDir: 'dist', bundle: { external: ['lodash4', 'lodash', 'esbuild', 'dual', 'cjs-parent', 'linked', 'linked-renamed', 'dual-fork', 'fork-user', 'uses-a', 'uses-b', 'utils', 'utils-a-renamed', 'alias-v3', 'alias-v4'] } });
`
  );

  console.log('Running standaloner inside Yarn PnP...');
  execSync('corepack yarn node build.js', { stdio: 'inherit', cwd: tmpDir });

  // Run the output with plain node: it must not need Yarn's PnP runtime
  const output = execFileSync('node', [path.join(tmpDir, 'dist', 'index.mjs')], {
    cwd: tmpDir,
  }).toString();
  console.log('Output:', output.trim());

  const expected = 'esm {"a":1,"b":2} let a = 1; cjs "cjs-parent" lodash-fork linked esm linked esm linked esm fork local "fork-user" AB B A 3.10.1 4.17.21';
  if (output.trim() !== expected) {
    throw new Error(`Expected '${expected}', got '${output.trim()}'`);
  }
  console.log(
    "✓ Externals traced from Yarn PnP: npm: aliases, both builds of dual, portal: packages under their own and another name, esbuild's platform binary"
  );
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
