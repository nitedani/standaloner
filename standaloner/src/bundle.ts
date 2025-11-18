import fs from 'fs';
import path from 'path';
import { build, type BuildOptions } from 'rolldown';
import { assetRelocatorPlugin } from './relocate.js';
import { assert } from './utils/utils.js';
import { defaultExternalsPlugin } from './utils/default-externals.js';
import { cleanup as cleanup_ } from './utils/cleanup.js';
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
};

/**
 * Bundles JavaScript/TypeScript files using Rolldown
 *
 * @param options Configuration options for the bundler
 * @returns Promise that resolves with information about the bundled files
 */
export const bundle = async (options: BundleOptions) => {
  assert(options.input, 'No input specified');
  assert(options.output?.dir, 'No output directory specified');

  const { cleanup, root, ...rest } = options;

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
