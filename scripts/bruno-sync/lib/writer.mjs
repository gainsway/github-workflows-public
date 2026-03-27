/**
 * writer.mjs — Writes a Bruno collection object to disk as .bru files.
 *
 * Converts a Bruno collection (as produced by openApiToBruno()) into the
 * on-disk folder/file structure that Bruno reads natively.
 *
 * Does NOT write:
 *  - bruno.json
 *  - collection.bru / root collection files
 *  - environment files
 *
 * @module writer
 */

import fs from 'fs/promises';
import path from 'path';
import { stringifyRequest, stringifyFolder } from '@usebruno/filestore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sanitize an item name to a safe filesystem filename.
 * Replaces characters that are illegal in filenames on common OSes.
 *
 * Stripped chars: / \ : ? * " | < > and control characters (0x00-0x1f)
 *
 * @param {string} name
 * @returns {string}
 */
function sanitizeName(name) {
  return name
    // eslint-disable-next-line no-control-regex
    .replace(/[/\\:?*"|<>\x00-\x1f]/g, '_')
    .trim();
}

/**
 * Strip HTTP verb prefix from request name.
 * Removes leading "Get ", "Post ", "Put ", "Patch ", "Delete " (case-insensitive).
 *
 * @param {string} name
 * @returns {string}
 */
function stripHttpVerb(name) {
  return name.replace(/^(Get|Post|Put|Patch|Delete)\s+/i, '').trim();
}

/**
 * Read a file's content, returning null if the file does not exist.
 *
 * @param {string} filePath
 * @returns {Promise<string|null>}
 */
async function readFileOrNull(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Core recursive writer
// ---------------------------------------------------------------------------

/**
 * Recursively walk a Bruno collection item tree and write files to disk.
 *
 * @param {object[]} items        - Array of folder or request items
 * @param {string}   currentDir  - Absolute path of the current directory
 * @param {object}   stats       - Stats accumulator { created, updated, skipped, errors }
 * @param {boolean}  dryRun      - When true, nothing is written to disk
 * @returns {Promise<void>}
 */
async function writeItems(items, currentDir, stats, dryRun) {
  for (const item of items) {
    if (item.type === 'folder') {
      await writeFolder(item, currentDir, stats, dryRun);
    } else if (item.type === 'http-request') {
      await writeRequest(item, currentDir, stats, dryRun);
    } else {
      // Unknown item type — skip silently
      stats.skipped += 1;
    }
  }
}

/**
 * Write a single folder item and recurse into its children.
 *
 * - Creates the directory (recursively) if it does not exist.
 * - Writes `folder.bru` using stringifyFolder(folderItem.root ?? {}).
 *   Empty strings are still written (valid Bruno representation of a plain folder).
 *
 * @param {object}  folderItem
 * @param {string}  parentDir
 * @param {object}  stats
 * @param {boolean} dryRun
 */
async function writeFolder(folderItem, parentDir, stats, dryRun) {
  const safeName = sanitizeName(folderItem.name);
  const folderDir = path.join(parentDir, safeName);

  if (!dryRun) {
    await fs.mkdir(folderDir, { recursive: true });
  }

  // Write folder.bru
  // Converter-generated folders have no `root` property (see issues.md Issue 1).
  // Pass empty object — stringifyFolder({}) returns "" which is valid.
  let folderContent;
  try {
    folderContent = stringifyFolder(folderItem.root ?? {}, { format: 'bru' });
  } catch (err) {
    stats.errors.push({
      type: 'folder',
      name: folderItem.name,
      path: folderDir,
      error: err.message,
    });
    // Still recurse into children even if folder.bru fails
    if (Array.isArray(folderItem.items)) {
      await writeItems(folderItem.items, folderDir, stats, dryRun);
    }
    return;
  }

  const folderBruPath = path.join(folderDir, 'folder.bru');
  await writeFileMaybeSkip(folderBruPath, folderContent, stats, dryRun);

  // Recurse into children
  if (Array.isArray(folderItem.items) && folderItem.items.length > 0) {
    await writeItems(folderItem.items, folderDir, stats, dryRun);
  }
}

/**
 * Write a single request item as `{sanitizedName}.bru`.
 *
 * @param {object}  requestItem
 * @param {string}  parentDir
 * @param {object}  stats
 * @param {boolean} dryRun
 */
async function writeRequest(requestItem, parentDir, stats, dryRun) {
  const safeName = sanitizeName(stripHttpVerb(requestItem.name));
  const filename = `${safeName}.bru`;
  const filePath = path.join(parentDir, filename);

  let content;
  try {
    content = stringifyRequest(requestItem, { format: 'bru' });
  } catch (err) {
    stats.errors.push({
      type: 'request',
      name: requestItem.name,
      path: filePath,
      error: err.message,
    });
    return;
  }

  await writeFileMaybeSkip(filePath, content, stats, dryRun);
}

/**
 * Write content to a file, updating stats based on whether the file:
 *  - Did not exist before    → created
 *  - Exists with same content → skipped
 *  - Exists with diff content → updated
 *
 * In dryRun mode, reads existing content for comparison but does NOT write.
 *
 * @param {string}  filePath
 * @param {string}  content
 * @param {object}  stats
 * @param {boolean} dryRun
 */
async function writeFileMaybeSkip(filePath, content, stats, dryRun) {
  const existing = await readFileOrNull(filePath);

  if (existing === null) {
    // File does not exist → create
    if (!dryRun) {
      await fs.writeFile(filePath, content, 'utf8');
    }
    stats.created += 1;
  } else if (existing === content) {
    // File exists and is identical → skip
    stats.skipped += 1;
  } else {
    // File exists but content differs → update
    if (!dryRun) {
      await fs.writeFile(filePath, content, 'utf8');
    }
    stats.updated += 1;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Write a Bruno collection to disk as .bru files.
 *
 * Traverses collection.items recursively and produces:
 *  - A directory per folder (named after the folder, sanitized)
 *  - A `folder.bru` file inside each folder directory
 *  - A `{requestName}.bru` file for each request
 *
 * Does NOT write bruno.json, collection.bru, or environment files.
 *
 * @param {object}  collection              - Bruno collection object (from openApiToBruno())
 * @param {string}  targetDir               - Absolute path where files should be written
 * @param {object}  [options]               - Optional configuration
 * @param {boolean} [options.dryRun=false]  - If true, preview changes without writing
 *
 * @returns {Promise<{ created: number, updated: number, skipped: number, errors: Array }>}
 *
 * @example
 * import { writeCollection } from './lib/writer.mjs';
 * const stats = await writeCollection(brunoCollection, '/path/to/target', { dryRun: false });
 * // stats = { created: 15, updated: 3, skipped: 7, errors: [] }
 */
export async function writeCollection(collection, targetDir, options = {}) {
  const dryRun = options.dryRun === true;

  const stats = {
    created: 0,
    updated: 0,
    skipped: 0,
    errors: [],
  };

  if (!collection || !Array.isArray(collection.items)) {
    throw new TypeError('writeCollection: collection.items must be an array');
  }

  if (!targetDir || typeof targetDir !== 'string') {
    throw new TypeError('writeCollection: targetDir must be a non-empty string');
  }

  // Ensure the target directory exists (unless dryRun)
  if (!dryRun) {
    await fs.mkdir(targetDir, { recursive: true });
  }

  await writeItems(collection.items, targetDir, stats, dryRun);

  return stats;
}
