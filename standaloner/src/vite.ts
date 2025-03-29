import path from 'path';
import type { Plugin } from 'vite';
import { standaloner as standaloner_, type StandalonerOptions } from './index.js';
import { assetRelocatorPlugin } from './relocate.js';
import { defaultExternalsPlugin } from './utils/default-externals.js';
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
      async writeBundle(_, output) {
        const config = this.environment.config;
        const external = Array.isArray(config.resolve.external)
          ? config.resolve.external.map(e => new RegExp(`^${e}`))
          : [];
        const outDir = toPosixPath(config.build.outDir);
        const entry = Object.entries(output)
          .filter(e => 'isEntry' in e[1] && e[1].isEntry)
          .map(e => e[1].fileName)
          .find(e => /index\.m?js/.test(e));
        assertUsage(entry, 'no input found in config.input');
        const input = path.join(outDir, entry);
        await standaloner_({
          input,
          outDir,
          bundle: {
            external,
          },
          __isViteCall: true,
        });
      },
    } satisfies Plugin,
  ];
};
