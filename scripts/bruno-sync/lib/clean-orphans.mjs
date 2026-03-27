/**
 * clean-orphans.mjs
 *
 * Detects and removes orphaned .bru files not present in the generated collection.
 * Protected files (folder.bru, collection.bru, bruno.json, *.env) are never deleted.
 */

import fs from 'fs/promises';
import path from 'path';

/** Basenames that must never be deleted regardless of path. */
const PROTECTED_BASENAMES = new Set(['folder.bru', 'collection.bru', 'bruno.json']);

/**
 * Returns true if the given file path is protected from deletion.
 * @param {string} filePath - Absolute or relative file path.
 * @returns {boolean}
 */
function isProtected(filePath) {
  const base = path.basename(filePath);
  if (PROTECTED_BASENAMES.has(base)) return true;
  // Protect any *.env files
  if (base.endsWith('.env')) return true;
  return false;
}

/**
 * Recursively collects all .bru files under a directory.
 * @param {string} dir - Absolute path to search.
 * @returns {Promise<string[]>} Absolute paths of all .bru files found.
 */
async function collectBruFiles(dir) {
  const results = [];

  async function walk(current) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (err) {
      // Unreadable directory – skip silently
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.bru')) {
        results.push(fullPath);
      }
    }
  }

  await walk(dir);
  return results;
}

/**
 * Detects orphaned .bru files in targetDir that are not in generatedPaths.
 *
 * @param {string} targetDir - Absolute path to the collection directory.
 * @param {Set<string>} generatedPaths - Set of relative paths (from targetDir) that
 *   represent expected/generated files, e.g. 'api/funds/Get all funds.bru'.
 * @returns {Promise<Array<{ path: string, relativePath: string, type: 'request'|'unknown' }>>}
 */
export async function detectOrphans(targetDir, generatedPaths) {
  const normalizedTarget = path.resolve(targetDir);
  const allBruFiles = await collectBruFiles(normalizedTarget);

  const orphans = [];

  for (const absolutePath of allBruFiles) {
    const relativePath = path.relative(normalizedTarget, absolutePath);

    // Never flag protected files as orphans
    if (isProtected(absolutePath)) {
      continue;
    }

    // Normalize to forward slashes for cross-platform set lookup
    const normalizedRelative = relativePath.split(path.sep).join('/');

    if (!generatedPaths.has(normalizedRelative)) {
      orphans.push({
        path: absolutePath,
        relativePath: normalizedRelative,
        type: 'request',
      });
    }
  }

  return orphans;
}

/**
 * Removes orphaned files found by detectOrphans.
 * After deletion, walks up and removes empty parent directories
 * (stopping at targetDir – targetDir itself is never removed).
 *
 * @param {Array<{ path: string, relativePath: string, type: string }>} orphans
 *   Array returned by detectOrphans.
 * @param {{ dryRun?: boolean, targetDir?: string, logger?: Console }} [options]
 * @returns {Promise<{ detected: number, removed: number, protected: number, errors: Array<{ path: string, error: string }> }>}
 */
export async function removeOrphans(orphans, options = {}) {
  const { dryRun = false, targetDir, logger = console } = options;

  const stats = {
    detected: orphans.length,
    removed: 0,
    protected: 0,
    errors: [],
  };

  // Collect directories whose emptiness we need to check after deletion.
  const dirsToCheck = new Set();

  for (const orphan of orphans) {
    // Double-check protection (belt-and-suspenders)
    if (isProtected(orphan.path)) {
      logger.warn(`[clean-orphans] Skipping protected file: ${orphan.relativePath}`);
      stats.protected++;
      continue;
    }

    if (dryRun) {
      logger.info(`[clean-orphans] [dry-run] Would remove: ${orphan.relativePath}`);
      stats.removed++;
      continue;
    }

    try {
      await fs.unlink(orphan.path);
      logger.info(`[clean-orphans] Removed: ${orphan.relativePath}`);
      stats.removed++;
      dirsToCheck.add(path.dirname(orphan.path));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`[clean-orphans] Failed to remove ${orphan.relativePath}: ${message}`);
      stats.errors.push({ path: orphan.path, error: message });
    }
  }

  // Clean up empty parent directories (skip when dry-running)
  if (!dryRun && dirsToCheck.size > 0) {
    const resolvedTarget = targetDir ? path.resolve(targetDir) : null;
    await pruneEmptyDirs([...dirsToCheck], resolvedTarget, logger);
  }

  return stats;
}

/**
 * Walks up from each directory in the given list and removes it if empty,
 * stopping at (but not removing) targetDir.
 *
 * @param {string[]} dirs - Starting directories to inspect.
 * @param {string|null} stopAt - Absolute path of the root boundary (never removed).
 * @param {Console} logger
 */
async function pruneEmptyDirs(dirs, stopAt, logger) {
  // Sort deepest-first so we prune bottom-up efficiently.
  dirs.sort((a, b) => b.split(path.sep).length - a.split(path.sep).length);

  // Use a set to avoid re-checking the same directory multiple times.
  const visited = new Set();

  for (const startDir of dirs) {
    let current = startDir;

    while (true) {
      // Never delete the root boundary itself.
      if (stopAt && path.resolve(current) === stopAt) break;

      if (visited.has(current)) break;
      visited.add(current);

      let entries;
      try {
        entries = await fs.readdir(current);
      } catch {
        break; // Directory already gone or unreadable – stop walking this branch.
      }

      if (entries.length > 0) {
        // Directory still has content; stop walking up this branch.
        break;
      }

      try {
        await fs.rmdir(current);
        logger.info(`[clean-orphans] Removed empty directory: ${current}`);
      } catch (err) {
        // Race condition or permission error – stop here.
        break;
      }

      const parent = path.dirname(current);
      if (parent === current) break; // Filesystem root – stop.
      current = parent;
    }
  }
}
