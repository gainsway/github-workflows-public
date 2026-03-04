#!/usr/bin/env node
/**
 * generate-bruno-collection.mjs
 *
 * CLI script that converts an OpenAPI spec to a Bruno collection on disk.
 *
 * Usage:
 *   node generate-bruno-collection.mjs \
 *     --spec /path/to/openapi.json \
 *     --target /path/to/bruno-collection \
 *     [--dry-run] \
 *     [--clean]
 */

import fs from 'fs/promises';
import path from 'path';
import { openApiToBruno } from '@usebruno/converters';
import { writeCollection } from './lib/writer.mjs';
import { mergeFolderBru } from './lib/preserve-folder.mjs';
import { detectOrphans, removeOrphans } from './lib/clean-orphans.mjs';

// ─────────────────────────────────────────────────────────────────────────────
// Arg parsing
// ─────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = argv.slice(2); // drop 'node' and script path
  const result = {
    spec: null,
    target: null,
    dryRun: false,
    clean: false,
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--spec':
        result.spec = args[++i] ?? null;
        break;
      case '--target':
        result.target = args[++i] ?? null;
        break;
      case '--dry-run':
        result.dryRun = true;
        break;
      case '--clean':
        result.clean = true;
        break;
      default:
        console.error(`Unknown argument: ${args[i]}`);
        printUsage();
        process.exit(1);
    }
  }

  return result;
}

function printUsage() {
  console.error(`
Usage:
  node generate-bruno-collection.mjs \\
    --spec <path-to-openapi.json> \\
    --target <path-to-bruno-collection-dir> \\
    [--dry-run] \\
    [--clean]

Options:
  --spec      Required. Path to the OpenAPI JSON spec file.
  --target    Required. Path to the target Bruno collection directory.
  --dry-run   Preview changes without writing anything to disk.
  --clean     Detect and remove orphaned .bru files after generation.
`.trim());
}

// ─────────────────────────────────────────────────────────────────────────────
// Path tracking helpers (used for orphan detection)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Walk a collection item tree and collect all relative paths that will be
 * generated, so detectOrphans() can compare against what's on disk.
 *
 * @param {object[]} items
 * @param {string}   prefix  - Relative path prefix (empty at root)
 * @returns {Set<string>}    - Forward-slash-delimited relative paths
 */
function collectGeneratedPaths(items, prefix = '') {
  const paths = new Set();

  for (const item of items ?? []) {
    const safeName = item.name
      // eslint-disable-next-line no-control-regex
      .replace(/[/\\:?*"|<>\x00-\x1f]/g, '_')
      .trim();

    if (item.type === 'folder') {
      const folderPrefix = prefix ? `${prefix}/${safeName}` : safeName;
      paths.add(`${folderPrefix}/folder.bru`);
      for (const p of collectGeneratedPaths(item.items ?? [], folderPrefix)) {
        paths.add(p);
      }
    } else if (item.type === 'http-request') {
      const filename = `${safeName}.bru`;
      paths.add(prefix ? `${prefix}/${filename}` : filename);
    }
  }

  return paths;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv);

  // ── Validate required args ─────────────────────────────────────────────────
  if (!opts.spec || !opts.target) {
    console.error('Error: --spec and --target are required.\n');
    printUsage();
    process.exit(1);
  }

  const specPath   = path.resolve(opts.spec);
  const targetDir  = path.resolve(opts.target);
  const { dryRun, clean } = opts;

  if (dryRun) {
    console.log('[dry-run] No files will be written or deleted.\n');
  }

  // ── Read and parse spec ────────────────────────────────────────────────────
  console.log(`Loading spec: ${specPath}`);
  let specRaw;
  try {
    specRaw = await fs.readFile(specPath, 'utf-8');
  } catch (err) {
    console.error(`Error: Cannot read spec file "${specPath}": ${err.message}`);
    process.exit(1);
  }

  let spec;
  try {
    spec = JSON.parse(specRaw);
  } catch (err) {
    console.error(`Error: Invalid JSON in spec file "${specPath}": ${err.message}`);
    process.exit(1);
  }

  const pathCount = Object.keys(spec.paths ?? {}).length;
  console.log(`Spec loaded: ${spec.info?.title ?? '(no title)'} v${spec.info?.version ?? '?'} — ${pathCount} paths`);

  // ── Convert to Bruno collection ────────────────────────────────────────────
  console.log('\nConverting OpenAPI spec to Bruno collection...');
  let brunoCollection;
  try {
    brunoCollection = openApiToBruno(spec, { groupBy: 'path' });
  } catch (err) {
    console.error(`Error: Conversion failed: ${err.message}`);
    process.exit(1);
  }

  const totalItems = (brunoCollection.items ?? []).length;
  console.log(`Conversion complete — ${totalItems} top-level item(s) produced.`);

  // ── onFolderBru callback: merge existing folder.bru before writing ─────────
  /**
   * Called by writeCollection for every folder item before stringifying.
   * Merges existing on-disk folder.bru customizations (auth, vars, script, …)
   * into the freshly generated folder root.
   *
   * @param {object} folderItem   - The folder item from the collection
   * @param {string} folderDirPath - Absolute path of the folder directory
   * @returns {Promise<object>}   - Merged folder root
   */
  async function onFolderBru(folderItem, folderDirPath) {
    const existingFolderBruPath = path.join(folderDirPath, 'folder.bru');
    const newFolderRoot = folderItem.root ?? {};
    const safeName = folderItem.name
      // eslint-disable-next-line no-control-regex
      .replace(/[/\\:?*"|<>\x00-\x1f]/g, '_')
      .trim();
    console.log(`  Creating folder: ${path.relative(targetDir, folderDirPath) || safeName}`);
    return mergeFolderBru(existingFolderBruPath, newFolderRoot);
  }

  // ── Write collection ───────────────────────────────────────────────────────
  console.log(`\nWriting collection to: ${targetDir}${dryRun ? ' (dry-run)' : ''}`);

  let writeStats;
  try {
    writeStats = await writeCollection(brunoCollection, targetDir, {
      dryRun,
      onFolderBru,
    });
  } catch (err) {
    console.error(`Error: Failed to write collection: ${err.message}`);
    process.exit(1);
  }

  // ── Orphan detection / removal ─────────────────────────────────────────────
  let orphanStats = null;

  if (clean) {
    console.log('\nDetecting orphaned .bru files...');
    const generatedPaths = collectGeneratedPaths(brunoCollection.items ?? []);

    let orphans;
    try {
      orphans = await detectOrphans(targetDir, generatedPaths);
    } catch (err) {
      console.error(`Error: Orphan detection failed: ${err.message}`);
      process.exit(1);
    }

    if (orphans.length === 0) {
      console.log('No orphans found.');
    } else {
      console.log(`Found ${orphans.length} orphan(s).`);
      for (const orphan of orphans) {
        console.log(`  Removing orphan: ${orphan.relativePath}`);
      }
    }

    try {
      orphanStats = await removeOrphans(orphans, { dryRun, targetDir });
    } catch (err) {
      console.error(`Error: Orphan removal failed: ${err.message}`);
      process.exit(1);
    }
  }

  // ── Final stats ────────────────────────────────────────────────────────────
  console.log('\n─────────────────────────────');
  console.log(dryRun ? 'Dry-run complete — no files changed.' : 'Done.');
  console.log(`  Created : ${writeStats.created}`);
  console.log(`  Updated : ${writeStats.updated}`);
  console.log(`  Skipped : ${writeStats.skipped}`);
  if (writeStats.errors.length > 0) {
    console.log(`  Errors  : ${writeStats.errors.length}`);
    for (const e of writeStats.errors) {
      console.error(`    [${e.type}] ${e.name}: ${e.error}`);
    }
  }

  if (orphanStats) {
    console.log(`  Orphans detected : ${orphanStats.detected}`);
    console.log(`  Orphans removed  : ${orphanStats.removed}`);
    if (orphanStats.errors.length > 0) {
      console.log(`  Orphan errors    : ${orphanStats.errors.length}`);
      for (const e of orphanStats.errors) {
        console.error(`    ${e.path}: ${e.error}`);
      }
    }
  }

  console.log('─────────────────────────────');

  // Exit 1 if there were any errors
  const hasErrors =
    writeStats.errors.length > 0 ||
    (orphanStats && orphanStats.errors.length > 0);

  process.exit(hasErrors ? 1 : 0);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
