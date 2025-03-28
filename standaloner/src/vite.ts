import path from 'path';
import type { Plugin } from 'vite';
import { standaloner as standaloner_, type StandalonerOptions } from './index.js';
import { assertUsage, toPosixPath } from './utils/utils.js';
import type { OptionalField } from './utils/types.js';
import { relocateFsPlugin } from './relocate.js';

export { standaloner };
export { standaloner as default };
export type { StandalonerPluginOptions };

type StandalonerPluginOptions = OptionalField<StandalonerOptions, 'input'>;

const standaloner = (options: StandalonerPluginOptions = {}) => {
  let input: typeof options.input;
  const bundleOptions = typeof options.bundle === 'object' ? options.bundle : {};
  const external = bundleOptions.external ?? [];
  const externalStr = Array.isArray(external) ? external.filter(e => typeof e === 'string') : [];
  let outDir: typeof options.outDir;

  return [
    relocateFsPlugin(),
    {
      name: 'standaloner',
      configEnvironment(config, env) {
        return {
          resolve: {
            external: externalStr,
          },
          optimizeDeps: {
            exclude: externalStr,
          },
        };
      },
      applyToEnvironment(environment) {
        return environment.name === 'ssr';
      },
      writeBundle(_, output) {
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
      },
      closeBundle: {
        sequential: true,
        order: 'post',
        async handler() {
          await standaloner_({
            outDir,
            ...options,
            input,
          });
        },
      },
    } satisfies Plugin,
  ];
};
