import path from 'path';
import type { Plugin } from 'vite';
import { assetRelocatorPlugin } from './relocate.js';
import { trace } from './trace.js';
import buildSummary from './utils/buildSummary.js';
import { defaultExternalsPlugin } from './utils/default-externals.js';
import { searchForWorkspaceRoot } from './utils/searchRoot.js';
import { assertUsage, toPosixPath } from './utils/utils.js';
import { builtinModules } from 'module';

export { standaloner as default, standaloner };

const standaloner = (): Plugin[] => {
  return [
    defaultExternalsPlugin,
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
          },
        };
      },
      async writeBundle(_, output) {
        const config = this.environment.config;
        const outDir = toPosixPath(config.build.outDir);
        // Get all entry files from the output
        const entries = Object.entries(output)
          .filter(e => 'isEntry' in e[1] && e[1].isEntry)
          .map(e => e[1].fileName);

        assertUsage(entries.length > 0, 'No entry files found in build output');

        // Convert entry filenames to full paths
        const inputPaths = entries.map(entry => path.join(outDir, entry));

        await trace({
          input: inputPaths,
          outDir,
          root: config.root,
          baseDir: searchForWorkspaceRoot(config.root),
        });

        buildSummary.printSummary();
      },
    } satisfies Plugin,
  ];
};
