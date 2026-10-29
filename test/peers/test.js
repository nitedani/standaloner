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
const expected = 'app: peer-dep 1.0.0/1.0.0, peer-typed; peer-user: peer-dep 2.0.0, peer-typed';
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

// standaloner adds the prebuilt binaries (*.node) nothing imports to each output copy
const missing = expectedCopies['peer-host'].filter(
  copy => !fs.existsSync(path.join(nodeModules, '.versions', copy, 'proof.node'))
);
if (missing.length) {
  console.error(`✗ Each copy should ship its native binary; missing in: ${missing.join(', ')}`);
  process.exit(1);
}
console.log('✓ Each copy ships its native binary\n');

// npm-style trees: each consumer nests its own shared@1.0.0 and its peers; a peer given as
// { z } is x@1.0.0 loading its own peer z
const pkg = (name, version, main) => ({
  'package.json': JSON.stringify({ name, version: `${version}.0.0`, main: 'index.cjs' }),
  'index.cjs': `module.exports = ${main};`,
});
const writeTree = files => {
  const treeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'standaloner-peers-'));
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(treeDir, file)), { recursive: true });
    fs.writeFileSync(path.join(treeDir, file), content);
  }
  return treeDir;
};
const checkTree = async (title, consumers, expected) => {
  const files = {
    'src/package.json': JSON.stringify({ name: 'tree', private: true }),
    'src/index.cjs': `console.log(JSON.stringify([${Object.keys(consumers).map(c => `require('${c}')`)}]));`,
  };
  const add = (dir, pkgFiles) => {
    for (const [file, content] of Object.entries(pkgFiles)) files[`${dir}/${file}`] = content;
  };
  for (const [name, { peers, loads }] of Object.entries(consumers)) {
    const dir = `src/node_modules/${name}`;
    const required = loads.map(peer => `require('shared/${peer}.cjs')`);
    add(dir, pkg(name, 1, required.length === 1 ? required[0] : `[${required}]`));
    const shared = { 'package.json': JSON.stringify({ name: 'shared', version: '1.0.0' }) };
    for (const [peer, version] of Object.entries(peers)) {
      shared[`${peer}.cjs`] = `module.exports = require('${peer}');`;
      if (typeof version === 'number')
        add(`${dir}/node_modules/${peer}`, pkg(peer, version, version));
      else {
        add(`${dir}/node_modules/${peer}`, pkg(peer, 1, `'${peer}' + require('z')`));
        add(`${dir}/node_modules/z`, pkg('z', version.z, `'z${version.z}'`));
      }
    }
    add(`${dir}/node_modules/shared`, shared);
  }
  const treeDir = writeTree(files);
  await standaloner({
    input: path.join(treeDir, 'src/index.cjs'),
    outDir: path.join(treeDir, 'out'),
    bundle: false,
    verbose: false,
  });
  fs.copyFileSync(path.join(treeDir, 'src/index.cjs'), path.join(treeDir, 'out/index.cjs'));
  const output = execSync('node out/index.cjs', { encoding: 'utf8', cwd: treeDir }).trim();
  const versions = fs.readdirSync(path.join(treeDir, 'out/node_modules/.versions'));
  const copies = versions.filter(d => d.startsWith('shared@')).length;
  fs.rmSync(treeDir, { recursive: true });
  if (output !== expected || copies !== 2) {
    console.error(`✗ ${title}`);
    console.error(`  Expected: ${expected} with 2 copies of shared`);
    console.error(`  Got:      ${output} with ${copies} copies of shared`);
    process.exit(1);
  }
  console.log(`✓ ${title}\n`);
};
await checkTree(
  'Installs that load only one peer share a matching copy',
  {
    'parent-x': { peers: { x: 1, y: 2 }, loads: ['x'] },
    'parent-y': { peers: { x: 2, y: 1 }, loads: ['y'] },
    'parent-21': { peers: { x: 2, y: 1 }, loads: ['x', 'y'] },
    'parent-12': { peers: { x: 1, y: 2 }, loads: ['x', 'y'] },
  },
  '[1,1,[2,1],[1,2]]'
);
await checkTree(
  'An install that loads only one peer shares a copy split one level down',
  {
    'parent-22': { peers: { x: { z: 2 }, y: 2 }, loads: ['x', 'y'] },
    'parent-11': { peers: { x: { z: 1 }, y: 1 }, loads: ['x', 'y'] },
    'parent-x': { peers: { x: { z: 1 }, y: 2 }, loads: ['x'] },
  },
  '[["xz2",2],["xz1",1],"xz1"]'
);

// With bundle: false the app's other files ship beside its entry, so they resolve through the top
// level; the package around the app is a dependency like any other
const appDir = writeTree({
  'pnpm-workspace.yaml': 'packages: [src]',
  'package.json': JSON.stringify({ name: 'outer', version: '1.0.0', main: 'root.cjs' }),
  'root.cjs': "module.exports = require('dep');",
  'src/package.json': JSON.stringify({ name: 'app', private: true }),
  'src/index.cjs': "console.log(JSON.stringify([require('./helper.cjs'), require('outer')]));",
  'src/helper.cjs': "module.exports = require('dep');",
  ...Object.fromEntries(
    [
      ['node_modules/dep', pkg('dep', 2, "'new'")],
      ['src/node_modules/dep', pkg('dep', 1, "'old'")],
    ].flatMap(([dir, pkgFiles]) =>
      Object.entries(pkgFiles).map(([file, content]) => [`${dir}/${file}`, content])
    )
  ),
});
fs.symlinkSync('../..', path.join(appDir, 'src/node_modules/outer'));
await standaloner({
  input: path.join(appDir, 'src/index.cjs'),
  outDir: path.join(appDir, 'out'),
  bundle: false,
  verbose: false,
});
for (const file of ['index.cjs', 'helper.cjs'])
  fs.copyFileSync(path.join(appDir, 'src', file), path.join(appDir, 'out', file));
const appOutput = execSync('node out/index.cjs', { encoding: 'utf8', cwd: appDir }).trim();
fs.rmSync(appDir, { recursive: true });
if (appOutput !== '["old","new"]') {
  console.error("✗ The app's own files should load the app's copy from the top level");
  console.error('  Expected: ["old","new"]');
  console.error(`  Got:      ${appOutput}`);
  process.exit(1);
}
console.log("✓ The app's own files load the app's copy from the top level\n");

console.log('=== All Peer Variants Tests Passed! ===');
