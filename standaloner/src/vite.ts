import path from 'node:path';
import { normalizePath, type Plugin } from 'vite';
import { assetRelocatorPlugin } from './relocate.js';
import { trace } from './trace.js';
import buildSummary from './utils/buildSummary.js';
import { defaultExternalsPlugin } from './utils/default-externals.js';
import { searchForWorkspaceRoot } from './utils/searchRoot.js';
import { assertUsage, toPosixPath } from './utils/utils.js';
import { builtinModules } from 'node:module';
import { bundle, type BundleOptions } from './bundle.js';
import { logWarning, setVerbose } from './utils/logging.js';

export { standaloner as default, standaloner };

const standaloner = (
  options: {
    bundle?: boolean | string | Omit<BundleOptions, 'root' | 'external' | 'cleanup'>;
    minify?: boolean;
    trace?: boolean;
    external?: (string | RegExp)[];
    verbose?: boolean;
    isolated?: boolean;
  } = {}
): Plugin[] => {
  if (options.verbose) {
    setVerbose(true);
  }
  const shouldTrace = options.trace ?? true;
  const minify = options.minify ?? false;
  const bundle_ = options.bundle ?? false;

  return [
    defaultExternalsPlugin(options.external) as Plugin,
    assetRelocatorPlugin({
      outputDir: '.static',
    }),
    {
      name: 'standaloner',
      apply: 'build',
      applyToEnvironment(environment) {
        return environment.config.consumer !== 'client';
      },
      configEnvironment(_name, config) {
        if (config.consumer === 'client') {
          return;
        }
        return {
          resolve: {
            noExternal: true,
            external: [...builtinModules, ...builtinModules.map(m => `node:${m}`)],
          },
          build: {
            target: 'es2022',
            minify: minify && !bundle_,
          },
        };
      },
      async writeBundle(_, output) {
        const config = this.environment.config;
        const outDir = toPosixPath(path.isAbsolute(config.build.outDir) ? config.build.outDir : path.join(config.root, config.build.outDir));
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

        if (bundle_) {
          function getInputOption() {
            const bundleEntryName = typeof bundle_ === 'object' && typeof bundle_.input === 'string' ? bundle_.input :  typeof bundle_ === 'string' ? bundle_ : 'index';
            const bundleEntry = entries.find(e => e.name === bundleEntryName);
            if (!bundleEntry) {
              return outPaths;
            }
            return [bundleEntry.outPath];
          }

          const bundleOptions = typeof bundle_ === 'object' ? bundle_ : {};
          // Input to object, so that entries are written at the same place
          const input = Object.fromEntries(getInputOption().map(e => [removeExtension(pathRelativeTo(e, outDir)), e]));
          await bundle({
            ...bundleOptions,
            input,
            external: options.external,
            output: {
              ...bundleOptions.output,
              dir: outDir,
              minify,
              sourcemap: config.build.sourcemap,
            },
            root: config.root,
            cleanup: true,
            isolated: options.isolated,
          });
        }

        buildSummary.printSummary();
      },
    } satisfies Plugin,
  ];
};

export function pathRelativeTo(filePath: string, rel: string): string {
  return normalizePath(path.relative(normalizePath(path.resolve(rel)), path.resolve(filePath)));
}


export function removeExtension(subject: string) {
  return subject.replace(/\.[^/.]+$/, "");
}
