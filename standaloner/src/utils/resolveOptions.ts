import path from 'path';
import type { StandalonerOptions } from 'src/index.js';
import { searchForPackageRoot, searchForWorkspaceRoot } from './searchRoot.js';
import { assertUsage, findCommonAncestor, resolveInputs } from './utils.js';

export const resolvePaths = (options: StandalonerOptions) => {
  assertUsage(options.input, 'No input specified');
  const inputPaths = resolveInputs(options.input);
  const inputCommonDir = findCommonAncestor(inputPaths);
  const root = searchForPackageRoot(inputCommonDir);
  const outDir = options.outDir ? path.join(process.cwd(), options.outDir) : inputCommonDir;
  const baseDir = searchForWorkspaceRoot(inputCommonDir);

  return { inputPaths, inputCommonDir, root, outDir, baseDir };
};
