#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { openApiToBruno } from '@usebruno/converters';
import { syncYamlCollection } from './lib/sync-yaml.mjs';
import { writeCollection } from './lib/writer.mjs';
import { detectOrphans, removeOrphans } from './lib/clean-orphans.mjs';
function options(args) {
  const o = { format: 'bru', dryRun: false, clean: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dry-run') o.dryRun = true;
    else if (args[i] === '--clean') o.clean = true;
    else if (['--spec','--target','--format'].includes(args[i])) o[args[i++].slice(2)] = args[i];
    else throw Error('Unknown CLI flag: ' + args[i]);
  }
  if (!o.spec || !o.target || !['bru','yml'].includes(o.format)) throw Error('Usage: --spec FILE --target DIR [--format yml|bru]');
  if (o.clean && o.format === 'yml') throw Error('Automatic YAML deletion is disabled');
  return o;
}
async function main() {
  const o = options(process.argv.slice(2));
  const spec = YAML.parse(await fs.readFile(path.resolve(o.spec), 'utf8'), { uniqueKeys: true });
  if (!spec?.paths || !spec.info || !(String(spec.openapi || '').startsWith('3.') || String(spec.swagger || '').startsWith('2.'))) throw Error('Unsupported or invalid OpenAPI spec');
  const generated = openApiToBruno(spec, { groupBy: 'path' });
  if (o.format === 'yml') {
    const result = await syncYamlCollection(generated, path.resolve(o.target), { dryRun: o.dryRun });
    console.log(JSON.stringify(result, null, 2));
    if (result.removedCandidates.length) console.warn('Requests absent from spec (not deleted):', result.removedCandidates);
  } else {
    const stats = await writeCollection(generated, path.resolve(o.target), { dryRun: o.dryRun });
    if (stats.errors.length) throw Error('Bruno writer errors: ' + JSON.stringify(stats.errors));
    if (o.clean) console.warn('--clean is deprecated; no requests were deleted');
    console.log(JSON.stringify(stats, null, 2));
  }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
