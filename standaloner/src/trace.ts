import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { platform } from 'node:os';
import { nodeFileTrace, type NodeFileTraceResult } from '@vercel/nft';
import { assert, toPosixPath } from './utils/utils.js';
import { searchForPackageRoot } from './utils/searchRoot.js';
import { logInfo, logVerbose, logWarning } from './utils/logging.js';

export { trace };

const DEFAULT_VERSION = '0.0.0';
const MAX_PATH_LENGTH = 260; // Standard Windows MAX_PATH
const NODE_MODULES_RE = /((?:.+\/)?node_modules\/)([^/@]+|@[^/]+\/[^/]+)(\/?.*)?$/;

// Core types
interface PackageJson {
  name?: string;
  version?: string;
  exports?: any;
  [key: string]: any;
}

interface TracedFile {
  path: string; // Full real path to the file
  subpath: string; // Path relative to package root
  parents: string[]; // Full real paths of parent files
  pkgName: string; // Package name
  pkgVersion: string; // Package version
  pkgPath: string; // Path to package root (relative to baseDir)
  packageJson: PackageJson; // Package.json contents
}

/**
 * Traces dependencies for input files and organizes them into an output directory,
 * handling multi-version packages using a .versions structure.
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

  // Check for unsupported PnP
  try {
    require('pnpapi');
    logInfo('Warning: Yarn PnP detected, which is not supported. Skipping trace.');
    return;
  } catch {} // PnP not in use, proceed

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

  // Copy/link dependencies based on trace results
  await processTracedFiles(tracedFiles, { nodeModulesPath, versionsPath });
  logInfo('Package dependencies processed successfully.');
}

/**
 * Runs Node File Trace and processes results to build a map of dependency files with package metadata.
 */
async function traceProjectFiles(
  entryFiles: string[],
  baseDir: string,
  outDir: string
): Promise<Record<string, TracedFile>> {
  const traceResults = await nodeFileTrace(entryFiles, { base: baseDir });
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

  logInfo(`Traced ${Object.keys(tracedFilesMap).length} package dependency files.`);
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

    // Attempt to resolve package info (returns null if not in node_modules or a recognized workspace)
    let pkgInfo: Omit<TracedFile, 'path' | 'parents'> | null;
    if (posixPath.includes('node_modules/')) {
      pkgInfo = await resolveNodeModulesPackage(posixPath, baseDir);
    } else {
      pkgInfo = await resolveWorkspacePackage(realPath, baseDir);
    }

    // Only return a TracedFile object if package info was successfully resolved
    return pkgInfo ? { ...baseInfo, ...pkgInfo } : null;
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
  absoluteFilePath: string, // Use absolute path for reliable searching
  baseDir: string
): Promise<Omit<TracedFile, 'path' | 'parents'> | null> {
  try {
    // Find the nearest package.json directory above the file
    const pkgRoot = searchForPackageRoot(path.dirname(absoluteFilePath));
    if (!pkgRoot) return null; // searchForPackageRoot should handle not found cases

    const pkgJsonPath = path.join(pkgRoot, 'package.json');
    const pkgJsonContent = await fs.readFile(pkgJsonPath, 'utf-8');
    const pkgJson: PackageJson = JSON.parse(pkgJsonContent);

    // A package must have a name to be considered valid in this context
    if (!pkgJson?.name) {
      logWarning(`Workspace package at ${pkgRoot} skipped: missing name.`);
      return null;
    }

    return {
      pkgName: pkgJson.name,
      pkgVersion: pkgJson.version || DEFAULT_VERSION,
      pkgPath: path.relative(baseDir, pkgRoot), // Path relative to the tracing base directory
      subpath: path.relative(pkgRoot, absoluteFilePath), // Path relative to its own package root
      packageJson: pkgJson,
    };
  } catch (error: any) {
    // Fail gracefully if package.json is missing or unparsable
    logWarning(`Could not resolve workspace package for ${absoluteFilePath}: ${error.message}`);
    return null;
  }
}

/**
 * Resolves package info for a file path assumed to be within node_modules using regex.
 */
async function resolveNodeModulesPackage(
  relativePath: string, // Path relative to baseDir
  baseDir: string
): Promise<Omit<TracedFile, 'path' | 'parents'> | null> {
  const match = NODE_MODULES_RE.exec(relativePath);
  if (!match) {
    // This shouldn't happen if called correctly, but handle defensively
    return null;
  }
  const [, nodeModulesBase, pkgName, rawSubpath = ''] = match;

  assert(pkgName, `Failed to parse package name from ${relativePath}`);
  assert(nodeModulesBase, `Failed to parse node_modules base from ${relativePath}`);

  const pkgPath = path.join(nodeModulesBase, pkgName); // Package path relative to baseDir
  const pkgJsonPath = path.join(baseDir, pkgPath, 'package.json'); // Absolute path to package.json

  // Attempt to read and parse package.json, default to null if fails
  let pkgJson: PackageJson | null = null;
  try {
    const pkgJsonContent = await fs.readFile(pkgJsonPath, 'utf-8');
    pkgJson = JSON.parse(pkgJsonContent);
  } catch {
    // Ignore error (e.g., package.json not found), pkgJson remains null
  }

  // Ensure subpath doesn't start with a '/' after regex capture
  const subpath = rawSubpath.startsWith('/') ? rawSubpath.substring(1) : rawSubpath;

  return {
    pkgName,
    pkgVersion: pkgJson?.version || DEFAULT_VERSION,
    pkgPath,
    subpath,
    // Use the successfully read package.json, or provide a minimal default stub
    packageJson: pkgJson || { name: pkgName, version: DEFAULT_VERSION },
  };
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
      logInfo(`  ${name}: Copying single version`);
    } else {
      // --- Multi-version package ---
      multiVersionPackages[name] = versions;
      logInfo(`  ${name}: Handling ${versionEntries.length} versions`);
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
