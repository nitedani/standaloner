import path from 'path';
import type { Plugin } from 'vite';
import { assetRelocatorPlugin } from './relocate.js';
import { trace } from './trace.js';
import buildSummary from './utils/buildSummary.js';
import { defaultExternalsPlugin } from './utils/default-externals.js';
import { searchForWorkspaceRoot } from './utils/searchRoot.js';
import { assertUsage, toPosixPath } from './utils/utils.js';
import { builtinModules } from 'module';
import { bundle } from './bundle.js';

export { standaloner as default, standaloner };

const standaloner = (
  options: {
    singlefile?: boolean;
    minify?: boolean;
    trace?: boolean;
    external?: (string | RegExp)[];
  } = {}
): Plugin[] => {
  const shouldTrace = options.trace ?? true;
  const minify = options.minify ?? false;
  const singlefile = options.singlefile ?? false;

  return [
    defaultExternalsPlugin(options.external) as Plugin,
    assetRelocatorPlugin({
      outputDir: '.static',
    }),
    {
      name: 'standaloner',
      apply: 'build',
      applyToEnvironment(environment) {
        return environment.name !== 'client';
      },
      configEnvironment(name) {
        if (name === 'client') {
          return;
        }
        return {
          resolve: {
            noExternal: true,
            external: [...builtinModules, ...builtinModules.map(m => `node:${m}`)],
          },
          build: {
            target: 'es2022',
            minify,
          },
        };
      },
      async writeBundle(_, output) {
        const config = this.environment.config;
        const outDir = toPosixPath(path.join(config.root, config.build.outDir));
        // Get all entry files from the output
        const entries = Object.entries(output)
          .filter(e => 'isEntry' in e[1] && e[1].isEntry)
          .map(e => e[1].fileName);

        assertUsage(entries.length > 0, 'No entry files found in build output');

        // Convert entry filenames to full paths
        const inputPaths = entries.map(entry => path.join(outDir, entry));

        if (shouldTrace) {
          await trace({
            input: inputPaths,
            outDir,
            root: config.root,
            baseDir: searchForWorkspaceRoot(config.root),
          });
        }

        if (singlefile) {
          await bundle({
            input: inputPaths[0],
            plugins: [defaultExternalsPlugin(options.external)],
            output: {
              dir: outDir,
              minify,
            },
            root: config.root,
            cleanup: true,
          });
        }

        buildSummary.printSummary();
      },
    } satisfies Plugin,
  ];
};
