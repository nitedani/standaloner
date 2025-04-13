import fs from 'fs';
import path from 'path';
import { build, type BuildOptions, type Plugin } from 'rolldown';
import { assetRelocatorPlugin } from './relocate.js';
import { assert } from './utils/utils.js';
import { externalPatterns } from './utils/default-externals.js';

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
  // Validate required options
  assert(options.input, 'No input specified');
  assert(options.output?.dir, 'No output directory specified');

  // Extract options
  const { cleanup, root, ...rest } = options;

  // Set up plugins
  const plugins = [rest.plugins].flat();
  plugins.push(assetRelocatorPlugin({ outputDir: '.static' }) as Plugin);

  // Combine user-provided externals with default patterns
  const external = [...(options.external ?? []), ...externalPatterns];

  const out = await build({
    platform: 'node',
    write: true,
    ...rest,
    plugins,
    external,
    output: {
      target: 'es2022',
      inlineDynamicImports: true,
      banner: generateBanner(),
      // advancedChunks: {
      //   groups: [
      //     {
      //       name: 'rolldown-fix',
      //       test: /rolldown:module/,
      //     },
      //     {
      //       name: 'rest',
      //     },
      //   ],
      // },
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
  const bundledModuleIds = out.output.flatMap(o => ('moduleIds' in o ? o.moduleIds : []));
  const filesToDelete = bundledModuleIds.filter(
    id => id.startsWith(outputDir) && !outFilePaths.includes(id)
  );

  // Delete files and collect directories
  const parentDirs = new Set<string>();
  for (const file of filesToDelete) {
    try {
      fs.unlinkSync(file);
      parentDirs.add(path.dirname(file));
    } catch (error) {
      // Ignore errors
    }
  }

  // Delete empty directories
  for (const dir of parentDirs) {
    try {
      if (fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir);
      }
    } catch (error) {
      // Ignore errors
    }
  }

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
