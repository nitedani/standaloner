import standaloner from 'standaloner';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('=== Peer Variants Test ===\n');

// Clean up previous build
const distDir = path.join(__dirname, 'dist');
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true });
}

// pnpm installs peer-wrapper, its peer-host and peer-typed once per peer-dep version
await standaloner({
  input: { index: './index.mjs' },
  outDir: './dist',
  bundle: { external: [/^peer-/] },
  verbose: false,
});
console.log('✓ Build completed\n');

const output = execSync('node dist/index.mjs', { encoding: 'utf8', cwd: __dirname }).trim();
const expected = 'app: peer-dep 1.0.0, peer-typed; peer-user: peer-dep 2.0.0, peer-typed';
if (output !== expected) {
  console.error('✗ Each install should load its own peer-dep version');
  console.error(`  Expected: ${expected}`);
  console.error(`  Got:      ${output}`);
  process.exit(1);
}
console.log('✓ Each install loads its own peer-dep version\n');

// peer-typed never loads peer-dep, so its two installs are identical
const nodeModules = path.join(distDir, 'node_modules');
const copiesOf = name =>
  [
    ...fs.readdirSync(path.join(nodeModules, '.versions')).filter(d => d.startsWith(`${name}@`)),
    ...(fs.lstatSync(path.join(nodeModules, name)).isDirectory() ? [name] : []),
  ].sort();
const names = ['peer-host', 'peer-typed', 'peer-wrapper'];
const copies = Object.fromEntries(names.map(name => [name, copiesOf(name)]));
const expectedCopies = {
  'peer-host': ['peer-host@1.0.0', 'peer-host@1.0.0_1'],
  'peer-typed': ['peer-typed'],
  'peer-wrapper': ['peer-wrapper@1.0.0', 'peer-wrapper@1.0.0_1'],
};
if (JSON.stringify(copies) !== JSON.stringify(expectedCopies)) {
  console.error('✗ Only installs that load different dependencies should get their own copy');
  console.error(`  Expected: ${JSON.stringify(expectedCopies)}`);
  console.error(`  Got:      ${JSON.stringify(copies)}`);
  process.exit(1);
}
console.log('✓ Identical installs share one copy\n');

console.log('=== All Peer Variants Tests Passed! ===');
