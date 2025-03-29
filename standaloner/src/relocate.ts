import * as acorn from 'acorn';
import type { CallExpression, MemberExpression, NewExpression, Node, Program } from 'estree';
import { walk } from 'estree-walker';
import MagicString from 'magic-string';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { type PluginContext, type SourceMapInput } from 'rollup';
import type { Plugin } from 'vite';
import { assert, toPosixPath } from './utils/utils.js';
import { logVerbose } from './utils/logging.js';

interface AssetRelocatorOptions {
  /** Directory within output to place assets */
  outputDir?: string;
  /** Enable detailed logging */
  verbose?: boolean;
}

const require = createRequire(import.meta.url);
const safeRequireResolve = (
  request: string,
  options?: { paths?: string[] | undefined }
): string | undefined => {
  try {
    return toPosixPath(require.resolve(request, options));
  } catch {
    return undefined;
  }
};

/** Generates unique filename for emission. */
const getUniqueAssetName = (desiredName: string, emittedNames: Set<string>): string => {
  // Use POSIX separators for consistent output filenames regardless of OS
  const sanitizedBase = path.posix
    .basename(toPosixPath(desiredName))
    .replace(/[^a-zA-Z0-9_.-]/g, '_');
  const ext = path.posix.extname(sanitizedBase);
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

/** Type of reference found in code */
type ReferenceType = 'url' | 'path' | 'require' | 'fs' | 'load';

/** Context stored for each emitted asset reference */
interface ReferenceContext {
  type: ReferenceType;
  sourceId: string; // The module where the reference was found
}

/**
 * A Rollup plugin that handles unbundlable assets by:
 * 1. Finding file references in code using AST parsing
 * 2. Copying those files to the output directory
 * 3. Rewriting references uniformly using import.meta.ROLLUP_FILE_URL_
 * 4. Using resolveFileUrl to generate appropriate runtime code (URL or path)
 *
 * @param options - Plugin configuration options
 * @returns A Rollup plugin
 */

export function assetRelocatorPlugin(options: AssetRelocatorOptions = {}): Plugin {
  const { outputDir = '' } = options;

  const emittedNames = new Set<string>();
  // Track emitted assets to avoid duplicates - maps original path to referenceId
  const emittedAssets = new Map<string, string>();
  // Store context for each referenceId
  const referenceContextRegistry = new Map<string, ReferenceContext>();

  return {
    name: 'asset-relocator',
    enforce: 'post',
    apply: 'build',
    applyToEnvironment(environment) {
      return environment.name === 'ssr';
    },
    async resolveId(source, importer, options) {
      return (await this.resolve(source, importer, options)) || safeRequireResolve(source);
    },
    async load(id: string) {
      // Skip virtual modules
      if (id.startsWith('\0')) return null;
      const ext = path.extname(id).toLowerCase();
      // Let Rollup handle JS/TS/JSON files normally
      if (['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json'].includes(ext)) {
        return null;
      }

      try {
        const posixId = toPosixPath(id);
        if (!fs.existsSync(posixId)) return null;
        const stats = fs.statSync(posixId);
        if (!stats.isFile()) return null;
        const source = fs.readFileSync(posixId);
        const referenceId = emitAssetHelper(
          this,
          posixId,
          source,
          emittedAssets,
          emittedNames,
          outputDir
        );
        referenceContextRegistry.set(referenceId, { type: 'load', sourceId: id });
        logVerbose(`Loaded asset: ${id} -> referenceId: ${referenceId}`);
        return `export default import.meta.ROLLUP_FILE_URL_${referenceId};`;
      } catch (err) {
        this.warn({
          code: 'ASSET_LOAD_ERROR',
          message: `Failed to load potential asset ${id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        });
        return null;
      }
    },

    transform(code: string, id: string) {
      if (!/\.(js|mjs|cjs|ts|tsx|jsx)$/.test(id)) {
        return null;
      }
      const posixId = toPosixPath(id);
      const ast = parseCode(this, posixId, code);
      if (!ast) return null;

      const dirName = path.dirname(id);
      const magicString = new MagicString(code);
      let hasChanges = false;
      try {
        const fileReferences = findFileReferences(ast, dirName, posixId);
        for (const reference of fileReferences) {
          const { path: filePath, transformInfo } = reference;
          const absolutePosixPath = filePath ? toPosixPath(path.resolve(dirName, filePath)) : null;
          if (
            !absolutePosixPath ||
            !fs.existsSync(absolutePosixPath) ||
            !fs.statSync(absolutePosixPath).isFile()
          ) {
            if (absolutePosixPath && transformInfo) {
              logVerbose(
                `Skipping non-existent or non-file reference: ${absolutePosixPath} in ${posixId}`
              );
            }
            continue;
          }

          let source: Buffer;
          try {
            source = fs.readFileSync(absolutePosixPath);
          } catch (readError) {
            this.warn({
              code: 'ASSET_READ_ERROR',
              message: `Failed to read asset ${absolutePosixPath} referenced in ${posixId}: ${
                readError instanceof Error ? readError.message : String(readError)
              }`,
            });
            continue;
          }

          const referenceId = emitAssetHelper(
            this,
            absolutePosixPath,
            source,
            emittedAssets,
            emittedNames,
            outputDir
          );

          if (referenceId && transformInfo && 'start' in transformInfo && 'end' in transformInfo) {
            // Store the context for this referenceId
            referenceContextRegistry.set(referenceId, {
              type: transformInfo.type,
              sourceId: posixId,
            });

            // Uniformly replace the original code with the Rollup file URL meta property
            magicString.overwrite(
              transformInfo.start,
              transformInfo.end,
              `import.meta.ROLLUP_FILE_URL_${referenceId}`
            );
            hasChanges = true;

            logVerbose(
              `Transformed ${transformInfo.type} reference in ${posixId} to use referenceId ${referenceId}`
            );
          }
        }

        if (hasChanges) {
          return {
            code: magicString.toString(),
            map: magicString.generateMap({ hires: true }) as SourceMapInput, // Cast for compatibility
          };
        }
      } catch (err) {
        this.error({
          code: 'TRANSFORM_ERROR',
          id: posixId,
          message: `Error transforming ${posixId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
          stack: err instanceof Error ? err.stack : undefined,
        });
      }

      return null;
    },

    resolveFileUrl({ referenceId, relativePath, chunkId, moduleId, format }) {
      const context = referenceContextRegistry.get(referenceId);
      const type = context?.type ?? 'url';
      logVerbose(
        `Resolving file URL for referenceId ${referenceId} (type: ${type}) in chunk ${chunkId} (format: ${format}). Relative path: ${relativePath}`
      );

      if (type === 'url') {
        return `new URL(${JSON.stringify(relativePath)}, import.meta.url)`;
      }
      if (type === 'path' || type === 'fs') {
        return `new URL(${JSON.stringify(relativePath)}, import.meta.url).pathname`;
      }
      if (type === 'require') {
        return `require(${JSON.stringify(relativePath)})`;
      }

      assert(type === 'load');
      return null;
    },
  };
}

/**
 * Interface for file references found in the code
 */
interface FileReference {
  node: Node;
  parent?: Node | null;
  path: string; // Path string extracted from the code (might be relative)
  isDynamic?: boolean;
  transformInfo?: {
    type: ReferenceType;
    start: number;
    end: number;
  };
}

/**
 * Helper to emit an asset and get the reference ID, handling deduplication.
 */
function emitAssetHelper(
  context: PluginContext,
  absolutePosixPath: string,
  source: string | Uint8Array,
  emittedAssets: Map<string, string>,
  emittedNames: Set<string>,
  outputDir: string
): string {
  try {
    if (emittedAssets.has(absolutePosixPath)) {
      return emittedAssets.get(absolutePosixPath)!;
    }

    const assetBasename = getUniqueAssetName(absolutePosixPath, emittedNames);
    const fileName = outputDir ? path.posix.join(outputDir, assetBasename) : assetBasename;

    const referenceId = context.emitFile({
      type: 'asset',
      fileName,
      source,
    });

    emittedAssets.set(absolutePosixPath, referenceId);
    logVerbose(`Emitted asset: ${absolutePosixPath} -> ${fileName}`);
    return referenceId;
  } catch (err) {
    context.warn({
      code: 'ASSET_EMISSION_ERROR',
      message: `Failed to emit asset ${absolutePosixPath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    });
    throw err;
  }
}

// --- AST Analysis Functions ---
// (Largely similar to the previous version, but ensure `transformInfo.type` is set correctly)

/**
 * Find all file references in an AST
 */
function findFileReferences(ast: Program, dirName: string, sourceId: string): FileReference[] {
  const references: FileReference[] = [];
  const processedNodes = new WeakSet<Node>(); // Avoid reprocessing the same node

  walk(ast, {
    enter: (node: Node, parent: Node | null) => {
      if (processedNodes.has(node)) return; // Skip already processed nodes

      let ref: FileReference[] | null = null;

      // Check for new URL('./path', import.meta.url)
      if (isNewURLNode(node)) {
        ref = processNewURLNode(node as NewExpression, dirName);
      }
      // Check for path.join(__dirname, './path') or process.cwd() based paths
      else if (isPathJoinOperation(node)) {
        ref = processPathJoinOperation(node as CallExpression, dirName);
      }
      // Check for require('./asset.ext')
      else if (isRequireCall(node)) {
        ref = processRequireCall(node as CallExpression, dirName);
      }
      // Check for fs.someFunc('./path')
      else if (isFsOperation(node)) {
        ref = processFsOperation(node as CallExpression, dirName);
      }
      if (ref?.length) {
        processedNodes.add(node);
        references.push(...ref);
      }
    },
  });

  return references;
}

/** Check if a node is new URL('./path', import.meta.url) */
function isNewURLNode(node: Node): node is NewExpression {
  return (
    node.type === 'NewExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'URL' &&
    node.arguments.length >= 2 &&
    node.arguments[1]?.type === 'MemberExpression' &&
    node.arguments[1].object.type === 'MetaProperty' &&
    (node.arguments[1].object.meta.name === 'import' ||
      node.arguments[1].object.meta.name === 'new') && // import.meta or new.target
    node.arguments[1].object.property.name === 'meta' &&
    node.arguments[1].property.type === 'Identifier' &&
    node.arguments[1].property.name === 'url' &&
    (node.arguments[0]?.type === 'Literal' || node.arguments[0]?.type === 'TemplateLiteral')
  );
}

/** Process new URL() node */
function processNewURLNode(node: NewExpression, dirName: string): FileReference[] | null {
  const urlPathArg = node.arguments[0];
  if (!urlPathArg) return null;

  let filePath: string | null = null;
  if (urlPathArg.type === 'Literal' && typeof urlPathArg.value === 'string') {
    filePath = urlPathArg.value;
  } else if (urlPathArg.type === 'TemplateLiteral' && urlPathArg.expressions.length === 0) {
    filePath = urlPathArg.quasis[0]?.value.cooked || null;
  }

  if (filePath !== null) {
    // Basic check for relative/absolute paths that might be assets
    // More sophisticated checks might be needed (e.g., avoid http:// urls)
    if (filePath.startsWith('.') || path.isAbsolute(filePath)) {
      assert(
        'start' in node &&
          typeof node.start === 'number' &&
          'end' in node &&
          typeof node.end === 'number',
        'Node requires start/end'
      );
      return [
        {
          node: urlPathArg, // Reference the argument node for potential processing
          path: filePath,
          transformInfo: {
            type: 'url', // Context is a URL
            start: node.start, // Replace the entire `new URL(...)` expression
            end: node.end,
          },
        },
      ];
    }
  }
  return null;
}

/** Check if a node is path.join(__dirname/'path', ...) */
function isPathJoinOperation(node: Node): node is CallExpression {
  return (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    node.callee.object.type === 'Identifier' &&
    node.callee.object.name === 'path' &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === 'join' &&
    node.arguments.length >= 2
  );
}

/** Process path.join() */
function processPathJoinOperation(node: CallExpression, dirName: string): FileReference[] | null {
  // Simplistic: assumes path.join(__dirname | process.cwd(), 'relative/path')
  const basePathNode = node.arguments[0];
  const relativePathNode = node.arguments[1];

  if (!basePathNode || !relativePathNode || !isBasePathArgument(basePathNode)) {
    return null;
  }

  let filePath: string | null = null;
  if (relativePathNode.type === 'Literal' && typeof relativePathNode.value === 'string') {
    filePath = relativePathNode.value;
  } else if (
    relativePathNode.type === 'TemplateLiteral' &&
    relativePathNode.expressions.length === 0
  ) {
    filePath = relativePathNode.quasis[0]?.value.cooked || null;
  }

  if (filePath !== null && (filePath.startsWith('.') || !path.isAbsolute(filePath))) {
    // Ensure it's meant to be relative
    assert(
      'start' in node &&
        typeof node.start === 'number' &&
        'end' in node &&
        typeof node.end === 'number',
      'Node requires start/end'
    );
    return [
      {
        node: relativePathNode,
        path: filePath,
        transformInfo: {
          type: 'path', // Context is a file path
          start: node.start, // Replace the entire path.join(...) expression
          end: node.end,
        },
      },
    ];
  }
  return null;
}

/** Check if arg is __dirname, process.cwd(), etc. */
function isBasePathArgument(node: Node): boolean {
  if (node.type === 'Identifier' && node.name === '__dirname') return true;
  if (
    node.type === 'CallExpression' &&
    node.callee.type === 'MemberExpression' &&
    node.callee.object.type === 'Identifier' &&
    node.callee.object.name === 'process' &&
    node.callee.property.type === 'Identifier' &&
    node.callee.property.name === 'cwd'
  )
    return true;
  // Could add import.meta.dirname (if using a polyfill/transform)
  return false;
}

/** Check if node is require('...') */
function isRequireCall(node: Node): node is CallExpression {
  return (
    node.type === 'CallExpression' &&
    node.callee.type === 'Identifier' &&
    node.callee.name === 'require' &&
    node.arguments.length === 1 &&
    (node.arguments[0]?.type === 'Literal' || node.arguments[0]?.type === 'TemplateLiteral')
  );
}

/** Process require() call */
function processRequireCall(node: CallExpression, dirName: string): FileReference[] | null {
  const arg = node.arguments[0];
  if (!arg) return null;

  let modulePath: string | null = null;
  if (arg.type === 'Literal' && typeof arg.value === 'string') {
    modulePath = arg.value;
  } else if (arg.type === 'TemplateLiteral' && arg.expressions.length === 0) {
    modulePath = arg.quasis[0]?.value.cooked || null;
  }
  if (!modulePath) return null;

  const resolved = safeRequireResolve(modulePath);
  const potentialPath = resolved || path.resolve(dirName, modulePath);
  const ext = path.extname(potentialPath).toLowerCase();
  if (['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.json', ''].includes(ext)) return null;

  assert(
    'start' in node &&
      typeof node.start === 'number' &&
      'end' in node &&
      typeof node.end === 'number',
    'Node requires start/end'
  );

  return [
    {
      node: arg,
      path: modulePath,
      transformInfo: {
        type: 'require',
        start: node.start, // Replace the entire require(...) expression
        end: node.end,
      },
    },
  ];
}

/** Check if node is fs.someFunc(...) */
function isFsOperation(node: Node): node is CallExpression {
  if (node.type !== 'CallExpression' || node.arguments.length < 1) return false;

  const callee = node.callee;
  if (callee.type !== 'MemberExpression') return false;
  if (callee.property.type !== 'Identifier') return false; // fs['readFile'] not handled simply

  // Check for direct fs.method()
  if (callee.object.type === 'Identifier' && callee.object.name === 'fs') {
    return true;
  }
  // Check for require('fs').method()
  if (
    callee.object.type === 'CallExpression' &&
    callee.object.callee.type === 'Identifier' &&
    callee.object.callee.name === 'require' &&
    callee.object.arguments.length === 1 &&
    callee.object.arguments[0]?.type === 'Literal' &&
    callee.object.arguments[0].value === 'fs'
  ) {
    return true;
  }
  // Could add checks for imported fs variables `import * as fs from 'fs'; fs.readFile(...)`
  return false;
}

/** Process fs operation */
function processFsOperation(node: CallExpression, dirName: string): FileReference[] | null {
  const callee = node.callee as MemberExpression; // Already checked in isFsOperation
  const fsFunction = (callee.property as acorn.Identifier).name; // Already checked

  // List of fs functions where the first arg is commonly a path
  const pathTakingFuncs = [
    'readFile',
    'readFileSync',
    'writeFile',
    'writeFileSync',
    'appendFile',
    'appendFileSync',
    'stat',
    'statSync',
    'lstat',
    'lstatSync',
    'access',
    'accessSync',
    'open',
    'openSync',
    'createReadStream',
    'createWriteStream',
    'unlink',
    'unlinkSync',
    'chmod',
    'chmodSync',
    'chown',
    'chownSync',
    'exists',
    'existsSync',
    'realpath',
    'realpathSync',
    'rm',
    'rmSync',
    'mkdir',
    'mkdirSync',
    'readdir',
    'readdirSync',
  ];

  if (!pathTakingFuncs.includes(fsFunction)) {
    return null;
  }

  const pathArg = node.arguments[0];
  if (!pathArg) return null;

  let filePath: string | null = null;
  if (pathArg.type === 'Literal' && typeof pathArg.value === 'string') {
    filePath = pathArg.value;
  } else if (pathArg.type === 'TemplateLiteral' && pathArg.expressions.length === 0) {
    filePath = pathArg.quasis[0]?.value.cooked || null;
  } else if (pathArg.type === 'Identifier' && pathArg.name === '__filename') {
    // Special case: fs operation on the file itself. Don't treat as external asset.
    return null;
  }

  if (filePath !== null && (filePath.startsWith('.') || path.isAbsolute(filePath))) {
    // We found a potential file path used with fs.
    assert(
      'start' in pathArg &&
        typeof pathArg.start === 'number' &&
        'end' in pathArg &&
        typeof pathArg.end === 'number',
      'Node requires start/end'
    );
    return [
      {
        node: pathArg, // The path argument node itself
        path: filePath,
        transformInfo: {
          type: 'fs', // Context is fs path
          start: pathArg.start, // Replace *only the path argument*
          end: pathArg.end,
        },
      },
    ];
  }

  return null;
}

function parseCode(context: PluginContext, posixId: string, code: string) {
  let ast: Program;
  try {
    // Attempt parsing as module first
    ast = acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
      allowHashBang: true,
    }) as unknown as Program;
  } catch (moduleError) {
    try {
      // Fallback to script parsing if module fails
      ast = acorn.parse(code, {
        ecmaVersion: 'latest',
        sourceType: 'script',
        locations: true,
        allowHashBang: true,
      }) as unknown as Program;
    } catch (scriptError) {
      context.warn({
        code: 'PARSE_ERROR',
        id: posixId,
        message: `Failed to parse ${posixId}. Module Error: ${
          moduleError instanceof Error ? moduleError.message : String(moduleError)
        }. Script Error: ${
          scriptError instanceof Error ? scriptError.message : String(scriptError)
        }`,
      });
      return null;
    }
  }

  return ast;
}
