import { bundle, type BundleOptions } from './bundle.js';
import { trace } from './trace.js';
import { resolvePaths } from './utils/resolveOptions.js';
import { assertUsage } from './utils/utils.js';
import { setVerbose } from './utils/logging.js';

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
    | (Omit<BundleOptions, 'input' | 'root' | 'external'> & { external?: (string | RegExp)[] });

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

  // Set verbose mode if specified
  if (options.verbose !== undefined) {
    setVerbose(options.verbose);
  }

  // Resolve bundle options - use empty object if bundle is true or undefined
  const bundleOptions = typeof options.bundle === 'object' ? options.bundle : {};

  // Resolve paths for input, output, and project root
  const { outDir, root, inputPaths, baseDir } = resolvePaths(options);

  // Flatten plugins array to handle both single plugins and arrays
  const plugins = [bundleOptions.plugins].flat();

  // Determine if we should trace dependencies (default to true)
  const shouldTrace = options.trace ?? true;

  // Bundle the input files if bundling is enabled
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
          // Pass cleanup option to delete input files after bundling if specified
          cleanup: options.cleanup,
          root,
        })
      : null;

  // Trace and copy dependencies if tracing is enabled
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
