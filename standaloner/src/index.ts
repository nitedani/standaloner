import { bundle, type BundleOptions } from './bundle.js';
import { trace } from './trace.js';
import { resolvePaths } from './utils/resolveOptions.js';
import { assertUsage } from './utils/utils.js';
import { setVerbose } from './utils/logging.js';
import { viteTransformPlugin } from 'rolldown/experimental';

export { standaloner as default, standaloner };
export type { StandalonerOptions };

/**
 * Options for the standaloner function
 */
type StandalonerOptions = {
  /**
   * Input file(s) to process.
   */
  input: BundleOptions['input'];

  /**
   * Output directory for the bundled files and dependencies.
   * If specified, the path is resolved relative to the current working directory.
   * If not specified, a 'dist' directory will be created in the common ancestor directory of all input files.
   */
  outDir?: string;

  /**
   * Controls the bundling behavior:
   * - `true` (default): Bundle the input files
   * - `false`: Skip bundling and only trace dependencies
   * - Object: Custom bundling options
   */
  bundle?:
    | boolean
    | (Omit<BundleOptions, 'input' | 'root' | 'external'> & {
        external?: (string | RegExp)[];
        isolated?: boolean;
      });

  /**
   * Whether to trace and copy dependencies:
   * - `true` (default): Trace and copy dependencies
   * - `false`: Skip dependency tracing
   */
  trace?: boolean;

  /**
   * Whether to delete the input files after processing:
   * - `true`: Delete input files after processing
   * - `false` (default): Keep input files
   *
   * This is useful when you want to clean up temporary files
   * that were generated during the build process.
   */
  cleanup?: boolean;

  /**
   * Whether to enable verbose logging:
   * - `true`: Show detailed logs
   * - `false` (default): Show only essential logs
   */
  verbose?: boolean;
};

/**
 * Processes JavaScript/TypeScript files to create a standalone package.
 *
 * This function:
 * 1. Bundles the input files (if bundle=true)
 * 2. Traces dependencies (if trace=true)
 * 3. Copies all required files to the output directory
 *
 * @param options Configuration options for the standaloner
 * @returns Promise that resolves when processing is complete
 */
const standaloner = async (options: StandalonerOptions) => {
  assertUsage(options.input, 'No input specified');
  if (options.verbose !== undefined) {
    setVerbose(options.verbose);
  }
  const bundleOptions = typeof options.bundle === 'object' ? options.bundle : {};
  const { outDir, root, inputPaths, baseDir } = resolvePaths(options);
  const shouldTrace = options.trace ?? true;

  const plugins = [bundleOptions.plugins].flat().filter(Boolean);
  plugins.push(viteTransformPlugin());

  const bundleOutput =
    options.bundle !== false
      ? await bundle({
          ...bundleOptions,
          plugins,
          input: options.input,
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
      // Use bundled output files if available, otherwise use original input paths
      input: bundleOutput?.outFilePaths ?? inputPaths,
      baseDir,
      outDir,
      root,
    });
  }

  return null;
};
