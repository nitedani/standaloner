import * as acorn from 'acorn';
import type { CallExpression, MemberExpression, NewExpression, Node, Program } from 'estree';
import { walk } from 'estree-walker';
import MagicString from 'magic-string';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { PluginContext, SourceMapInput } from 'rollup';
import type { Plugin } from 'vite';
import buildSummary from './utils/buildSummary.js';
import { logVerbose } from './utils/logging.js';
import { assert, toPosixPath } from './utils/utils.js';

interface AssetRelocatorOptions {
  /** Directory within output to place assets */
  outputDir?: string;
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

/** Asset information stored during transform phase */
interface AssetInfo {
  absolutePath: string;
  source: Buffer | string;
  type: ReferenceType;
  sourceId: string;
}

/** Reference info after emission */
interface ReferenceInfo {
  referenceId: string;
  type: ReferenceType;
}

/**
 * Interface for file references found in the code
 */
interface FileReference {
  node: Node;
  parent?: Node | null;
  path: string;
  isDynamic?: boolean;
  transformInfo?: {
    type: ReferenceType;
    start: number;
    end: number;
  };
}

/**
 * A Rollup plugin that handles unbundlable assets by:
 * 1. Finding file references in code using AST parsing
 * 2. Storing asset info during transform (before tree-shaking)
 * 3. Only emitting assets that survive tree-shaking in renderChunk
 * 4. Rewriting references to use appropriate runtime code (URL or path)
 *
 * @param options - Plugin configuration options
 * @returns A Rollup plugin
 */
export function assetRelocatorPlugin(options: AssetRelocatorOptions = {}): Plugin {
  const { outputDir = '' } = options;
  const emittedNames = new Set<string>();

  // Store asset info by placeholder ID - populated in transform, used in renderChunk
  const assetInfoMap = new Map<string, AssetInfo>();

  // Map from placeholderId to referenceId and type (after emission in renderChunk)
  const placeholderToReferenceId = new Map<string, ReferenceInfo>();

  // Counter for generating unique placeholder IDs
  let placeholderCounter = 0;

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
      if (id.startsWith('\0')) return null;
      const ext = path.extname(id).toLowerCase();
      if (!['.node'].includes(ext)) return null;

      try {
        const posixId = toPosixPath(id);
        if (!fs.existsSync(posixId)) return null;
        const stats = fs.statSync(posixId);
        if (!stats.isFile()) return null;

        const source = fs.readFileSync(posixId);
        const placeholderId = `asset_${placeholderCounter++}`;

        // Store asset info for later emission
        assetInfoMap.set(placeholderId, {
          absolutePath: posixId,
          source,
          type: 'load',
          sourceId: id,
        });

        logVerbose(`Prepared asset for load: ${id} -> placeholder: ${placeholderId}`);
        return `export default import.meta.STANDALONER_ASSET_${placeholderId};`;
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

    transform: {
      order: 'post',
      handler(code: string, id: string) {
        if (!/\.(js|mjs|cjs|ts|tsx|jsx)$/.test(id)) return null;

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
            const absolutePosixPath = filePath
              ? toPosixPath(path.resolve(dirName, filePath))
              : null;

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

            if (transformInfo && 'start' in transformInfo && 'end' in transformInfo) {
              // Generate unique placeholder ID
              const placeholderId = `asset_${placeholderCounter++}`;

              // Store asset info for later emission (in renderChunk)
              assetInfoMap.set(placeholderId, {
                absolutePath: absolutePosixPath,
                source,
                type: transformInfo.type,
                sourceId: posixId,
              });

              // Replace with placeholder that will survive tree-shaking
              magicString.overwrite(
                transformInfo.start,
                transformInfo.end,
                `import.meta.STANDALONER_ASSET_${placeholderId}`
              );
              hasChanges = true;
              logVerbose(
                `Prepared asset reference in ${posixId} with placeholder ${placeholderId}`
              );
            }
          }

          if (hasChanges) {
            return {
              code: magicString.toString(),
              map: magicString.generateMap({ hires: true }) as SourceMapInput,
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
    },

    renderChunk(code, chunk) {
      // Find all placeholders that survived tree-shaking
      const placeholderPattern = /import\.meta\.STANDALONER_ASSET_(asset_\d+)/g;
      const survivingPlaceholders = new Set<string>();
      let match: RegExpExecArray | null;

      while ((match = placeholderPattern.exec(code))) {
        if (typeof match[1] === 'string') {
          survivingPlaceholders.add(match[1]);
        }
      }

      if (survivingPlaceholders.size === 0) return null;

      logVerbose(
        `Found ${survivingPlaceholders.size} surviving asset references in chunk ${chunk.fileName}`
      );

      // Emit assets ONLY for placeholders that survived tree-shaking
      const emittedAssets = new Map<string, string>(); // absolutePath -> referenceId for deduplication

      for (const placeholderId of survivingPlaceholders) {
        const assetInfo = assetInfoMap.get(placeholderId);
        if (!assetInfo) {
          this.warn({
            code: 'MISSING_ASSET_INFO',
            message: `Missing asset info for placeholder ${placeholderId} in chunk ${chunk.fileName}`,
          });
          continue;
        }

        const { absolutePath, source, type, sourceId } = assetInfo;

        // Deduplicate: if we've already emitted this file, reuse the referenceId
        let referenceId = emittedAssets.get(absolutePath);

        if (!referenceId) {
          const assetBasename = getUniqueAssetName(absolutePath, emittedNames);
          const fileName = outputDir ? path.posix.join(outputDir, assetBasename) : assetBasename;

          referenceId = this.emitFile({
            type: 'asset',
            fileName,
            source,
          });

          emittedAssets.set(absolutePath, referenceId);

          // Record in build summary
          try {
            const stats = fs.statSync(absolutePath);
            buildSummary.recordAsset(absolutePath, stats.size);
          } catch {
            buildSummary.recordAsset(absolutePath, 0);
          }

          buildSummary.recordReference(sourceId, type);
          logVerbose(`Emitted asset: ${path.basename(absolutePath)} (used in tree-shaken code)`);
        }

        placeholderToReferenceId.set(placeholderId, { referenceId, type });
      }

      // Now replace placeholders with actual code
      const magicString = new MagicString(code);
      let hasChanges = false;

      placeholderPattern.lastIndex = 0; // Reset regex
      while ((match = placeholderPattern.exec(code))) {
        const placeholder = match[0];
        const placeholderId = match[1];

        if (typeof placeholderId !== 'string') continue;

        const refInfo = placeholderToReferenceId.get(placeholderId);
        if (!refInfo) continue;

        const { referenceId, type } = refInfo;
        const fileName = this.getFileName(referenceId);

        if (!fileName) {
          this.warn({
            code: 'MISSING_FILENAME',
            message: `Missing fileName for referenceId ${referenceId} in chunk ${chunk.fileName}`,
          });
          continue;
        }

        // Calculate relative path from chunk to asset
        const relativePath = path.posix.relative(path.posix.dirname(chunk.fileName), fileName);
        const relativePathWithDot = relativePath.startsWith('./')
          ? relativePath
          : `./${relativePath}`;

        // Generate replacement based on type
        let replacement = '';
        if (type === 'url') {
          replacement = `new URL(${JSON.stringify(relativePathWithDot)}, import.meta.url)`;
        } else if (type === 'path' || type === 'fs') {
          replacement = `new URL(${JSON.stringify(relativePathWithDot)}, import.meta.url).pathname`;
        } else if (type === 'require' || type === 'load') {
          replacement = `require(${JSON.stringify(relativePathWithDot)})`;
        } else {
          assert(false, `Unknown reference type: ${type}`);
        }

        logVerbose(`Replaced ${placeholder} with ${replacement} (type: ${type})`);
        magicString.overwrite(match.index, match.index + placeholder.length, replacement);
        hasChanges = true;
      }

      if (!hasChanges) return null;

      return {
        code: magicString.toString(),
        map: magicString.generateMap({ hires: true }) as SourceMapInput,
      };
    },
  };
}

// --- AST Analysis Functions ---

/**
 * Find all file references in an AST
 */
function findFileReferences(ast: Program, dirName: string, sourceId: string): FileReference[] {
  const references: FileReference[] = [];
  const processedNodes = new WeakSet<Node>();

  walk(ast, {
    enter: (node: Node, parent: Node | null) => {
      if (processedNodes.has(node)) return;

      let ref: FileReference[] | null = null;

      if (isNewURLNode(node)) {
        ref = processNewURLNode(node as NewExpression, dirName);
      } else if (isPathJoinOperation(node)) {
        ref = processPathJoinOperation(node as CallExpression, dirName);
      } else if (isRequireCall(node)) {
        ref = processRequireCall(node as CallExpression, dirName);
      } else if (isFsOperation(node)) {
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
      node.arguments[1].object.meta.name === 'new') &&
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
          node: urlPathArg,
          path: filePath,
          transformInfo: {
            type: 'url',
            start: node.start,
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
          type: 'path',
          start: node.start,
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
        start: node.start,
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
  if (callee.property.type !== 'Identifier') return false;

  if (callee.object.type === 'Identifier' && callee.object.name === 'fs') {
    return true;
  }

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

  return false;
}

/** Process fs operation */
function processFsOperation(node: CallExpression, dirName: string): FileReference[] | null {
  const callee = node.callee as MemberExpression;
  const fsFunction = (callee.property as acorn.Identifier).name;

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
    return null;
  }

  if (filePath !== null && (filePath.startsWith('.') || path.isAbsolute(filePath))) {
    assert(
      'start' in pathArg &&
        typeof pathArg.start === 'number' &&
        'end' in pathArg &&
        typeof pathArg.end === 'number',
      'Node requires start/end'
    );
    return [
      {
        node: pathArg,
        path: filePath,
        transformInfo: {
          type: 'fs',
          start: pathArg.start,
          end: pathArg.end,
        },
      },
    ];
  }

  return null;
}

function parseCode(context: PluginContext, posixId: string, code: string): Program | null {
  let ast: Program;
  try {
    ast = acorn.parse(code, {
      ecmaVersion: 'latest',
      sourceType: 'module',
      locations: true,
      allowHashBang: true,
    }) as unknown as Program;
  } catch (moduleError) {
    try {
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
