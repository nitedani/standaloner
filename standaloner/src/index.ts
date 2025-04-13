import { bundle, type BundleOptions } from './bundle.js';
import { trace } from './trace.js';
import { resolvePaths } from './utils/resolveOptions.js';
import { assertUsage } from './utils/utils.js';
import { setVerbose } from './utils/logging.js';

export { standaloner as default, standaloner };
export type { StandalonerOptions };

type StandalonerOptions = {
  input: BundleOptions['input'];
  outDir?: string;
  bundle?:
    | boolean
    | (Omit<BundleOptions, 'input' | 'root' | 'external'> & { external?: (string | RegExp)[] });
  trace?: boolean;
  cleanup?: boolean;
  verbose?: boolean;
};

const standaloner = async (options: StandalonerOptions) => {
  assertUsage(options.input, 'No input specified');

  // Set verbose mode if specified
  if (options.verbose !== undefined) {
    setVerbose(options.verbose);
  }

  const bundleOptions = typeof options.bundle === 'object' ? options.bundle : {};
  const { outDir, root, inputPaths, baseDir } = resolvePaths(options);
  const plugins = [bundleOptions.plugins].flat();
  const shouldTrace = options.trace ?? true;

  const bundleOutput =
    options.bundle !== false
      ? await bundle({
          ...bundleOptions,
          input: options.input,
          plugins,
          output: {
            ...bundleOptions.output,
            dir: bundleOptions.output?.dir ?? outDir,
          },
          cleanup: options.cleanup,
          root,
        })
      : null;

  if (shouldTrace) {
    await trace({
      input: bundleOutput?.outFilePaths ?? inputPaths,
      baseDir,
      outDir,
      root,
    });
  }

  return null;
};
