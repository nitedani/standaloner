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

  console.log('Installing dependencies (lodash, dual, local standaloner)...');
  execSync(
    `corepack yarn add lodash dual@${fileDep(path.join(__dirname, 'dual'))} standaloner@${fileDep(path.resolve(__dirname, '../../standaloner'))}`,
    { stdio: 'inherit', cwd: tmpDir }
  );

  fs.writeFileSync(
    path.join(tmpDir, 'index.js'),
    `import _ from 'lodash';
import { format } from 'dual';
console.log(format(_.defaults({ a: 1 }, { a: 3, b: 2 })));
`
  );
  fs.writeFileSync(
    path.join(tmpDir, 'build.js'),
    `import standaloner from 'standaloner';
await standaloner({ input: 'index.js', outDir: 'dist', bundle: { external: ['lodash', 'dual'] } });
`
  );

  console.log('Running standaloner inside Yarn PnP...');
  execSync('corepack yarn node build.js', { stdio: 'inherit', cwd: tmpDir });

  // Run the output with plain node: it must not need Yarn's PnP runtime
  const output = execFileSync('node', [path.join(tmpDir, 'dist', 'index.mjs')], {
    cwd: tmpDir,
  }).toString();
  console.log('Output:', output.trim());

  if (output.trim() !== 'esm {"a":1,"b":2}') {
    throw new Error(`Expected 'esm {"a":1,"b":2}', got '${output.trim()}'`);
  }
  console.log('✓ Externals traced from Yarn PnP, with the ESM build of a dual package');
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
