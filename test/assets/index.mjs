import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('=== Asset Detection Test ===\n');

// Type 1: new URL() - URL references
console.log('1. Testing URL references (new URL):');
try {
  const url1 = new URL('./test-data.txt', import.meta.url);
  const content1 = fs.readFileSync(url1, 'utf-8');
  console.log('   ✓ test-data.txt via URL:', content1.trim());
} catch (e) {
  console.error('   ✗ Failed to load test-data.txt via URL:', e.message);
  process.exit(1);
}

try {
  const url2 = new URL('./image.png', import.meta.url);
  const exists = fs.existsSync(url2);
  if (!exists) {
    throw new Error('File does not exist');
  }
  const stats = fs.statSync(url2);
  console.log('   ✓ image.png via URL: loaded', stats.size, 'bytes');
} catch (e) {
  console.error('   ✗ Failed to load image.png via URL:', e.message);
  process.exit(1);
}

// Type 2: path.join(__dirname) - Path operations
console.log('\n2. Testing path.join with __dirname:');
try {
  const configPath = path.join(__dirname, 'config.json');
  const configContent = fs.readFileSync(configPath, 'utf-8');
  const config = JSON.parse(configContent);
  console.log('   ✓ config.json via path.join:', config);
} catch (e) {
  console.error('   ✗ Failed to load config.json via path.join:', e.message);
  process.exit(1);
}

try {
  const nestedPath = path.join(__dirname, 'data', 'nested-file.csv');
  const nestedContent = fs.readFileSync(nestedPath, 'utf-8');
  console.log('   ✓ nested-file.csv via path.join:', nestedContent.split('\n')[0]);
} catch (e) {
  console.error('   ✗ Failed to load nested-file.csv via path.join:', e.message);
  process.exit(1);
}

// Type 3: fs operations with literal paths
console.log('\n3. Testing fs operations with relative paths:');
try {
  const filePath = fileURLToPath(new URL('./test-data.txt', import.meta.url));
  const stats = fs.statSync(filePath);
  console.log('   ✓ fs.statSync on test-data.txt: size =', stats.size, 'bytes');
} catch (e) {
  console.error('   ✗ Failed fs.statSync on test-data.txt:', e.message);
  process.exit(1);
}

try {
  const content = fs.readFileSync(fileURLToPath(new URL('./config.json', import.meta.url)), 'utf-8');
  console.log('   ✓ fs.readFileSync on config.json:', content.length, 'bytes');
} catch (e) {
  console.error('   ✗ Failed fs.readFileSync on config.json:', e.message);
  process.exit(1);
}

// Type 4: require() for .node files (if supported)
console.log('\n4. Testing require for .node files:');
try {
  // Note: This is a mock .node file, not a real binary module
  // Real .node files would need to be compiled native modules
  const nodePath = path.join(__dirname, 'mock.node');
  const exists = fs.existsSync(nodePath);
  console.log('   ✓ mock.node file exists:', exists);
  if (exists) {
    const content = fs.readFileSync(nodePath, 'utf-8');
    console.log('   ✓ mock.node content:', content.trim());
  }
} catch (e) {
  console.error('   ✗ Failed to check mock.node:', e.message);
  process.exit(1);
}

// Type 5: Verify all assets are accessible
console.log('\n5. Verifying all assets are accessible:');
const assetChecks = [
  { name: 'test-data.txt', check: () => fs.existsSync(new URL('./test-data.txt', import.meta.url)) },
  { name: 'image.png', check: () => fs.existsSync(new URL('./image.png', import.meta.url)) },
  { name: 'config.json', check: () => fs.existsSync(path.join(__dirname, 'config.json')) },
  { name: 'nested-file.csv', check: () => fs.existsSync(path.join(__dirname, 'data/nested-file.csv')) },
  { name: 'mock.node', check: () => fs.existsSync(path.join(__dirname, 'mock.node')) },
];

for (const { name, check } of assetChecks) {
  try {
    const exists = check();
    console.log(`   ✓ ${name}: ${exists ? 'accessible' : 'NOT accessible'}`);
    if (!exists) {
      console.error(`   Asset ${name} is not accessible!`);
      process.exit(1);
    }
  } catch (e) {
    console.error(`   ✗ Failed to check ${name}:`, e.message);
    process.exit(1);
  }
}

console.log('\n=== All Asset Detection Tests Passed! ===');
