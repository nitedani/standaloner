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

// npm-style trees: each consumer nests its own shared@1.0.0 (peers x and y), x, y and maybe z
const pkg = (name, version, main) => ({
  'package.json': JSON.stringify({ name, version: `${version}.0.0`, main: 'index.cjs' }),
  'index.cjs': `module.exports = ${main};`,
});
const checkTree = (title, consumers, expected) => {
  const treeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'standaloner-peers-'));
  const files = {};
  const add = (dir, pkgFiles) => {
    for (const [file, content] of Object.entries(pkgFiles)) files[`${dir}/${file}`] = content;
  };
  for (const [name, { x, y, z, loads }] of Object.entries(consumers)) {
    const dir = `src/node_modules/${name}`;
    add(dir, pkg(name, 1, loads));
    add(`${dir}/node_modules/shared`, {
      'package.json': JSON.stringify({
        name: 'shared',
        version: '1.0.0',
        peerDependencies: { x: '*', y: '*' },
      }),
      'x.cjs': "module.exports = require('x');",
      'y.cjs': "module.exports = require('y');",
    });
    add(`${dir}/node_modules/x`, z ? pkg('x', 1, "'x' + require('z')") : pkg('x', x, x));
    if (z) add(`${dir}/node_modules/z`, pkg('z', z, `'z${z}'`));
    add(`${dir}/node_modules/y`, pkg('y', y, y));
  }
  const entry = `console.log(JSON.stringify([${Object.keys(consumers).map(c => `require('${c}')`)}]));`;
  files['src/package.json'] = JSON.stringify({ name: 'tree', private: true });
  files['src/index.cjs'] = entry;
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(treeDir, file)), { recursive: true });
    fs.writeFileSync(path.join(treeDir, file), content);
  }
  return standaloner({
    input: path.join(treeDir, 'src/index.cjs'),
    outDir: path.join(treeDir, 'out'),
    bundle: false,
    verbose: false,
  }).then(() => {
    fs.writeFileSync(path.join(treeDir, 'out/index.cjs'), entry);
    const output = execSync('node out/index.cjs', { encoding: 'utf8', cwd: treeDir }).trim();
    const shared = fs.readdirSync(path.join(treeDir, 'out/node_modules/.versions'));
    const copies = shared.filter(d => d.startsWith('shared@')).length;
    fs.rmSync(treeDir, { recursive: true });
    if (output !== expected || copies !== 2) {
      console.error(`✗ ${title}`);
      console.error(`  Expected: ${expected} with 2 copies of shared`);
      console.error(`  Got:      ${output} with ${copies} copies of shared`);
      process.exit(1);
    }
    console.log(`✓ ${title}\n`);
  });
};
const both = "[require('shared/x.cjs'), require('shared/y.cjs')]";
await checkTree(
  'Installs that load only one peer share a matching copy',
  {
    'parent-x': { x: 1, y: 2, loads: "require('shared/x.cjs')" },
    'parent-y': { x: 2, y: 1, loads: "require('shared/y.cjs')" },
    'parent-21': { x: 2, y: 1, loads: both },
    'parent-12': { x: 1, y: 2, loads: both },
  },
  '[1,1,[2,1],[1,2]]'
);
// x splits by its own peer z, after shared's first grouping
await checkTree(
  'An install that loads only one peer shares a copy split one level down',
  {
    'parent-22': { z: 2, y: 2, loads: both },
    'parent-11': { z: 1, y: 1, loads: both },
    'parent-x': { z: 1, y: 2, loads: "require('shared/x.cjs')" },
  },
  '[["xz2",2],["xz1",1],"xz1"]'
);

console.log('=== All Peer Variants Tests Passed! ===');
