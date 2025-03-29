import standaloner from 'standaloner';

const res = await standaloner({
  input: { index: './server/index.ts' },
  outDir: './dist',
});
