import standaloner from 'standaloner';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('=== Asset Detection Test Suite ===\n');

// Clean up previous build
const distDir = path.join(__dirname, 'dist');
if (fs.existsSync(distDir)) {
  console.log('Cleaning up previous build...');
  fs.rmSync(distDir, { recursive: true });
}

// Build with standaloner
console.log('Building with standaloner...\n');
try {
  await standaloner({
    input: { index: './index.mjs' },
    outDir: './dist',
    bundle: true,
    trace: false,
    verbose: false,
  });
  console.log('✓ Build completed\n');
} catch (e) {
  console.error('✗ Build failed:', e.message);
  process.exit(1);
}

// Verify .static directory exists and contains assets
console.log('=== Verifying Asset Relocation ===\n');
const staticDir = path.join(distDir, '.static');
if (!fs.existsSync(staticDir)) {
  console.error('✗ .static directory not created!');
  process.exit(1);
}
console.log('✓ .static directory exists');

// Check for expected assets
const expectedAssets = [
  'test-data.txt',
  'image.png',
  'config.json',
  'nested-file.csv',
  'mock.node',
];

const staticFiles = fs.readdirSync(staticDir, { recursive: true }).map(f => String(f));
console.log('\nAssets found in .static:');
staticFiles.forEach(file => console.log('  -', file));

let missingAssets = [];
for (const asset of expectedAssets) {
  const found = staticFiles.some(f => f.includes(path.basename(asset)));
  if (found) {
    console.log(`✓ ${asset} relocated`);
  } else {
    console.log(`✗ ${asset} NOT FOUND`);
    missingAssets.push(asset);
  }
}

if (missingAssets.length > 0) {
  console.error('\n✗ Missing assets:', missingAssets.join(', '));
  console.error('Asset relocation test FAILED');
  process.exit(1);
}

// Run the built file to verify assets are accessible
console.log('\n=== Testing Built Application ===\n');
try {
  const output = execSync('node dist/index.mjs', { 
    encoding: 'utf8', 
    cwd: __dirname,
    stdio: ['pipe', 'pipe', 'pipe']
  });
  console.log(output);
  
  // Check for expected success messages
  const requiredOutputs = [
    'test-data.txt via URL',
    'image.png via URL',
    'config.json via path.join',
    'nested-file.csv via path.join',
    'fs.statSync on test-data.txt',
    'mock.node file exists',
    'All Asset Detection Tests Passed',
  ];
  
  let allFound = true;
  for (const expected of requiredOutputs) {
    if (!output.includes(expected)) {
      console.error(`✗ Missing expected output: "${expected}"`);
      allFound = false;
    }
  }
  
  if (!allFound) {
    console.error('\n✗ Application test FAILED - missing expected outputs');
    process.exit(1);
  }
  
  console.log('\n✓ All application tests passed');
} catch (error) {
  console.error('✗ Failed to run built application:', error.message);
  if (error.stdout) console.log('stdout:', error.stdout.toString());
  if (error.stderr) console.error('stderr:', error.stderr.toString());
  process.exit(1);
}

console.log('\n=== All Asset Detection Tests Passed! ===');
console.log('✓ Asset relocation working correctly');
console.log('✓ All 5 asset detection types verified');
console.log('✓ Built application can access all assets');
