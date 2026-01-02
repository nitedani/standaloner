import path from 'node:path';
import type { StandalonerOptions } from 'src/index.js';
import { searchForPackageRoot, searchForWorkspaceRoot } from './searchRoot.js';
import { assertUsage, findCommonAncestor, resolveInputs } from './utils.js';

/**
 * Resolves paths for standaloner options
 *
 * @param options The standaloner options
 * @returns Resolved paths for input, output, and project root
 */
export const resolvePaths = (options: StandalonerOptions) => {
  assertUsage(options.input, 'No input specified');

  // Resolve input paths to absolute paths
  const inputPaths = resolveInputs(options.input);

  // Find common ancestor directory of all input files
  const inputCommonDir = findCommonAncestor(inputPaths);

  // Find project root (directory with package.json)
  const root = searchForPackageRoot(inputCommonDir);

  // Determine output directory
  let outDir: string;
  if (options.outDir) {
    // If outDir is provided, resolve it relative to current working directory
    outDir = path.resolve(process.cwd(), options.outDir);
  } else {
    // If no outDir is provided, use a 'dist' subdirectory in the input common directory
    outDir = path.join(inputCommonDir, 'dist');
  }

  // Find workspace root for monorepo support
  const baseDir = searchForWorkspaceRoot(inputCommonDir);

  return { inputPaths, inputCommonDir, root, outDir, baseDir };
};
