import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import YAML from 'yaml';
import { stringifyRequest } from '@usebruno/filestore';
import { assertWithin, folderName, mergeRequest, requestKey, safeName } from './yaml-merge.mjs';

async function discover(root) {
  const byKey = new Map();
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    if (dir !== root && entries.some(e => e.name === 'opencollection.yml')) return;
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isSymbolicLink()) throw new Error('Refusing symlink: ' + full);
      if (e.isDirectory()) {
        if (!['environments', 'mocks', 'node_modules', '.git'].includes(e.name)) await walk(full);
      } else if (e.isFile() && e.name.endsWith('.yml') && !['folder.yml','opencollection.yml'].includes(e.name)) {
        const doc = YAML.parseDocument(await fs.readFile(full, 'utf8'), { uniqueKeys: true });
        if (doc.errors.length) throw new Error('Invalid YAML: ' + full);
        const data = doc.toJS();
        if (data?.info?.type !== 'http') continue;
        const key = requestKey(data);
        if (!key) throw new Error('Invalid request endpoint: ' + full);
        byKey.set(key, [...(byKey.get(key) || []), { full, doc, data }]);
      }
    }
  }
  await walk(root);
  return byKey;
}
function flatten(items, segments = []) {
  return items.flatMap(item => {
    if (item.type === 'folder') return flatten(item.items || [], [...segments, folderName(item.name)]);
    if (item.type === 'http-request') return [{ item, segments }];
    throw new Error('Unknown OpenAPI item type: ' + item.type);
  });
}
export async function syncYamlCollection(collection, root, { dryRun = false } = {}) {
  if (!(await fs.stat(path.join(root, 'opencollection.yml')).catch(() => null))) {
    throw new Error('Target must be an OpenCollection YAML root: ' + root);
  }
  const existing = await discover(root);
  const generated = flatten(collection.items || []);
  if (!generated.length) throw new Error('OpenAPI produced zero requests; refusing to sync');
  const seen = new Set(), used = new Set(), changes = [], folders = new Set();
  const stats = { checked: generated.length, created: 0, updated: 0, unchanged: 0, removedCandidates: [] };
  for (const { item, segments } of generated) {
    const content = stringifyRequest(item, { format: 'yml' });
    const fresh = YAML.parse(content);
    if (fresh?.info?.type !== 'http' || !fresh.http) throw new Error('Invalid generated HTTP request');
    const key = requestKey(fresh);
    if (!key || seen.has(key)) throw new Error('Duplicate/invalid generated operation: ' + key);
    seen.add(key);
    const candidates = existing.get(key) || [];
    if (candidates.length > 1) throw new Error('Ambiguous existing operation: ' + key);
    if (candidates.length) {
      const old = candidates[0];
      used.add(old.full);
      const merged = mergeRequest(old.data, fresh);
      if (isDeepStrictEqual(merged, old.data)) { stats.unchanged++; continue; }
      for (const field of ['params', 'headers', 'body']) {
        if (!isDeepStrictEqual(merged.http[field], old.data.http[field])) old.doc.setIn(['http', field], merged.http[field]);
      }
      changes.push({ full: old.full, content: old.doc.toString({ lineWidth: 0 }) });
      stats.updated++;
    } else {
      const dir = path.resolve(root, ...segments);
      assertWithin(root, dir);
      const full = path.join(dir, safeName(item.name, key));
      assertWithin(root, full);
      if (await fs.stat(full).catch(() => null)) throw new Error('Refusing to overwrite: ' + full);
      for (let i = 1; i <= segments.length; i++) folders.add(path.resolve(root, ...segments.slice(0, i)));
      changes.push({ full, content });
      stats.created++;
    }
  }
  for (const entries of existing.values()) for (const e of entries) if (!used.has(e.full)) stats.removedCandidates.push(path.relative(root, e.full));
  stats.removedCandidates.sort();
  if (!dryRun) {
    for (const dir of [...folders].sort((a,b) => a.length - b.length)) {
      await fs.mkdir(dir, { recursive: true });
      const folder = path.join(dir, 'folder.yml');
      if (!(await fs.stat(folder).catch(() => null))) await fs.writeFile(folder, YAML.stringify({ info: { name: path.basename(dir), type: 'folder' } }));
    }
    for (const {full, content} of changes) await fs.writeFile(full, content, 'utf8');
  }
  return stats;
}
