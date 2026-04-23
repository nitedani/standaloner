import path from 'node:path';
import { normalizePath, type Plugin } from 'vite';
import { assetRelocatorPlugin } from './relocate.js';
import { trace } from './trace.js';
import buildSummary from './utils/buildSummary.js';
import { buildExternalsPlugin } from './utils/build-externals.js';
import { searchForWorkspaceRoot } from './utils/searchRoot.js';
import { assertUsage, toPosixPath } from './utils/utils.js';
import { builtinModules } from 'node:module';
import { bundle, type BundleOptions } from './bundle.js';
import { logWarning, setVerbose } from './utils/logging.js';

export { standaloner as default, standaloner };

const standaloner = (
  options: {
    bundle?: boolean | string | string[] | Omit<BundleOptions, 'root' | 'external' | 'cleanup'>;
    minify?: boolean;
    trace?: boolean;
    external?: (string | RegExp)[];
    verbose?: boolean;
  } = {}
): Plugin[] => {
  if (options.verbose) {
    setVerbose(true);
  }
  const shouldTrace = options.trace ?? true;
  const minify = options.minify ?? false;
  const bundle_ = options.bundle ?? false;

  return [
    buildExternalsPlugin(options.external) as Plugin,
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
          const bundleOptions = typeof bundle_ === 'object' && !Array.isArray(bundle_) ? bundle_ : {};
          assertUsage(!Array.isArray(bundleOptions.input), '`bundle.input` must be an object ({ name: path }), not an array');

          let input: Record<string, string>;
          if (bundleOptions.input) {
            // User-provided input map: keep their keys, resolve values against root.
            input = Object.fromEntries(
              Object.entries(bundleOptions.input).map(([k, v]) => [k, path.resolve(config.root, v)])
            );
          } else {
            // Re-bundle selected Vite entries in place: key by relpath so output lands at original location.
            const names = typeof bundle_ === 'string' ? [bundle_] : Array.isArray(bundle_) ? bundle_ : ['index'];
            const selected = entries.filter(e => e.name && names.includes(e.name));
            const paths = selected.length > 0 ? selected.map(e => e.outPath) : outPaths;
            input = Object.fromEntries(paths.map(p => [removeExtension(pathRelativeTo(p, outDir)), p]));
          }
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
            isolated: bundleOptions.isolated ?? false,
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
