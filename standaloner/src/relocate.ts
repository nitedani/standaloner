import { parse, type Node as AcornNode } from 'acorn';
import { walk, type Node } from 'estree-walker';
import MagicString from 'magic-string';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { evaluateStaticPath } from './utils/static-eval.js';
import { toPosixPath } from './utils/utils.js';

interface RelocateFsOptions {
  cwd?: string;
  assetDir?: string;
  fsFunctions?: string[];
}

const getUniqueAssetName = (
  desiredName: string,
  absolutePath: string,
  emittedNames: Set<string>
): string => {
  const sanitizedBase = path.basename(desiredName).replace(/[^a-zA-Z0-9_.-]/g, '_');
  const ext = path.extname(sanitizedBase);
  const baseName = sanitizedBase.substring(0, sanitizedBase.length - ext.length);
  let name = sanitizedBase;
  let counter = 0;
  while (emittedNames.has(name)) {
    counter++;
    name = `${baseName}_${counter}${ext}`;
  }
  emittedNames.add(name);
  return name; // Return just the root filename
};

/**
 * Vite plugin to relocate static FS paths. Assumes flat build output.
 */
export function relocateFsPlugin(options: RelocateFsOptions = {}): Plugin {
  let viteConfig: ResolvedConfig;
  const emittedAssetMap = new Map<string, string>(); // Map<absoluteSourcePath, emittedRootFileName>
  const emittedAssetNames = new Set<string>();
  const functionsToScan = new Set(
    options.fsFunctions || [
      'readFile',
      'readFileSync',
      'writeFile',
      'writeFileSync',
      'existsSync',
      'statSync',
      'stat',
      'lstatSync',
      'lstat',
      'accessSync',
      'access',
      'readdirSync',
      'readdir',
      'copyFileSync',
      'copyFile',
    ]
  );

  let projectRoot: string;
  let assetDirAbs: string;

  return {
    name: 'vite-plugin-relocate-fs-concise',

    configResolved(config) {
      viteConfig = config;
      projectRoot = toPosixPath(options.cwd || viteConfig.root);
      assetDirAbs = options.assetDir
        ? toPosixPath(path.resolve(projectRoot, options.assetDir))
        : projectRoot;
    },

    async transform(code, id) {
      const posixId = toPosixPath(id);
      // Filter out node_modules and non-script files
      if (posixId.includes('/node_modules/') || !/\.(js|ts|jsx|tsx|mjs)$/.test(posixId)) {
        return null;
      }

      let ast: AcornNode;
      try {
        ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
      } catch (e: any) {
        this.warn(`Parse error in ${posixId}, skipping FS relocation: ${e.message}`);
        return null;
      }

      const magicString = new MagicString(code);
      let transformed = false;
      const promises: Promise<void>[] = [];
      const currentFileDir = path.dirname(id);

      const that = this;
      walk(ast as Node, {
        // Cast AcornNode to ESTree Node for walker
        enter(node: Node, parent: Node | null) {
          if (node.type !== 'CallExpression') return;

          let functionName: string | undefined;
          let pathArgumentNode: Node | undefined;

          // --- Detect FS or path.join(__dirname,...) calls ---
          if (
            node.callee.type === 'MemberExpression' &&
            node.callee.property.type === 'Identifier'
          ) {
            if (
              node.callee.object.type === 'Identifier' &&
              functionsToScan.has(node.callee.property.name)
            ) {
              // fs.*()
              functionName = node.callee.property.name;
              pathArgumentNode = node.arguments[0];
            } else if (
              node.callee.object.type === 'Identifier' &&
              node.callee.object.name === 'path' &&
              node.callee.property.name === 'join' && // path.join()
              node.arguments[0]?.type === 'Identifier' &&
              node.arguments[0].name === '__dirname'
            ) {
              functionName = 'path.join';
              pathArgumentNode = node; // Evaluate the whole call
            }
          } else if (node.callee.type === 'Identifier' && functionsToScan.has(node.callee.name)) {
            // Direct call, e.g., readFile()
            functionName = node.callee.name;
            pathArgumentNode = node.arguments[0];
          }

          if (!functionName || !pathArgumentNode) return;

          // --- Statically evaluate the path argument ---
          const evaluatedPath = evaluateStaticPath(pathArgumentNode, {
            __dirname: currentFileDir,
            path: path,
          });

          if (typeof evaluatedPath !== 'string') return; // Not a static string path

          // --- Resolve and Filter Path ---
          const absolutePath = toPosixPath(
            path.isAbsolute(evaluatedPath)
              ? evaluatedPath
              : path.resolve(currentFileDir, evaluatedPath)
          );
          if (!absolutePath.startsWith(assetDirAbs) || absolutePath.includes('/node_modules/')) {
            return; // Outside target scope
          }

          // --- Handle Asset Emission (Async) ---
          promises.push(
            (async () => {
              try {
                await fs.access(absolutePath); // Check existence
                let emittedName = emittedAssetMap.get(absolutePath);

                if (!emittedName) {
                  const content = await fs.readFile(absolutePath);
                  const desiredName = path.basename(absolutePath);
                  emittedName = getUniqueAssetName(desiredName, absolutePath, emittedAssetNames);
                  that.emitFile({ type: 'asset', fileName: emittedName, source: content });
                  emittedAssetMap.set(absolutePath, emittedName);
                }

                // --- Rewrite Code ---
                magicString.overwrite(
                  (pathArgumentNode as AcornNode).start,
                  (pathArgumentNode as AcornNode).end,
                  JSON.stringify(emittedName)
                );
                transformed = true;
              } catch (err: any) {
                if (err.code !== 'ENOENT') {
                  // Warn only if not "file not found"
                  that.warn(`Cannot process asset ${absolutePath}: ${err.message}`);
                }
                // Do not rewrite if asset cannot be accessed/read
              }
            })()
          );

          this.skip(); // Don't traverse deeper into the processed CallExpression
        },
      }); // End walk

      await Promise.all(promises);

      if (transformed) {
        return {
          code: magicString.toString(),
          map: magicString.generateMap({ source: id, includeContent: true }),
        };
      }
      return null; // No changes
    },
  };
}
