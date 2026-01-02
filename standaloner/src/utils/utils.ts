import path from 'node:path';
import fs from 'node:fs';

export { resolveInputs };
export { assert };
export { assertUsage };
export { findCommonAncestor };
export { isFileReadable };
export { toPosixPath };

/**
 * Converts a path to use POSIX separators (forward slashes)
 * @param filePath Path to convert
 * @returns Path with forward slashes regardless of platform
 */
function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

/**
 * Resolves input paths to absolute paths with normalized POSIX separators
 * @param input - Input value that can be a string, string array, or object with string values
 * @returns Array of resolved absolute paths in POSIX format
 */
function resolveInputs(input: string | string[] | Record<string, string>): string[] {
  // Resolve each path and normalize to POSIX format
  return toStringArray(input).map(inputPath => {
    // Get absolute path and convert to POSIX format
    return toPosixPath(path.resolve(inputPath));
  });
}

const toStringArray = (value: string | string[] | Record<string, string>): string[] =>
  typeof value === 'string' ? [value] : Array.isArray(value) ? value : Object.values(value);

/**
 * Finds the common ancestor directory of multiple paths
 * @param paths Array of file or directory paths
 * @returns The common ancestor directory path in POSIX format
 */
function findCommonAncestor(paths: string[]): string {
  assert(Array.isArray(paths), 'paths must be an array');
  if (paths.length === 0) return '';

  // Handle single path case by returning its directory
  if (paths.length === 1) return toPosixPath(path.dirname(paths[0]!));

  // Convert paths to directory paths to handle files correctly
  const dirPaths = paths.map(p => toPosixPath(path.dirname(p)));

  // Split paths into segments and filter out empty segments
  const pathSegments = dirPaths.map(p => p.split('/').filter(Boolean));
  const firstPath = pathSegments[0];
  if (!firstPath?.length) return '';

  // Find common prefix length
  let commonPrefixLength = 0;
  for (let i = 0; i < firstPath.length; i++) {
    if (pathSegments.every(segments => segments[i] === firstPath[i])) {
      commonPrefixLength++;
    } else {
      break;
    }
  }

  // Build common path
  const commonPath = firstPath.slice(0, commonPrefixLength).join('/');

  // Add leading slash for absolute paths
  return paths[0]!.startsWith('/') ? `/${commonPath}` : commonPath;
}

function isFileReadable(filename: string): boolean {
  if (!tryStatSync(filename)) {
    return false;
  }

  try {
    // Check if current process has read permission to the file
    fs.accessSync(filename, fs.constants.R_OK);

    return true;
  } catch {
    return false;
  }
}

function tryStatSync(filename: string): boolean {
  try {
    fs.statSync(filename);
    return true;
  } catch {
    return false;
  }
}

function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function assertUsage(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

