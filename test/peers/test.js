import standaloner from 'standaloner';
import fs from 'node:fs';
import os from 'node:os';
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

// standaloner looks for prebuilt binaries (*.node) in every traced install, so each copy ships one
const missing = expectedCopies['peer-host'].filter(
  copy => !fs.existsSync(path.join(nodeModules, '.versions', copy, 'proof.node'))
);
if (missing.length) {
  console.error(`✗ Each copy should ship its native binary; missing in: ${missing.join(', ')}`);
  process.exit(1);
}
console.log('✓ Each copy ships its native binary\n');

// npm-style tree: four installs of shared@1.0.0 with peers x and y; two load only one of them,
// so two copies serve all four
const treeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'standaloner-peers-'));
const write = (file, content) => {
  fs.mkdirSync(path.dirname(path.join(treeDir, file)), { recursive: true });
  fs.writeFileSync(path.join(treeDir, file), content);
};
const consumers = {
  'parent-x': [1, 2, "require('shared/x.cjs')"],
  'parent-y': [2, 1, "require('shared/y.cjs')"],
  'parent-21': [2, 1, "[require('shared/x.cjs'), require('shared/y.cjs')]"],
  'parent-12': [1, 2, "[require('shared/x.cjs'), require('shared/y.cjs')]"],
};
for (const [name, [x, y, exported]] of Object.entries(consumers)) {
  const dir = `src/node_modules/${name}`;
  write(`${dir}/package.json`, JSON.stringify({ name, version: '1.0.0', main: 'index.cjs' }));
  write(`${dir}/index.cjs`, `module.exports = ${exported};`);
  for (const [peer, version] of [
    ['x', x],
    ['y', y],
  ]) {
    write(
      `${dir}/node_modules/${peer}/package.json`,
      JSON.stringify({ name: peer, version: `${version}.0.0`, main: 'index.cjs' })
    );
    write(`${dir}/node_modules/${peer}/index.cjs`, `module.exports = ${version};`);
  }
  const shared = `${dir}/node_modules/shared`;
  write(
    `${shared}/package.json`,
    JSON.stringify({ name: 'shared', version: '1.0.0', peerDependencies: { x: '*', y: '*' } })
  );
  write(`${shared}/x.cjs`, "module.exports = require('x');");
  write(`${shared}/y.cjs`, "module.exports = require('y');");
}
const treeEntry = `console.log(JSON.stringify([${Object.keys(consumers)
  .map(name => `require('${name}')`)
  .join(', ')}]));`;
write('src/index.cjs', treeEntry);
await standaloner({
  input: path.join(treeDir, 'src/index.cjs'),
  outDir: path.join(treeDir, 'out'),
  bundle: false,
  verbose: false,
});
write('out/index.cjs', treeEntry);
const treeOutput = execSync('node out/index.cjs', { encoding: 'utf8', cwd: treeDir }).trim();
const sharedCopies = fs
  .readdirSync(path.join(treeDir, 'out/node_modules/.versions'))
  .filter(d => d.startsWith('shared@'));
if (treeOutput !== '[1,1,[2,1],[1,2]]' || sharedCopies.length !== 2) {
  console.error(
    '✗ Installs that load fewer dependencies should share a copy with one that matches'
  );
  console.error(`  Expected: [1,1,[2,1],[1,2]] with 2 copies of shared`);
  console.error(`  Got:      ${treeOutput} with ${sharedCopies.length} copies of shared`);
  process.exit(1);
}
fs.rmSync(treeDir, { recursive: true });
console.log('✓ Installs that load fewer dependencies share a matching copy\n');

console.log('=== All Peer Variants Tests Passed! ===');
