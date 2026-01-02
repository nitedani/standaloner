import path from 'path';
import { cpus } from 'os';
import pLimit from 'p-limit';
import {
  build,
  type BuildOptions,
  type RolldownOutput,
  type OutputChunk,
  type OutputAsset,
} from 'rolldown';
import { assetRelocatorPlugin } from './relocate.js';
import { assert } from './utils/utils.js';
import { defaultExternalsPlugin } from './utils/default-externals.js';
import { cleanup as cleanup_ } from './utils/cleanup.js';

/**
 * Return type for the bundle function
 */
export type BundleResult = RolldownOutput & {
  outFilePaths: string[];
};

/**
 * Options for the bundle function
 */
export type BundleOptions = Omit<BuildOptions, 'external'> & {
  /**
   * Patterns to exclude from bundling
   */
  external?: (string | RegExp)[];

  /**
   * Whether to delete the input files after bundling:
   * - `true`: Delete input files after bundling
   * - `false` (default): Keep input files
   *
   * This is useful when you want to clean up temporary files
   * that were generated during the build process.
   */
  cleanup?: boolean;

  /**
   * Project root directory
   */
  root: string;

  /**
   * Whether to build each entry in isolation:
   * - `true`: Build each entry separately to ensure no shared chunks
   * - `false` (default): Build all entries together, allowing chunk sharing
   *
   * This is useful for serverless deployments like Vercel where each
   * function needs to be completely self-contained.
   */
  isolated?: boolean;
};

/**
 * Bundles JavaScript/TypeScript files using Rolldown
 *
 * @param options Configuration options for the bundler
 * @returns Promise that resolves with information about the bundled files
 */
export const bundle = async (options: BundleOptions): Promise<BundleResult> => {
  assert(options.input, 'No input specified');
  assert(options.output?.dir, 'No output directory specified');

  const { cleanup, root, isolated, ...rest } = options;

  // If isolated mode is enabled and input is an object with multiple entries,
  // build each entry separately (concurrently, limited by CPU cores)
  if (isolated && typeof rest.input === 'object' && !Array.isArray(rest.input)) {
    const entries = Object.entries(rest.input);
    
    if (entries.length > 1) {
      // Build entries concurrently with limited concurrency to avoid resource contention
      // Use half the CPU cores to prevent overwhelming file system and memory
      // Using p-limit allows builds to start as soon as a slot is available,
      // rather than waiting for all builds in a batch to complete
      const concurrency = Math.max(1, Math.ceil(cpus().length / 2));
      const limit = pLimit(concurrency);
      
      const results = await Promise.all(
        entries.map(([name, entryPath]) =>
          limit(async () => {
            return await bundle({
              ...options,
              isolated: false, // Prevent recursive isolated builds
              input: { [name]: entryPath },
            });
          })
        )
      );

      // Aggregate outputs from all builds
      const allOutputs: (OutputChunk | OutputAsset)[] = [];
      const allOutFilePaths: string[] = [];
      for (const result of results) {
        allOutputs.push(...result.output);
        allOutFilePaths.push(...result.outFilePaths);
      }

      // Return aggregated result with type assertion
      // Note: Type assertion is necessary because RolldownOutput has complex internal
      // properties (like Symbol-based properties) that cannot be properly spread/copied.
      // We aggregate the outputs array which is what consumers actually use.
      return {
        output: allOutputs,
        outFilePaths: allOutFilePaths,
      } as BundleResult;
    }
  }

  // Set up plugins
  const plugins = [rest.plugins].flat().filter(Boolean);
  plugins.push(assetRelocatorPlugin({ outputDir: '.static' }));
  plugins.push(defaultExternalsPlugin(options.external));

  const out = await build({
    platform: 'node',
    write: true,
    ...rest,
    plugins,
    output: {
      inlineDynamicImports: true,
      banner: generateBanner(),
      entryFileNames: '[name].mjs',
      chunkFileNames: '[name]-[hash].mjs',
      ...(rest.output || {}),
    },

    experimental: {
      strictExecutionOrder: true,
      ...(rest.experimental || {}),
    },
  });

  // Get output files and files to delete
  const outputDir = options.output.dir;
  const outFilePaths = out.output.map(o => path.join(outputDir, o.fileName));

  if (!cleanup) return { ...out, outFilePaths };
  cleanup_(out, outputDir);

  return { ...out, outFilePaths };
};
function generateBanner() {
  return [
    "import { dirname as dirname987 } from 'path';",
    "import { fileURLToPath as fileURLToPath987 } from 'url';",
    "import { createRequire as createRequire987 } from 'module';",
    'var require = createRequire987(import.meta.url);',
    'var __filename = fileURLToPath987(import.meta.url);',
    'var __dirname = dirname987(__filename);',
  ].join('\n');
}
