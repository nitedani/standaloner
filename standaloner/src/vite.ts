import { builtinModules } from 'module';
import path from 'path';
import type { Plugin } from 'vite';
import { standaloner as standaloner_, type StandalonerOptions } from './index.js';
import { assetRelocatorPlugin } from './relocate.js';
import { defaultExternalsPlugin } from './utils/default-externals.js';
import { searchForWorkspaceRoot } from './utils/searchRoot.js';
import type { OptionalField } from './utils/types.js';
import { assertUsage, toPosixPath } from './utils/utils.js';
import { nodePolyfills } from './utils/nodePolyfills.js';

export { standaloner as default, standaloner };
export type { StandalonerPluginOptions };

type StandalonerPluginOptions = OptionalField<StandalonerOptions, 'input'>;

const standaloner = (options: StandalonerPluginOptions = {}) => {
  let input: typeof options.input;
  const bundle = typeof options.bundle === 'object' ? options.bundle : {};
  const externalStr = (bundle.external ?? []).filter(e => typeof e === 'string');
  let outDir: typeof options.outDir;
  let root: string;

  return [
    nodePolyfills(),
    defaultExternalsPlugin,
    assetRelocatorPlugin({
      outputDir: '.static',
    }),
    {
      name: 'standaloner',
      configResolved(config) {
        root = searchForWorkspaceRoot(config.root);
      },
      apply: 'build',
      applyToEnvironment(environment) {
        return environment.name === 'ssr';
      },
      configEnvironment() {
        return {
          resolve: {
            external: [...builtinModules, ...builtinModules.map(m => `node:${m}`), ...externalStr],
            noExternal: true,
          },
        };
      },
      async writeBundle(_, output) {
        if (options.input) {
          input = options.input;
          return;
        }

        outDir = toPosixPath(this.environment.config.build.outDir);
        const entry = Object.entries(output)
          .filter(e => 'isEntry' in e[1] && e[1].isEntry)
          .map(e => e[1].fileName)
          .find(e => /index\.m?js/.test(e));
        assertUsage(entry, 'no input found in config.input');
        input = path.join(outDir, entry);
        await standaloner_({
          input,
          outDir,
          bundle: false,
          __isViteCall: true,
        });
      },
    } satisfies Plugin,
  ];
};
