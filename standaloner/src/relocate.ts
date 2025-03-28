import type { Plugin, ResolvedConfig } from 'vite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url'; 
import MagicString from 'magic-string';
import { walk, type Node } from 'estree-walker';
import { parse, type Node as AcornNode } from 'acorn';
import { evaluateStaticPath } from './utils/static-eval.js';
import { toPosixPath } from './utils/utils.js'; 

interface RelocateOptions {
  /** The root directory to check assets against. Assets outside are ignored. Can be a function. */
  root: string | (() => string);
}

/** Generates unique filename for emission. */
const getUniqueAssetName = (
  desiredName: string,
  _absolutePath: string,
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
  return name;
};

/**
 * Vite/Rolldown plugin to relocate static FS paths for flat build outputs.
 * Emits assets to the build root and rewrites paths using `path.join(__dirname, emittedName)`.
 * Assumes __dirname is shimmed/available at runtime. Supports various path patterns.
 */
export function relocatePlugin(options: RelocateOptions): Plugin {
  let viteConfig: ResolvedConfig;
  const emittedAssetMap = new Map<string, string>();
  const emittedAssetNames = new Set<string>();
  const functionsToScan = new Set([
    'readFile', 'readFileSync', 'writeFile', 'writeFileSync', 'existsSync',
    'statSync', 'stat', 'lstatSync', 'lstat', 'accessSync', 'access',
    'readdirSync', 'readdir', 'copyFileSync', 'copyFile',
  ]);
  let projectRoot: string;

  return {
    name: 'standaloner:relocate',
    async transform(code, id) {
      const posixId = toPosixPath(id);
      // Basic filtering
      if (posixId.includes('/node_modules/') || !/\.(js|ts|jsx|tsx|mjs)$/.test(posixId)) {
        return null;
      }

      let ast: AcornNode;
      try {
        ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
      } catch (e: any) {
        this.warn(`Parse error in ${posixId}, skipping relocation: ${e.message}`);
        return null;
      }

      const magicString = new MagicString(code);
      let transformed = false;
      const promises: Promise<void>[] = [];
      const currentFileDir = path.dirname(id);
      const currentModuleUrl = pathToFileURL(id).href; // Get file URL for context
      const pluginContext = this;

      // Prepare context for the evaluator
      const evaluationVars = {
          __dirname: currentFileDir,
          'import.meta.url': currentModuleUrl, // Pass the specific module URL string
      };

      walk(ast as Node, { // Cast AcornNode for estree-walker
        enter(node: Node, parent: Node | null)  {
          if (node.type !== 'CallExpression') return;

          let pathArgumentNode: Node | undefined;
          let isFsCall = false;

          // --- Detect target function calls ---
          if (node.callee.type === 'MemberExpression' && node.callee.property.type === 'Identifier') {
            if (node.callee.object.type === 'Identifier' && functionsToScan.has(node.callee.property.name)) { // fs.*()
               isFsCall = true; pathArgumentNode = node.arguments[0];
            } else if (node.callee.object.type === 'Identifier' && node.callee.object.name === 'path' && node.callee.property.name === 'join' && // path.join(__dirname, ...)
                       node.arguments[0]?.type === 'Identifier' && node.arguments[0].name === '__dirname') {
               isFsCall = true; pathArgumentNode = node; // Evaluate the whole path.join call
            }
          } else if (node.callee.type === 'Identifier' && functionsToScan.has(node.callee.name)) { // Direct FS call like readFile()
             isFsCall = true; pathArgumentNode = node.arguments[0];
          }

          // If not an FS call OR if the first argument might be a nested call handled by evaluate (like fileURLToPath)
          // We rely on evaluateStaticPath to resolve complex arguments
          if (isFsCall && node.arguments[0] && !pathArgumentNode) {
              pathArgumentNode = node.arguments[0];
          }

          if (!isFsCall || !pathArgumentNode) return; // Ensure it's an FS call with an argument node to evaluate

          // --- Statically evaluate the path argument using the prepared context ---
          const evaluatedPath = evaluateStaticPath(pathArgumentNode, evaluationVars);

          if (typeof evaluatedPath !== 'string') return; // Not static

          // --- Resolve path and filter ---
          // evaluatedPath is expected to be an absolute path string from the evaluator
          const absolutePath = toPosixPath(evaluatedPath);
          const root = typeof options.root === 'function' ? options.root() : options.root
          if (!absolutePath.startsWith(root) || absolutePath.includes('/node_modules/')) {
            return; // Outside configured root or in node_modules
          }

          // --- Handle Asset Emission & Rewrite (Async) ---
          promises.push((async () => {
            try {
              await fs.access(absolutePath); // Check existence
              let emittedName = emittedAssetMap.get(absolutePath);

              if (!emittedName) { // Emit only once
                const content = await fs.readFile(absolutePath);
                emittedName = getUniqueAssetName(path.basename(absolutePath), absolutePath, emittedAssetNames);
                pluginContext.emitFile({ type: 'asset', fileName: emittedName, source: content });
                emittedAssetMap.set(absolutePath, emittedName);
              }

              // --- Rewrite Code ---
              const replacementCode = `path.join(__dirname, ${JSON.stringify(emittedName)})`;
              magicString.overwrite(
                (pathArgumentNode as AcornNode).start,
                (pathArgumentNode as AcornNode).end,
                replacementCode
              );
              transformed = true;

            } catch (err: any) {
              if (err.code !== 'ENOENT') pluginContext.warn(`Cannot process asset ${absolutePath}: ${err.message}`);
              // Skip rewrite if asset inaccessible
            }
          })());

          this.skip(); // Don't traverse deeper
        } // end enter
      }); // end walk

      await Promise.all(promises); // Wait for async ops

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