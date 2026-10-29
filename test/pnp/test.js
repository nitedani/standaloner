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

  console.log('Installing dependencies (lodash4, esbuild, dual, cjs-parent, linked, alias-v3, alias-v4, local standaloner)...');
  execFileSync(
    'corepack',
    [
      'yarn',
      'add',
      // an npm: alias, which PnP keeps under the name of the package it installs
      'lodash4@npm:lodash@^4.17.21',
      'esbuild',
      `dual@${fileDep(path.join(__dirname, 'dual'))}`,
      // requires dual, so its require export is traced
      `cjs-parent@${fileDep(path.join(__dirname, 'cjs-parent'))}`,
      // each requires lodash-alias, an npm: alias of a different lodash version
      `alias-v3@${fileDep(path.join(__dirname, 'alias-v3'))}`,
      `alias-v4@${fileDep(path.join(__dirname, 'alias-v4'))}`,
      // portal: keeps the package outside any node_modules folder, as for a workspace
      `linked@portal:${path.join(__dirname, 'linked').replace(/\\/g, '/')}`,
      `standaloner@${fileDep(path.resolve(__dirname, '../../standaloner'))}`,
    ],
    { stdio: 'inherit', cwd: tmpDir }
  );

  fs.writeFileSync(
    path.join(tmpDir, 'index.js'),
    `import _ from 'lodash4';
import { transformSync } from 'esbuild';
import { format } from 'dual';
import cjsParent from 'cjs-parent';
import { linked } from 'linked';
import v3 from 'alias-v3';
import v4 from 'alias-v4';
console.log(format(_.defaults({ a: 1 }, { a: 3, b: 2 })), transformSync('let a = 1').code.trim(), cjsParent, linked, v3, v4);
`
  );
  fs.writeFileSync(
    path.join(tmpDir, 'build.js'),
    `import standaloner from 'standaloner';
await standaloner({ input: 'index.js', outDir: 'dist', bundle: { external: ['lodash4', 'esbuild', 'dual', 'cjs-parent', 'linked', 'alias-v3', 'alias-v4'] } });
`
  );

  console.log('Running standaloner inside Yarn PnP...');
  execSync('corepack yarn node build.js', { stdio: 'inherit', cwd: tmpDir });

  // Run the output with plain node: it must not need Yarn's PnP runtime
  const output = execFileSync('node', [path.join(tmpDir, 'dist', 'index.mjs')], {
    cwd: tmpDir,
  }).toString();
  console.log('Output:', output.trim());

  const expected = 'esm {"a":1,"b":2} let a = 1; cjs "cjs-parent" linked esm 3.10.1 4.17.21';
  if (output.trim() !== expected) {
    throw new Error(`Expected '${expected}', got '${output.trim()}'`);
  }
  console.log(
    "✓ Externals traced from Yarn PnP: npm: aliases, both builds of dual, portal: packages, esbuild's platform binary"
  );
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
