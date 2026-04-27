import path from 'node:path';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { nodeFileTrace, resolve as nftDefaultResolve, type NodeFileTraceResult } from '@vercel/nft';
import { assert, toPosixPath } from './utils/utils.js';
import { searchForPackageRoot } from './utils/searchRoot.js';
import { Colors, logInfo, logVerbose, logWarning } from './utils/logging.js';
import buildSummary from './utils/buildSummary.js';
import {
  getOriginPaths,
  multiVersionConflicts,
  type VersionConflict,
} from './utils/build-externals.js';

export { trace };

const DEFAULT_VERSION = '0.0.0';
const MAX_PATH_LENGTH = 260; // Standard Windows MAX_PATH
const NODE_MODULES_RE = /((?:.+\/)?node_modules\/)([^/@]+|@[^/]+\/[^/]+)(\/?.*)?$/;

/**
 * Core types for the trace module
 */

/**
 * Simplified package.json structure
 */
interface PackageJson {
  /** Package name */
  name?: string;
  /** Package version */
  version?: string;
  /** Package exports configuration */
  exports?: any;
  /** Any other fields in package.json */
  [key: string]: any;
}

/**
 * Represents a traced file with its metadata
 */
interface TracedFile {
  /** Full real path to the file */
  path: string;
  /** Path relative to package root */
  subpath: string;
  /** Full real paths of parent files that import this file */
  parents: string[];
  /** Package name */
  pkgName: string;
  /** Package version */
  pkgVersion: string;
  /** Path to package root (relative to baseDir) */
  pkgPath: string;
  /** Absolute realpath of the package root (same location as `pkgPath`, canonical form) */
  pkgPathReal: string;
  /** Package.json contents */
  packageJson: PackageJson;
}

/** Package-scoped metadata: everything on `TracedFile` except file-specific fields. */
type PkgInfo = Omit<TracedFile, 'path' | 'parents'>;

/**
 * Traces dependencies for input files and organizes them into an output directory,
 * handling multi-version packages using a .versions structure.
 *
 * This function:
 * 1. Analyzes the input files to find all required dependencies
 * 2. Resolves package information for each dependency
 * 3. Copies all dependencies to the output directory
 * 4. Handles multiple versions of the same package
 */
async function trace({
  input,
  baseDir,
  root, // Retained for potential context, though not used for filtering
  outDir,
  nodeModulesDir = 'node_modules',
  versionsDir = '.versions',
}: {
  input: string[];
  baseDir: string;
  root: string;
  outDir: string;
  versionsDir?: string;
  nodeModulesDir?: string;
}): Promise<void> {
  assert(input.length > 0, 'Input must be non-empty');
  logVerbose('Tracing package dependencies...');

  // Prepare output directories
  const nodeModulesPath = path.join(outDir, nodeModulesDir);
  const versionsPath = path.join(nodeModulesPath, versionsDir);
  await fs.mkdir(versionsPath, { recursive: true }).catch(err => {
    // Provide a more specific error if directory creation fails
    throw new Error(`Failed to create output directories at ${versionsPath}: ${err.message}`);
  });

  // Trace files and get package info
  const tracedFiles = await traceProjectFiles(input, baseDir, outDir);

  if (Object.keys(tracedFiles).length === 0) {
    logVerbose('No traceable package dependencies found.');
    return;
  }

  // Pick up platform-specific optionalDependencies that nft can't resolve statically
  // (rollup, esbuild, sharp, @parcel/watcher, @node-rs/* etc. load their native binding
  // via a dynamic require keyed on process.platform/arch).
  await traceOptionalDeps(tracedFiles, baseDir);

  // Pick up prebuilt native binaries that nft's static analysis misses
  // (node-gyp-build, prebuild-install, napi-rs — dynamic require by platform/arch).
  await addNativeBinaries(tracedFiles);

  // Copy/link dependencies based on trace results
  await processTracedFiles(tracedFiles, { nodeModulesPath, versionsPath });

  // Record dependency statistics in build summary
  const packageRegistry: Record<string, Record<string, string[]>> = {};

  // Group files by package name and version
  for (const file of Object.values(tracedFiles)) {
    packageRegistry[file.pkgName] ??= {};
    packageRegistry[file.pkgName]![file.pkgVersion] ??= [];
    packageRegistry[file.pkgName]![file.pkgVersion]!.push(file.path);
  }

  const multiVersionCount = Object.values(packageRegistry).filter(
    versions => Object.keys(versions).length > 1
  ).length;

  buildSummary.recordDependencies(
    Object.keys(packageRegistry).length,
    multiVersionCount,
    Object.keys(tracedFiles).length
  );

  // Don't log here, the build summary will show the results
}

/**
 * Runs Node File Trace and processes results to build a map of dependency files with package metadata.
 */
async function traceProjectFiles(
  entryFiles: string[],
  baseDir: string,
  outDir: string
): Promise<Record<string, TracedFile>> {
  // Warn loudly when the same external specifier resolves to different versions from
  // different importers. The bundler collapses externals to a single import in the output,
  // so only one version will ship at runtime regardless of what we do here.
  for (const conflict of multiVersionConflicts()) {
    await emitMultiVersionWarning(conflict, baseDir);
  }

  const traceResults = await nodeFileTrace(entryFiles, {
    base: baseDir,
    // Default-first: let nft's own resolution run as today. Only on miss, try our captured
    // phantom-dep map.
    // When multiple versions are captured, pick the highest semver: the bundler has
    // already collapsed the external to a single runtime import, and shipping the newer
    // copy is generally safer (APIs are typically backwards-compatible).
    resolve: async (id, parent, job, cjsResolve) => {
      try {
        return await nftDefaultResolve(id, parent, job, cjsResolve);
      } catch (err) {
        try {
          const parentFile = parent ? path.resolve(baseDir, parent) : path.join(baseDir, 'index.js');
          const req = createRequire(parentFile);
          return toPosixPath(req.resolve(id));
        } catch {}

        const fallback = await pickLatestOrigin(id);
        if (fallback) return fallback;
        throw err;
      }
    },
  });
  const relOutDir = path.relative(baseDir, outDir);

  // Filter out NFT internals, entry points, system files, and files already in output
  const filesToProcess = [...traceResults.fileList].filter(file => {
    const reason = traceResults.reasons.get(file);
    // Exclude initial files, system paths, and anything already inside the target output dir
    return !(
      reason?.type.includes('initial') ||
      file.startsWith('usr/') ||
      file.startsWith(relOutDir)
    );
  });

  const tracedFilesMap: Record<string, TracedFile> = {};
  const batchSize = 100; // Process in batches for performance

  logVerbose(`Analyzing ${filesToProcess.length} potential dependency files...`);

  for (let i = 0; i < filesToProcess.length; i += batchSize) {
    const batch = filesToProcess.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(file => processSingleFile(file, traceResults, baseDir))
    );
    // Add successfully processed files (those associated with a package) to the map
    for (const result of results) {
      if (result) {
        tracedFilesMap[result.path] = result;
      }
    }
  }

  logVerbose(`Found ${Object.keys(tracedFilesMap).length} non-bundleable files.`);
  return tracedFilesMap;
}

/**
 * Processes a single file path from NFT results to determine its package context.
 * Returns null if the file isn't part of a resolvable package (workspace or node_modules).
 */
async function processSingleFile(
  fileRelativePath: string,
  traceResults: NodeFileTraceResult,
  baseDir: string
): Promise<TracedFile | null> {
  const posixPath = toPosixPath(fileRelativePath);
  const fullPath = path.join(baseDir, posixPath);

  try {
    // Ensure it's an existing file, not a directory
    const stat = await fs.stat(fullPath).catch(() => null);
    if (!stat || stat.isDirectory()) {
      return null; // Skip directories or non-existent files silently
    }

    // Resolve symlinks for accurate path identification and parent tracking
    const realPath = await fs.realpath(fullPath).catch(() => fullPath);
    // Get parent files (dependents) that led to this file being included
    const parentPaths = [...(traceResults.reasons.get(fileRelativePath)?.parents || [])].map(p =>
      path.join(baseDir, p)
    ); // Store full paths of parents

    const baseInfo: Pick<TracedFile, 'path' | 'parents'> = { path: realPath, parents: parentPaths };

    const pkgInfo = posixPath.includes('node_modules/')
      ? await resolveNodeModulesPackage(posixPath, baseDir)
      : await resolveWorkspacePackage(realPath, baseDir);
    if (!pkgInfo) return null;
    return { ...baseInfo, ...pkgInfo };
  } catch (error: any) {
    // Log errors encountered during processing of a single file but continue tracing others
    logWarning(`Skipping file ${posixPath} due to error: ${error.message}`);
    return null;
  }
}

/**
 * Resolves package info for a file assumed to be within a workspace package by searching upwards for package.json.
 */
async function resolveWorkspacePackage(
  absoluteFilePath: string,
  baseDir: string
): Promise<PkgInfo | null> {
  const found = await readContainingPkgJson(absoluteFilePath);
  if (!found) return null;
  const { root: pkgRoot, pkgJson } = found;

  if (!pkgJson.name) {
    logWarning(`Workspace package at ${pkgRoot} skipped: missing name.`);
    return null;
  }

  const pkgName = pkgJson.name;
  const pkgVersion = pkgJson.version || DEFAULT_VERSION;
  const pkgPath = path.relative(baseDir, pkgRoot); // relative to the tracing base directory
  const pkgPathReal = pkgRoot; // already canonical (walked from a realpath)
  const subpath = path.relative(pkgRoot, absoluteFilePath);
  const packageJson = pkgJson;

  return { pkgName, pkgVersion, pkgPath, pkgPathReal, subpath, packageJson };
}

/**
 * Resolves package info for a file path assumed to be within node_modules using regex.
 * The regex gives us the package root directly, so no upward walk is needed.
 */
async function resolveNodeModulesPackage(
  relativePath: string, // Path relative to baseDir
  baseDir: string
): Promise<PkgInfo | null> {
  const match = NODE_MODULES_RE.exec(relativePath);
  if (!match) return null;
  const [, nodeModulesBase, pkgName, rawSubpath = ''] = match;

  assert(pkgName, `Failed to parse package name from ${relativePath}`);
  assert(nodeModulesBase, `Failed to parse node_modules base from ${relativePath}`);

  const pkgPath = path.join(nodeModulesBase, pkgName);
  const pkgRootAbs = path.join(baseDir, pkgPath);
  const pkgPathReal = await fs.realpath(pkgRootAbs).catch(() => pkgRootAbs);
  const pkgJson = await readPkgJson(pkgRootAbs);
  const subpath = rawSubpath.startsWith('/') ? rawSubpath.slice(1) : rawSubpath;
  const pkgVersion = pkgJson?.version || DEFAULT_VERSION;
  // Missing or unreadable package.json is tolerated — we still know the package name
  // from the regex — but downstream copy logic gets a minimal stub.
  const packageJson = pkgJson || { name: pkgName, version: DEFAULT_VERSION };

  return { pkgName, pkgVersion, pkgPath, pkgPathReal, subpath, packageJson };
}

/**
 * Organizes traced dependency files, copies/links them into the output node_modules structure.
 */
async function processTracedFiles(
  tracedFiles: Record<string, TracedFile>,
  { nodeModulesPath, versionsPath }: { nodeModulesPath: string; versionsPath: string }
): Promise<void> {
  // Group files by package name and version for easier processing
  const packageRegistry: Record<string, Record<string, string[]>> = {}; // { [pkgName]: { [version]: [filePath, ...] } }
  for (const file of Object.values(tracedFiles)) {
    // Assumes file processing already filtered out non-package files
    packageRegistry[file.pkgName] ??= {};
    packageRegistry[file.pkgName]![file.pkgVersion] ??= [];
    packageRegistry[file.pkgName]![file.pkgVersion]!.push(file.path);
  }

  const copyTasks: Promise<void>[] = [];
  const topLevelSymlinkTasks: Array<{ source: string; target: string }> = []; // Links for newest versions in top-level node_modules
  const multiVersionPackages: Record<string, Record<string, string[]>> = {}; // Track packages with multiple versions found

  // Process each package identified in the registry
  for (const [name, versions] of Object.entries(packageRegistry)) {
    const versionEntries = Object.entries(versions);

    if (versionEntries.length === 1) {
      // --- Single version package ---
      const [, /*version*/ files] = versionEntries[0]!;
      const destDir = path.join(nodeModulesPath, name);
      copyTasks.push(copyPackageVersion(files, destDir, tracedFiles));
      // Add package name to build summary instead of logging
      buildSummary.addPackageName(name);
    } else {
      // --- Multi-version package ---
      multiVersionPackages[name] = versions;
      // Add package name to build summary instead of logging
      buildSummary.addPackageName(name);
      // Sort versions newest first to easily identify the latest
      const sortedVersions = versionEntries.sort(([v1], [v2]) => compareVersions(v1, v2));

      // Copy each version into the dedicated .versions directory
      for (const [version, files] of sortedVersions) {
        const destDir = path.join(versionsPath, `${name}@${version}`);
        copyTasks.push(copyPackageVersion(files, destDir, tracedFiles));
      }

      // Prepare to symlink the newest version (first after sort) to the main node_modules output
      const [newestVersionStr] = sortedVersions[0]!;
      topLevelSymlinkTasks.push({
        source: path.join(versionsPath, `${name}@${newestVersionStr}`), // Source is in .versions
        target: path.join(nodeModulesPath, name), // Target is in top-level node_modules
      });
    }
  }

  logVerbose('Copying package files...');
  await Promise.all(copyTasks); // Execute all file copying concurrently

  logVerbose('Creating dependency symlinks...');
  // Create necessary symlinks *between* packages for multi-version resolution
  await createDependencySymlinks(tracedFiles, multiVersionPackages, {
    nodeModulesPath,
    versionsPath,
  });

  logVerbose('Creating top-level symlinks...');
  // Finally, create the top-level symlinks for the newest versions of multi-version packages
  await Promise.all(topLevelSymlinkTasks.map(task => createSymlink(task.source, task.target)));
}

/**
 * Copies the files belonging to a specific package version to the destination directory,
 * preserving internal structure and writing a processed package.json.
 */
async function copyPackageVersion(
  sourceFilePaths: string[], // Absolute paths to source files for this version
  destPackageDir: string, // Absolute path to the target directory for this package version
  tracedFiles: Record<string, TracedFile> // Map for getting file metadata (like subpath)
): Promise<void> {
  // Use metadata from the first file to get package.json info
  const sampleFileMeta = tracedFiles[sourceFilePaths[0]!];
  if (!sampleFileMeta) {
    logInfo(`Warning: No metadata found for files in ${destPackageDir}, skipping copy.`);
    return;
  }

  await fs.mkdir(destPackageDir, { recursive: true });
  const copyErrors: string[] = [];

  // Copy all files belonging to this package version concurrently
  await Promise.all(
    sourceFilePaths.map(async srcPath => {
      const fileMeta = tracedFiles[srcPath];
      if (!fileMeta) {
        copyErrors.push(`Missing metadata for ${srcPath}`);
        return; // Skip if metadata lookup fails unexpectedly
      }

      const destPath = path.join(destPackageDir, fileMeta.subpath); // Destination path including subdirectories

      if (destPath.length > MAX_PATH_LENGTH) {
        copyErrors.push(`Path too long (${destPath.length}): ${destPath}`);
        return;
      }

      try {
        // Ensure subdirectory structure exists before copying
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.copyFile(srcPath, destPath);
      } catch (e: any) {
        copyErrors.push(`Copy failed ${srcPath} -> ${destPath}: ${e.message}`);
      }
    })
  );

  // Log any errors encountered during copying
  if (copyErrors.length > 0) {
    logWarning(
      `Encountered ${copyErrors.length} errors copying files for ${path.basename(destPackageDir)}.`
    );
    copyErrors.slice(0, 5).forEach(err => logWarning(`  - ${err}`));
  }

  // Write package.json (with production exports applied) to the destination directory
  const finalPkgJson = { ...sampleFileMeta.packageJson };
  applyProductionCondition(finalPkgJson.exports); // Modify exports in-place
  try {
    await fs.writeFile(
      path.join(destPackageDir, 'package.json'),
      JSON.stringify(finalPkgJson, null, 2), // Pretty-print JSON
      'utf8'
    );
  } catch (e: any) {
    logInfo(`Error writing package.json for ${path.basename(destPackageDir)}: ${e.message}`);
  }
}

/**
 * Creates symlinks within package directories to point to the correct version
 * of their multi-version dependencies located in the .versions directory.
 * This mimics Node's resolution for nested dependencies with multiple versions.
 */
async function createDependencySymlinks(
  tracedFiles: Record<string, TracedFile>,
  multiVersionPackages: Record<string, Record<string, string[]>>, // Pkgs with >1 version traced
  { nodeModulesPath, versionsPath }: { nodeModulesPath: string; versionsPath: string }
): Promise<void> {
  // Use a Map to store symlink tasks (target -> source), automatically handling duplicates
  const symlinkTasks = new Map<string, string>();
  const symlinkErrors: string[] = [];

  // Iterate through all traced files to find dependencies crossing package boundaries
  for (const file of Object.values(tracedFiles)) {
    // Check each parent (dependent) file that required the current 'file'
    for (const parentPath of file.parents) {
      const parentFile = tracedFiles[parentPath];

      // Only create nested links if the dependency ('file') is multi-versioned
      // Ensure parent file metadata exists, it belongs to a package,
      // and it's a *different* package than the current file.
      if (
        multiVersionPackages[file.pkgName] &&
        parentFile?.pkgName &&
        parentFile.pkgName !== file.pkgName
      ) {
        // Determine the output directory of the *parent* package
        const parentPackageOutputDir = multiVersionPackages[parentFile.pkgName]
          ? path.join(versionsPath, `${parentFile.pkgName}@${parentFile.pkgVersion}`) // Parent is also multi-version
          : path.join(nodeModulesPath, parentFile.pkgName); // Parent is single-version

        // The symlink target is inside the parent's node_modules directory
        // e.g., .../parent@1.0.0/node_modules/dependency
        const target = path.join(parentPackageOutputDir, 'node_modules', file.pkgName);

        // The symlink source points to the specific version of the dependency required
        // e.g., ../../.versions/dependency@2.0.0 (relative path is calculated later)
        const source = path.join(versionsPath, `${file.pkgName}@${file.pkgVersion}`);

        // Add task to map (overwrites if target already exists, ensuring one link per target)
        symlinkTasks.set(target, source);
      }
    }
  }

  // Execute all unique symlink tasks concurrently
  await Promise.all(
    [...symlinkTasks.entries()].map(async ([target, source]) => {
      try {
        await createSymlink(source, target);
      } catch (e: any) {
        symlinkErrors.push(`Symlink failed ${source} -> ${target}: ${e.message}`);
      }
    })
  );

  if (symlinkErrors.length > 0) {
    logWarning(`Encountered ${symlinkErrors.length} errors creating dependency symlinks.`);
    symlinkErrors.slice(0, 5).forEach(err => logWarning(`  - ${err}`));
  }
}

/**
 * Helper function to create a symlink robustly.
 * Ensures target parent directory exists, checks path length, avoids errors if link exists,
 * and uses relative paths for better portability.
 */
async function createSymlink(source: string, target: string): Promise<void> {
  if (target.length > MAX_PATH_LENGTH) {
    // Throw an error for path length issues as it's often unrecoverable
    throw new Error(
      `Cannot create symlink, target path exceeds ${MAX_PATH_LENGTH} chars: ${target}`
    );
  }

  // Ensure the parent directory of the target symlink exists
  await fs.mkdir(path.dirname(target), { recursive: true });

  // Only create the link if the target path doesn't already exist (as file or link)
  // This prevents errors and avoids unnecessary filesystem operations.
  if (!existsSync(target)) {
    // Calculate the relative path from the link's location to the source directory
    const relativeSource = path.relative(path.dirname(target), source);

    // Use 'junction' on Windows for directory-like links (works better across drives),
    // 'dir' on other platforms. fs.symlink handles files correctly with these types too.
    const linkType = platform() === 'win32' ? 'junction' : 'dir';

    try {
      await fs.symlink(relativeSource, target, linkType);
    } catch (error: any) {
      // Add context to symlink creation errors
      throw new Error(
        `Failed to create symlink from ${relativeSource} to ${target}: ${error.message}`
      );
    }
  }
  // If target exists, assume it's correct (or was handled in a previous run) and do nothing.
}

/**
 * Recursively modifies a package.json `exports` object in-place
 * to apply the "production" condition where present, simplifying the exports structure.
 */
function applyProductionCondition(exports: any): void {
  if (!exports || typeof exports !== 'object') {
    return; // Base case: not a traversable object
  }

  // Check if a "production" condition exists directly at this level
  if ('production' in exports && exports.production != null) {
    // Check for non-null/undefined value
    const prodExportsValue = exports.production;
    // Crucially, remove the 'production' key *before* merging
    delete exports.production;

    // Merge the production exports into the current level.
    // If prodExportsValue is a string, it defines the main export ("."), replacing others at this level.
    // If it's an object, its properties are merged into the current exports level.
    if (typeof prodExportsValue === 'string') {
      // Clear existing keys at this level and set the main export
      Object.keys(exports).forEach(key => delete exports[key]);
      exports['.'] = prodExportsValue;
    } else if (typeof prodExportsValue === 'object') {
      Object.assign(exports, prodExportsValue);
    }
    // Note: After applying production, we might have introduced new nested objects that need processing,
    // so we continue the loop below.
  }

  // Recurse into any remaining nested objects (other conditions or subpath exports like "./subpath")
  for (const key in exports) {
    // Avoid infinite loops for circular references (though unlikely in valid package.json)
    if (typeof exports[key] === 'object' && exports[key] !== null) {
      applyProductionCondition(exports[key]);
    }
  }
}

async function traceOptionalDeps(
  tracedFiles: Record<string, TracedFile>,
  baseDir: string
): Promise<void> {
  // Names already covered by the main nft trace — skip those entirely so we don't
  // re-walk their directories. The per-file `tracedFiles[real]` dedup downstream would
  // also prevent duplication, but skipping here saves the readdir + stat calls.
  const alreadyTraced = new Set<string>();
  for (const file of Object.values(tracedFiles)) alreadyTraced.add(file.pkgName);

  for (const pkg of uniquePackages(tracedFiles)) {
    const optDeps = pkg.packageJson?.optionalDependencies;
    if (!optDeps || typeof optDeps !== 'object') continue;

    for (const depName of Object.keys(optDeps)) {
      if (alreadyTraced.has(depName)) continue;
      const depRoot = await findOptionalDepRoot(depName, pkg.path);
      if (!depRoot) continue;

      const depPkgJson = await readPkgJson(depRoot);
      if (!depPkgJson?.name) continue;

      // Per-package metadata reused for every file we add below.
      const pkgName = depPkgJson.name;
      const pkgVersion = depPkgJson.version || DEFAULT_VERSION;
      const pkgPath = path.relative(baseDir, depRoot);
      const pkgPathReal = depRoot;
      const packageJson = depPkgJson;
      const parents = [pkg.path];

      const entries = await fs.readdir(depRoot, { recursive: true, withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(entry.parentPath, entry.name);
        // Accept regular files and symlinks-to-files. A symlink-to-directory would slip
        // through a naive `isFile() || isSymbolicLink()` check and later trip `fs.copyFile`
        // with EISDIR, so we stat the target to confirm.
        if (!entry.isFile()) {
          if (!entry.isSymbolicLink()) continue;
          const targetStat = await fs.stat(fullPath).catch(() => null);
          if (!targetStat?.isFile()) continue;
        }
        const subpath = path.relative(depRoot, fullPath);
        if (subpath.split(/[\\/]/).includes('node_modules')) continue;
        const real = await fs.realpath(fullPath).catch(() => fullPath);
        if (tracedFiles[real]) continue;
        tracedFiles[real] = {
          path: real,
          subpath,
          parents,
          pkgName,
          pkgVersion,
          pkgPath,
          pkgPathReal,
          packageJson,
        };
      }
    }
  }
}

async function findOptionalDepRoot(
  depName: string,
  parentFile: string
): Promise<string | null> {
  let current = path.dirname(parentFile);
  while (true) {
    const candidate = path.join(current, 'node_modules', depName);
    try {
      await fs.access(path.join(candidate, 'package.json'));
      return candidate;
    } catch {}
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function readPkgJson(dir: string): Promise<PackageJson | null> {
  try {
    return JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf-8'));
  } catch {
    return null;
  }
}

async function readContainingPkgJson(
  file: string
): Promise<{ root: string; pkgJson: PackageJson } | null> {
  const root = searchForPackageRoot(path.dirname(file));
  if (!root) return null;
  const pkgJson = await readPkgJson(root);
  if (!pkgJson) {
    logWarning(`Could not read package.json at ${root}`);
    return null;
  }
  return { root, pkgJson };
}

/** Returns one sample `TracedFile` per unique `pkgName@pkgVersion` in the trace map. */
function uniquePackages(tracedFiles: Record<string, TracedFile>): TracedFile[] {
  const seen = new Set<string>();
  const samples: TracedFile[] = [];
  for (const file of Object.values(tracedFiles)) {
    const key = `${file.pkgName}@${file.pkgVersion}`;
    if (seen.has(key)) continue;
    seen.add(key);
    samples.push(file);
  }
  return samples;
}

/**
 * When a specifier was captured from multiple importers that resolved to different
 * versions, returns the highest-semver resolved path. Used by the nft fallback hook
 * so a single runtime `import` lands on the newest copy.
 */
async function pickLatestOrigin(id: string): Promise<string | undefined> {
  const paths = getOriginPaths(id);
  if (paths.length === 0) return undefined;
  if (paths.length === 1) return paths[0];

  let best: { path: string; version: string } | undefined;
  for (const resolved of paths) {
    const found = await readContainingPkgJson(resolved);
    const version = found?.pkgJson.version || DEFAULT_VERSION;
    // compareVersions returns (v2 - v1) per-component — positive when v2 > v1.
    if (!best || compareVersions(best.version, version) > 0) {
      best = { path: resolved, version };
    }
  }
  return best?.path;
}

/**
 * Looks up the package name containing the given importer file. Returns `null` for
 * files outside any named package.
 */
async function getImporterPkgName(importer: string): Promise<string | null> {
  const found = await readContainingPkgJson(importer);
  return found?.pkgJson.name || null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Builds and logs the multi-version warning for a single specifier, naming the actual
 * parent packages so the user can copy-paste the suggested `external` list.
 */
async function emitMultiVersionWarning(
  { id, versions }: VersionConflict,
  baseDir: string
): Promise<void> {
  const versionLines: string[] = [];
  const allParents = new Set<string>();

  for (const { resolvedPath, importers } of versions) {
    const parents = new Set<string>();
    for (const importer of importers) {
      const name = await getImporterPkgName(importer);
      if (name) {
        parents.add(name);
        allParents.add(name);
      }
    }
    const parentLabel = parents.size > 0 ? [...parents].join(', ') : '<unknown parent>';
    versionLines.push(
      `  ${Colors.yellow}•${Colors.reset} ${path.relative(baseDir, resolvedPath)}\n` +
        `      ${Colors.cyan}imported by:${Colors.reset} ${parentLabel}`
    );
  }

  const externalSuggestion =
    allParents.size > 0
      ? `[${[...allParents].map(n => `/^${escapeRegex(n)}$/`).join(', ')}]`
      : `[/^<parent-pkg>$/]`;

  // Multi-line message — logWarning will wrap this in a block with top/bottom rules.
  // First line sits next to the `[build:warning]` prefix.
  logWarning(
    `${Colors.bright}Multi-version external "${id}"${Colors.reset} resolves to ${Colors.bright}${versions.length}${Colors.reset} different on-disk locations:\n` +
      '\n' +
      versionLines.join('\n') +
      '\n' +
      '\n' +
      `  The bundled output contains a single \`${Colors.bright}import "${id}"${Colors.reset}\`; at runtime only one copy will be loaded.\n` +
      '\n' +
      `  ${Colors.bright}Fix:${Colors.reset} externalize the parent packages so they stay in node_modules.\n` +
      `  The tracer handles nested versions correctly when parents are not bundled:\n` +
      '\n' +
      `    ${Colors.green}${Colors.bright}standaloner({ external: ${externalSuggestion} })${Colors.reset}`
  );
}

/**
 * Globs each unique traced package for `**\/*.node` and adds any prebuilt binaries
 * that nft's static analysis missed (common for node-gyp-build / prebuild-install / napi-rs).
 */
async function addNativeBinaries(tracedFiles: Record<string, TracedFile>): Promise<void> {
  for (const sample of uniquePackages(tracedFiles)) {
    try {
      // `exclude: node_modules` prevents descending into nested deps under flat layouts —
      // their .node files belong to the inner package, not to this outer one, and the
      // inner package will be globbed on its own iteration.
      for await (const rel of fs.glob('**/*.node', {
        cwd: sample.pkgPathReal,
        exclude: name => name === 'node_modules',
      })) {
        const abs = path.join(sample.pkgPathReal, rel);
        // Defensive `isFile`: glob can match dangling symlinks or directories whose
        // names happen to end in `.node`. Skip anything that doesn't actually resolve
        // to a regular file before adding it to the trace.
        const targetStat = await fs.stat(abs).catch(() => null);
        if (!targetStat?.isFile()) continue;
        const real = await fs.realpath(abs).catch(() => abs);
        if (tracedFiles[real]) continue;
        const subpath = path.relative(sample.pkgPathReal, abs);
        const { pkgName, pkgVersion, pkgPath, pkgPathReal, packageJson } = sample;
        const parents: string[] = [];
        tracedFiles[real] = {
          path: real,
          subpath,
          parents,
          pkgName,
          pkgVersion,
          pkgPath,
          pkgPathReal,
          packageJson,
        };
      }
    } catch {
      // Glob failure for this package (permissions, missing dir) — skip silently.
    }
  }
}

/**
 * Compares two version strings (e.g., "1.2.3" or "1.0.0-beta.1").
 * Returns > 0 if v2 > v1, < 0 if v1 > v2, 0 if equal. Sorts newest first (descending).
 * Handles simple numeric comparisons. Doesn't handle pre-release tags robustly (e.g., beta, rc).
 */
function compareVersions(v1 = DEFAULT_VERSION, v2 = DEFAULT_VERSION): number {
  // Basic parsing, ignores pre-release tags
  const parsePart = (n: string): number => parseInt(n, 10) || 0;
  const p1 = v1.split('-')[0]!.split('.').map(parsePart);
  const p2 = v2.split('-')[0]!.split('.').map(parsePart);

  for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
    const num1 = p1[i] || 0; // Default to 0 if part doesn't exist (e.g., 1.0 vs 1.0.0)
    const num2 = p2[i] || 0;
    if (num1 !== num2) {
      return num2 - num1; // Sort descending (newest first)
    }
  }
  return 0; // Versions are numerically equal (ignoring pre-release)
}
