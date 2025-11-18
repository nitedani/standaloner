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
import { logWarning } from './utils/logging.js';

export { standaloner as default, standaloner };

const standaloner = (
  options: {
    singlefile?: boolean | string;
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
          .map(e => ({
            name: e[1].name,
            fileName: e[1].fileName,
            outPath: path.join(outDir, e[1].fileName),
          }));

        assertUsage(entries.length > 0, 'No entry files found in build output');

        const outPaths = entries.map(entry => entry.outPath);
        if (shouldTrace) {
          await trace({
            input: outPaths,
            outDir,
            root: config.root,
            baseDir: searchForWorkspaceRoot(config.root),
          });
        }

        if (singlefile) {
          function getInputOption() {
            const singleFileEntryName = typeof singlefile === 'string' ? singlefile : 'index';
            const singleFileEntry = entries.find(e => e.name === singleFileEntryName);
            if (!singleFileEntry) {
              logWarning(
                `Could not find '${singleFileEntryName}' entry for singlefile bundling. Bundling all entries. To fix this, specify an existing entry name as the 'singlefile' option.`
              );
              return outPaths;
            }
            return [singleFileEntry.outPath];
          }

          await bundle({
            input: getInputOption(),
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
