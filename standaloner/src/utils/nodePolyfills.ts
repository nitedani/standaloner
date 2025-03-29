/**
 * Rollup plugin that adds Node.js globals (__dirname, __filename, require)
 * to ESM bundles after generation, avoiding module-level duplication.
 */
import { createFilter, type FilterPattern } from '@rollup/pluginutils';
import MagicString from 'magic-string';
import type { Plugin } from 'rollup';
import type { SourceMap } from 'magic-string';

interface NodePolyfillsOptions {
  include?: FilterPattern;
  exclude?: FilterPattern;
}

export function nodePolyfills(options: NodePolyfillsOptions = {}): Plugin {
  const filter = createFilter(options.include, options.exclude);

  return {
    name: 'standaloner:node-polyfills',
    generateBundle(_options, bundle) {
      // Iterate over each chunk in the bundle
      for (const [fileName, chunk] of Object.entries(bundle)) {
        // Skip non-code chunks or chunks that don't match the filter
        if (chunk.type !== 'chunk' || !filter(fileName) || !fileName.match(/\.(?:js|mjs)$/)) {
          continue;
        }

        const code = chunk.code;

        // Check for usage of globals in the chunk
        const needsDirname = /\b__dirname\b/.test(code);
        const needsFilename = /\b__filename\b/.test(code);
        const needsRequire = /\brequire\s*\(/.test(code);

        // Skip if no globals are used
        if (!needsDirname && !needsFilename && !needsRequire) {
          continue;
        }

        // Check for existing declarations to avoid conflicts
        const hasDirnameDecl =
          /\b(?:const|let|var)\s+__dirname\b/.test(code) || /\bfunction\s+__dirname\b/.test(code);
        const hasFilenameDecl =
          /\b(?:const|let|var)\s+__filename\b/.test(code) || /\bfunction\s+__filename\b/.test(code);
        const hasRequireDecl =
          /\b(?:const|let|var)\s+require\b/.test(code) || /\bfunction\s+require\b/.test(code);

        const shouldAddDirname = needsDirname && !hasDirnameDecl;
        const shouldAddFilename = needsFilename && !hasFilenameDecl;
        const shouldAddRequire = needsRequire && !hasRequireDecl;

        // Skip if no polyfills are needed after checking declarations
        if (!shouldAddDirname && !shouldAddFilename && !shouldAddRequire) {
          continue;
        }

        const magic = new MagicString(code);
        const imports: string[] = [];
        const declarations: string[] = [];

        // Add required imports
        if (shouldAddFilename || shouldAddDirname) {
          imports.push(`import { fileURLToPath as __standaloner_fileURLToPath } from 'url';`);
          if (shouldAddDirname) {
            imports.push(`import { dirname as __standaloner_dirname } from 'path';`);
          }
        }
        if (shouldAddRequire) {
          imports.push(`import { createRequire as __standaloner_createRequire } from 'module';`);
        }

        // Add declarations (bundle-level, so we use a fixed URL or dynamic logic)
        if (shouldAddFilename) {
          declarations.push(`const __filename = __standaloner_fileURLToPath(import.meta.url);`);
        }
        if (shouldAddDirname) {
          const dirnameDecl = shouldAddFilename
            ? `const __dirname = __standaloner_dirname(__filename);`
            : `const __filename_for_dirname = __standaloner_fileURLToPath(import.meta.url);\n` +
              `const __dirname = __standaloner_dirname(__filename_for_dirname);`;
          declarations.push(dirnameDecl);
        }
        if (shouldAddRequire) {
          declarations.push(`const require = __standaloner_createRequire(import.meta.url);`);
        }

        // Prepend polyfills to the chunk
        if (imports.length > 0 || declarations.length > 0) {
          const preamble = [...imports, ...declarations].join('\n') + '\n';
          magic.prepend(preamble);
        }

        // Update the chunk with modified code and source map
        chunk.code = magic.toString();
        chunk.map = magic.generateMap({ hires: true }) as SourceMap;
      }
    },
  };
}
