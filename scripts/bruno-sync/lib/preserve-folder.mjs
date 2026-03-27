/**
 * preserve-folder.mjs
 *
 * Merges existing folder.bru customizations with newly generated folder root content.
 *
 * The merge strategy preserves user-authored fields from an existing folder.bru
 * (auth, vars, script, headers, settings, docs, seq) while allowing the newly
 * generated root to supply any fields not present in the existing file.
 *
 * Exported API:
 *   mergeFolderBru(existingPath, newFolderRoot) → mergedFolderRoot
 *
 * Does NOT write any files — the caller (writer.mjs) is responsible for that.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { parseFolder } from '@usebruno/filestore';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true only when value is a non-null object (not an array).
 * @param {unknown} v
 * @returns {boolean}
 */
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Returns true when a value is "present" — i.e. not null/undefined/empty-object/empty-string.
 * Arrays are considered present even when empty (an explicit [] is a real value).
 * @param {unknown} v
 * @returns {boolean}
 */
function hasValue(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.length > 0;
  if (isPlainObject(v)) return Object.keys(v).length > 0;
  return true; // number, boolean, array — always "present"
}

// ─────────────────────────────────────────────────────────────────────────────
// Core merge logic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a merged folder root by overlaying preserved fields from `existing`
 * on top of `newFolderRoot`.
 *
 * Fields taken from `existing` (when present):
 *   - request.auth
 *   - request.vars  (pre-request and post-response)
 *   - request.script
 *   - request.headers
 *   - docs
 *   - settings      (merged: newFolderRoot.settings ← existing.settings)
 *   - meta.seq      (if existing carries a seq in meta)
 *
 * @param {object} existing   - parsed result of parseFolder()
 * @param {object} newRoot    - new generated folder root object
 * @returns {object}          - merged folder root
 */
function mergeRoots(existing, newRoot) {
  const existingReq = existing.request ?? {};
  const newReq = newRoot.request ?? {};

  // ── request sub-object ─────────────────────────────────────────────────────
  const mergedRequest = {
    ...newReq,

    // auth: keep existing if it carries any meaningful value
    auth: hasValue(existingReq.auth)
      ? existingReq.auth
      : newReq.auth,

    // vars (pre-request / post-response scripts): keep existing if present
    vars: hasValue(existingReq.vars)
      ? existingReq.vars
      : newReq.vars,

    // script (test/pre-request JS blocks): keep existing if present
    script: hasValue(existingReq.script)
      ? existingReq.script
      : newReq.script,

    // headers: keep existing if non-empty array or has keys
    headers: hasValue(existingReq.headers)
      ? existingReq.headers
      : newReq.headers,
  };

  // ── settings: shallow merge (existing overrides generated) ─────────────────
  const mergedSettings = {
    ...(newRoot.settings ?? {}),
    ...(existing.settings ?? {}),
  };

  // ── docs: prefer existing when non-empty ───────────────────────────────────
  const mergedDocs = hasValue(existing.docs)
    ? existing.docs
    : (newRoot.docs ?? '');

  // ── seq: preserve if existing carries it in meta ───────────────────────────
  const existingSeq = existing.meta?.seq;
  const newMeta = newRoot.meta ?? {};
  const mergedMeta = existingSeq !== undefined
    ? { ...newMeta, seq: existingSeq }
    : newMeta;

  return {
    ...newRoot,
    request: mergedRequest,
    settings: mergedSettings,
    docs: mergedDocs,
    ...(Object.keys(mergedMeta).length > 0 ? { meta: mergedMeta } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merge an existing folder.bru file's customizations into a newly generated
 * folder root object.
 *
 * @param {string} existingPath   - Absolute path to an existing folder.bru file.
 *                                  May or may not exist on disk.
 * @param {object} newFolderRoot  - The newly generated folder root object, ready
 *                                  for stringifyFolder(). Typically `{}` (empty)
 *                                  for plain path-segment folders produced by the
 *                                  converter.
 * @returns {Promise<object>}     - The merged folder root object.
 *                                  Caller passes this to stringifyFolder().
 */
export async function mergeFolderBru(existingPath, newFolderRoot) {
  // ── Guard: no existing file → nothing to preserve ─────────────────────────
  if (!existsSync(existingPath)) {
    return newFolderRoot;
  }

  // ── Read existing file content ─────────────────────────────────────────────
  let rawContent;
  try {
    rawContent = await readFile(existingPath, 'utf-8');
  } catch (err) {
    console.warn(
      `[preserve-folder] Could not read "${existingPath}": ${err.message}. Using new content.`
    );
    return newFolderRoot;
  }

  // ── Parse existing folder.bru ──────────────────────────────────────────────
  let existing;
  try {
    existing = await Promise.resolve(parseFolder(rawContent, { format: 'bru' }));
  } catch (parseErr) {
    // Malformed file: create a timestamped backup, log a warning, use new content
    const timestamp = Date.now();
    const backupPath = path.join(
      path.dirname(existingPath),
      `.folder.bru.backup-${timestamp}`
    );

    try {
      await writeFile(backupPath, rawContent, 'utf-8');
      console.warn(
        `[preserve-folder] Malformed folder.bru at "${existingPath}". ` +
        `Backed up to "${backupPath}". Using new generated content.`
      );
    } catch (backupErr) {
      console.warn(
        `[preserve-folder] Malformed folder.bru at "${existingPath}" AND could not write backup: ${backupErr.message}. ` +
        `Using new generated content.`
      );
    }

    return newFolderRoot;
  }

  // ── Merge and return ───────────────────────────────────────────────────────
  return mergeRoots(existing, newFolderRoot);
}
