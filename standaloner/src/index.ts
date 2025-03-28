import { bundle, type BundleOptions } from './bundle.js';
import path from 'path';
import { trace } from './trace.js';
import { searchForPackageRoot, searchForWorkspaceRoot } from './utils/searchRoot.js';
import { assertUsage, findCommonAncestor, resolveInputs } from './utils/utils.js';

export { standaloner };
export { standaloner as default };
export type { StandalonerOptions };

type StandalonerOptions = {
  input: BundleOptions['input'];
  outDir?: string;
  bundle?: boolean | Omit<BundleOptions, 'input'>;
  trace?: boolean;
  cleanup?: boolean;
};

const standaloner = async (options: StandalonerOptions) => {
  assertUsage(options.input, 'No input specified');
  const inputPaths = resolveInputs(options.input);
  const inputCommonDir = findCommonAncestor(inputPaths);
  const outDir = options.outDir ? path.join(process.cwd(), options.outDir) : inputCommonDir;
  const baseDir = searchForWorkspaceRoot(inputCommonDir);
  const root = searchForPackageRoot(inputCommonDir);
  const bundleOptions = typeof options.bundle === 'object' ? options.bundle : {};

  const bundleOutput =
    options.bundle !== false
      ? await bundle({
          ...bundleOptions,
          input: options.input,
          output: {
            ...bundleOptions.output,
            dir: bundleOptions.output?.dir ?? outDir,
          },
          cleanup: options.cleanup,
        })
      : null;

  if (options.trace ?? true) {
    await trace({
      input: bundleOutput?.outFilePaths ?? inputPaths,
      baseDir,
      outDir,
      root,
    });
  }

  return null;
};
