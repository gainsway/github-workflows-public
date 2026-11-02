import { createHash } from 'node:crypto';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE']);

export function endpointKey(method, url) {
  const verb = String(method ?? '').toUpperCase();
  if (!METHODS.has(verb) || typeof url !== 'string') return null;
  let pathname = url.trim();
  // Ignore the host, including a templated Bruno baseUrl, but never the route.
  pathname = pathname.replace(/^[a-z][a-z\d+.-]*:\/\/[^/]+/i, '');
  pathname = pathname.replace(/^\{\{[^{}]+\}\}(?=\/)/, '');
  pathname = pathname.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';
  if (!pathname.startsWith('/') || pathname.startsWith('//')) return null;
  // The OpenAPI importer and hand-authored Bruno requests may use different
  // parameter names; only full path segments are treated as parameters.
  pathname = pathname.replace(/\/\{\{[^/{}]+\}\}(?=\/|$)/g, '/:param')
    .replace(/\/\{[^/{}]+\}(?=\/|$)/g, '/:param')
    .replace(/\/:\w+(?=\/|$)/g, '/:param');
  return `${verb} ${pathname}`;
}

export function requestKey(request) {
  return endpointKey(request?.http?.method, request?.http?.url);
}

function mergeEntries(spec = [], existing = [], label) {
  const old = new Map(existing.filter(x => x && x.name).map(x =>
    [`${label === 'headers' ? x.name.toLowerCase() : (x.type || 'query') + '/' + x.name}`, x]));
  const result = [];
  const seen = new Set();
  for (const entry of spec) {
    if (!entry?.name) continue;
    const k = label === 'headers' ? entry.name.toLowerCase() : (entry.type || 'query') + '/' + entry.name;
    if (seen.has(k)) continue;
    const saved = old.get(k);
    result.push(saved ? { ...entry, value: saved.value ?? entry.value, ...(saved.disabled !== undefined ? { disabled: saved.disabled } : {}) } : entry);
    seen.add(k);
  }
  // Keep manual headers and query parameters; removing them is destructive.
  for (const entry of existing) {
    if (!entry?.name) continue;
    const k = label === 'headers' ? entry.name.toLowerCase() : (entry.type || 'query') + '/' + entry.name;
    if (!seen.has(k)) { result.push(entry); seen.add(k); }
  }
  return result;
}

function mergeJsonShape(fromSpec, saved) {
  if (Array.isArray(fromSpec) && Array.isArray(saved)) {
    if (!fromSpec.length) return saved;
    if (!saved.length) return fromSpec;
    return saved.map((entry, i) => mergeJsonShape(fromSpec[Math.min(i, fromSpec.length - 1)], entry));
  }
  if (fromSpec !== null && saved !== null && typeof fromSpec === 'object' && typeof saved === 'object'
      && !Array.isArray(fromSpec) && !Array.isArray(saved)) {
    const result = { ...saved };
    for (const [key, value] of Object.entries(fromSpec)) {
      result[key] = key in saved ? mergeJsonShape(value, saved[key]) : value;
    }
    return result;
  }
  return saved === undefined || saved === null || saved === '' ? fromSpec : saved;
}

export function mergeRequest(existing, generated) {
  if (!existing?.http || !generated?.http) throw new Error('Expected OpenCollection HTTP requests');
  const result = structuredClone(existing);
  const old = existing.http, spec = generated.http;
  const changes = {};
  for (const key of ['params', 'headers']) {
    if (Array.isArray(spec[key])) changes[key] = mergeEntries(spec[key], old[key] || [], key);
    // Empty spec arrays cannot distinguish unspecified from removed; do not delete user entries.
  }
  if (spec.body) {
    if (!old.body) changes.body = spec.body;
    else if (old.body.type === 'json' && spec.body.type === 'json' &&
             typeof old.body.data === 'string' && typeof spec.body.data === 'string' &&
             !old.body.data.includes('{{')) {
      try {
        const merged = mergeJsonShape(JSON.parse(spec.body.data), JSON.parse(old.body.data));
        const parsedOld = JSON.parse(old.body.data);
        if (!isDeepStrictEqual(merged, parsedOld)) changes.body = {
          ...old.body, data: JSON.stringify(merged, null, 2)
        };
      } catch {
        // Invalid or templated JSON may be deliberate; leave it untouched.
      }
    }
    // Other body types stay user-owned, including form fields and scripts.
  }
  for (const [key, value] of Object.entries(changes)) {
    if (!isDeepStrictEqual(value, old[key])) result.http[key] = value;
  }
  // info, URL (including environment variables), auth, examples, runtime,
  // settings and additional custom extension fields are never overwritten.
  return result;
}

export function safeName(name, key, extension = '.yml') {
  const digest = createHash('sha256').update(key).digest('hex').slice(0, 10);
  let base = String(name || 'request').replace(/[\u0000-\u001f/\\:?*"|<>]/g, '_').trim()
    .replace(/^\.+$/, 'request').replace(/[. ]+$/, '');
  let chars = [...base], max = 225 - Buffer.byteLength(`--${digest}${extension}`);
  while (Buffer.byteLength(chars.join('')) > max) chars.pop();
  base = chars.join('').trim().replace(/[. ]+$/, '') || 'request';
  return `${base}--${digest}${extension}`;
}

export function folderName(name) {
  const value = String(name ?? '').replace(/[\u0000-\u001f/\\:?*"|<>]/g, '_').trim();
  if (!value || value === '.' || value === '..' || Buffer.byteLength(value) > 230) {
    throw new Error(`Invalid generated OpenAPI folder: ${JSON.stringify(name)}`);
  }
  return value;
}

export function assertWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error(`Target path outside collection root: ${candidate}`);
  }
}
