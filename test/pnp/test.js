import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The root of the standaloner package, for installing local dependency setup properly
const localStandalonerPath = path.resolve(__dirname, '../../standaloner');
// Format path for Yarn (file: protocol format requires front slashes)
const yarnStandalonerPath = 'file:' + localStandalonerPath.replace(/\\/g, '/');

// Create a totally isolated temporary directory for the Yarn PnP test
// This is to avoid triggering any parent `package.json` packageManager flags (like pnpm workspace)
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'standaloner-pnp-test-'));
console.log(`Created temporary Yarn PnP directory: ${tmpDir}`);

try {
  // 1. Initialize Yarn PnP project non-interactively
  console.log('Initializing Yarn PnP project...');
  const pkgJsonPath = path.join(tmpDir, 'package.json');
  fs.writeFileSync(pkgJsonPath, JSON.stringify({
    name: 'standaloner-pnp-test',
    private: true,
    type: 'module'
  }, null, 2));
  execSync('corepack yarn set version berry', { stdio: 'inherit', cwd: tmpDir });
  execSync('corepack yarn install', { stdio: 'inherit', cwd: tmpDir });

  // 2. Install a dependency (lodash) and 3. install the local standaloner package
  console.log('Installing dependencies (lodash, local standaloner)...');
  execSync('corepack yarn add lodash', { stdio: 'inherit', cwd: tmpDir });
  execSync(`corepack yarn add standaloner@${yarnStandalonerPath}`, { stdio: 'inherit', cwd: tmpDir });

  // 4. Create a basic JS file that imports the dependency
  console.log('Creating source files...');
  fs.writeFileSync(path.join(tmpDir, 'index.js'), `
    import _ from 'lodash';
    export const res = _.defaults({ 'a': 1 }, { 'a': 3, 'b': 2 });
    console.log('Lodash merge result:', res);
  `);

  // Create a builder script
  fs.writeFileSync(path.join(tmpDir, 'build.js'), `
    import standaloner from 'standaloner';

    console.log('Bundling index.js inside Yarn PnP...');
    standaloner({
      input: 'index.js',
      outDir: 'dist',
      bundle: true,
      trace: true
    }).then(() => {
      console.log('Bundle finished.');
    }).catch(err => {
      console.error(err);
      process.exit(1);
    });
  `);

  // 5. Run standaloner to bundle it
  console.log('Running standaloner builder script...');
  execSync('corepack yarn node build.js', { stdio: 'inherit', cwd: tmpDir });

  // 6. Execute the output to verify it works perfectly
  console.log('Verifying output behaves as expected...');
  // The output might default to .mjs or .js
  let distEntry = path.join(tmpDir, 'dist', 'index.js');
  if (!fs.existsSync(distEntry)) {
    distEntry = path.join(tmpDir, 'dist', 'index.mjs');
  }
  if (!fs.existsSync(distEntry)) {
    throw new Error(`Build output file dist/index.js or dist/index.mjs not found!`);
  }

  const output = execSync(`node ${distEntry}`, { stdio: 'pipe', cwd: tmpDir }).toString();
  console.log('Execution output:', output);

  if (output.includes('Lodash merge result: { a: 1, b: 2 }')) {
    console.log('\u2714 Success: Output was bundled correctly and runs perfectly!');
  } else {
    throw new Error('Test logic failed! Expected lodash merged result in output.');
  }
} finally {
  console.log('Cleaning up temporary isolated directory...');
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
