import { bundle, type BundleOptions } from './bundle.js';
import { trace } from './trace.js';
import { resolvePaths } from './utils/resolveOptions.js';
import { assertUsage } from './utils/utils.js';

export { standaloner as default, standaloner };
export type { StandalonerOptions };

type StandalonerOptions = {
  input: BundleOptions['input'];
  outDir?: string;
  bundle?: boolean | Omit<BundleOptions, 'input' | 'root'>;
  trace?: boolean;
  cleanup?: boolean;
  __isViteCall?: boolean;
};

const standaloner = async (options: StandalonerOptions) => {
  assertUsage(options.input, 'No input specified');
  const bundleOptions = typeof options.bundle === 'object' ? options.bundle : {};
  const { outDir, root, inputPaths, baseDir } = resolvePaths(options);


  // TODO: this is not good, we should trace first then bundle
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
          root,
          __isViteCall: options.__isViteCall,
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
