import path from 'path';
import type { Plugin } from 'vite';
import { type StandalonerOptions } from './index.js';
import { assetRelocatorPlugin } from './relocate.js';
import { trace } from './trace.js';
import buildSummary from './utils/buildSummary.js';
import { defaultExternalsPlugin } from './utils/default-externals.js';
import { searchForPackageRoot } from './utils/searchRoot.js';
import type { OptionalField } from './utils/types.js';
import { assertUsage, toPosixPath } from './utils/utils.js';

export { standaloner as default, standaloner };
export type { StandalonerPluginOptions };

type StandalonerPluginOptions = OptionalField<StandalonerOptions, 'input'>;

const standaloner = () => {
  return [
    defaultExternalsPlugin,
    assetRelocatorPlugin({
      outputDir: '.static',
    }),
    {
      name: 'standaloner',
      apply: 'build',
      applyToEnvironment(environment) {
        return environment.name === 'ssr';
      },
      configEnvironment(name, config, env) {
        return {
          resolve: {
            noExternal: true,
          },
        };
      },
      async writeBundle(_, output) {
        const config = this.environment.config;
        const outDir = toPosixPath(config.build.outDir);
        const entry = Object.entries(output)
          .filter(e => 'isEntry' in e[1] && e[1].isEntry)
          .map(e => e[1].fileName)
          .find(e => /index\.m?js/.test(e));
        assertUsage(entry, 'no input found in config.input');
        const input = path.join(outDir, entry);
        await trace({
          input: [input],
          outDir,
          root: config.root,
          baseDir: searchForPackageRoot(config.root),
        });

        buildSummary.printSummary();
      },
    } satisfies Plugin,
  ];
};
