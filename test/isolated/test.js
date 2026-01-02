import standaloner from 'standaloner';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

console.log('=== Testing Isolated Build Feature ===\n');

// Clean up previous builds
const distIsolated = path.join(__dirname, 'dist-isolated');
const distNormal = path.join(__dirname, 'dist-normal');
if (fs.existsSync(distIsolated)) {
  fs.rmSync(distIsolated, { recursive: true });
}
if (fs.existsSync(distNormal)) {
  fs.rmSync(distNormal, { recursive: true });
}

// Test 1: Build with isolated=true
console.log('Test 1: Building with isolated=true...');
await standaloner({
  input: {
    functionA: './functionA.mjs',
    functionB: './functionB.mjs',
    functionC: './functionC.mjs',
  },
  outDir: './dist-isolated',
  bundle: {
    isolated: true,
  },
  trace: false,
  verbose: false,
});
console.log('✓ Isolated build completed\n');

// Test 2: Build with isolated=false (normal)
console.log('Test 2: Building with isolated=false (normal)...');
await standaloner({
  input: {
    functionA: './functionA.mjs',
    functionB: './functionB.mjs',
    functionC: './functionC.mjs',
  },
  outDir: './dist-normal',
  bundle: {
    isolated: false,
  },
  trace: false,
  verbose: false,
});
console.log('✓ Normal build completed\n');

// Verify results
console.log('=== Verification ===\n');

// Check isolated build - should have only entry files (no shared chunks)
const isolatedFiles = fs.readdirSync(distIsolated).filter(f => f.endsWith('.mjs'));
console.log(`Isolated build files: ${isolatedFiles.join(', ')}`);

// Check normal build - should have entry files AND shared chunks
const normalFiles = fs.readdirSync(distNormal).filter(f => f.endsWith('.mjs'));
console.log(`Normal build files: ${normalFiles.join(', ')}`);

// Test 3: Verify isolated files have no shared chunks
const hasOnlyEntries = isolatedFiles.every(f => 
  f === 'functionA.mjs' || f === 'functionB.mjs' || f === 'functionC.mjs'
);
if (!hasOnlyEntries) {
  console.error('\n❌ FAIL: Isolated build created unexpected chunk files!');
  console.error('Expected only: functionA.mjs, functionB.mjs, functionC.mjs');
  console.error('Found:', isolatedFiles);
  process.exit(1);
}
console.log('✓ Isolated build has no shared chunks\n');

// Test 4: Verify normal build has shared chunks
const hasSharedChunks = normalFiles.some(f => 
  !['functionA.mjs', 'functionB.mjs', 'functionC.mjs'].includes(f)
);
if (!hasSharedChunks) {
  console.log('⚠ Warning: Normal build did not create shared chunks (might be expected for small files)\n');
} else {
  const sharedChunks = normalFiles.filter(f => 
    !['functionA.mjs', 'functionB.mjs', 'functionC.mjs'].includes(f)
  );
  console.log(`✓ Normal build created shared chunks: ${sharedChunks.join(', ')}\n`);
}

// Test 5: Verify isolated files are self-contained and executable
console.log('Test 3: Verifying isolated files can run independently...');
try {
  const outputA = execSync('node dist-isolated/functionA.mjs', { encoding: 'utf8', cwd: __dirname });
  if (!outputA.includes('Function A: Processing: A') || !outputA.includes('Calculation A: 30')) {
    throw new Error('functionA.mjs output is incorrect');
  }
  
  const outputB = execSync('node dist-isolated/functionB.mjs', { encoding: 'utf8', cwd: __dirname });
  if (!outputB.includes('Function B: Processing: B') || !outputB.includes('Calculation B: 20')) {
    throw new Error('functionB.mjs output is incorrect');
  }
  
  const outputC = execSync('node dist-isolated/functionC.mjs', { encoding: 'utf8', cwd: __dirname });
  if (!outputC.includes('Function C: Processing: C') || !outputC.includes('Calculation C: 300')) {
    throw new Error('functionC.mjs output is incorrect');
  }
  
  console.log('✓ All isolated files execute correctly and independently\n');
} catch (error) {
  console.error('\n❌ FAIL: Isolated files failed to execute correctly!');
  console.error(error.message);
  process.exit(1);
}

// Test 6: Compare file sizes
console.log('=== File Size Comparison ===\n');
const isolatedSizes = isolatedFiles.map(f => {
  const size = fs.statSync(path.join(distIsolated, f)).size;
  return { file: f, size };
});
const normalSizes = normalFiles.map(f => {
  const size = fs.statSync(path.join(distNormal, f)).size;
  return { file: f, size };
});

console.log('Isolated files:');
isolatedSizes.forEach(({ file, size }) => console.log(`  ${file}: ${size} bytes`));

console.log('\nNormal files:');
normalSizes.forEach(({ file, size }) => console.log(`  ${file}: ${size} bytes`));

// Isolated files should be larger (self-contained) or equal if no chunking happened
const isolatedTotal = isolatedSizes.reduce((sum, { size }) => sum + size, 0);
const normalTotal = normalSizes.reduce((sum, { size }) => sum + size, 0);

console.log(`\nTotal isolated: ${isolatedTotal} bytes`);
console.log(`Total normal: ${normalTotal} bytes`);

if (hasSharedChunks) {
  // When there are shared chunks, isolated files should be larger individually
  const isolatedEntry = isolatedSizes.find(s => s.file === 'functionA.mjs');
  const normalEntry = normalSizes.find(s => s.file === 'functionA.mjs');
  
  if (isolatedEntry.size <= normalEntry.size) {
    console.error('\n❌ FAIL: Isolated entry files should be larger than normal entry files when chunks exist!');
    process.exit(1);
  }
  console.log('✓ Isolated files are self-contained (larger than normal entries)\n');
}

console.log('\n=== All Tests Passed! ===');
console.log('The isolated build feature is working correctly.');
