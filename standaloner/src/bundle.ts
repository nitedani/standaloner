import fs from 'fs';
import path from 'path';
import { build, type BuildOptions, type Plugin } from 'rolldown';
import { assetRelocatorPlugin } from './relocate.js';
import { assert } from './utils/utils.js';
import { externalPatterns } from './utils/default-externals.js';

export type BundleOptions = Omit<BuildOptions, 'external'> & {
  external?: (string | RegExp)[];
  cleanup?: boolean;
  root: string;
  __isViteCall?: boolean;
};

export const bundle = async (options: BundleOptions) => {
  assert(options.input, 'No input specified');
  assert(options.output?.dir, 'No output directory specified');
  const { cleanup, root, __isViteCall, ...rest } = options;
  const plugins = [rest.plugins].flat();
  plugins.push(assetRelocatorPlugin() as Plugin);
  const external = [...(options.external ?? []), ...externalPatterns];

  const out = await build({
    platform: 'node',
    write: true,
    ...rest,
    plugins,
    external,
    output: {
      target: 'es2022',
      banner: generateBanner(),
      inlineDynamicImports: true,
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
