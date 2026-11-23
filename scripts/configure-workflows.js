#!/usr/bin/env node
'use strict';
/*
 * Point the n8n workflow exports at your backend.
 *
 *   node scripts/configure-workflows.js https://api.example.com
 *   node scripts/configure-workflows.js http://127.0.0.1:4000 --in-place
 *
 * The checked-in exports call http://host.docker.internal:4000 (n8n in Docker, backend on the host).
 * By default the rewritten copies go to automation/workflows.configured/ (git-ignored) so the repo
 * files stay generic; --in-place rewrites automation/workflows/ itself.
 * Only the backend base URL is replaced. Credentials, webhooks and logic are not touched.
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_BASE = 'http://host.docker.internal:4000';
// Older exports (and the loose copies in the repo root) were saved with this host. Rewrite it too,
// otherwise the workflow talks to a different backend than the dashboard does.
const LEGACY_BASES = ['https://astrohealth-api.autoflow.cfd'];
const KNOWN_BASES = [DEFAULT_BASE, ...LEGACY_BASES];
const args = process.argv.slice(2);
const inPlace = args.includes('--in-place');
const target = args.find((a) => !a.startsWith('--'));

if (!target) {
  console.error('Usage: node scripts/configure-workflows.js <backend-base-url> [--in-place]');
  process.exit(1);
}

let base;
try {
  const u = new URL(target);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('protocol');
  base = u.origin + u.pathname.replace(/\/+$/, '');
} catch {
  console.error(`Not a valid http(s) URL: ${target}`);
  process.exit(1);
}

const root = path.resolve(__dirname, '..', 'automation');
const srcDir = path.join(root, 'workflows');
const outDir = inPlace ? srcDir : path.join(root, 'workflows.configured');
fs.mkdirSync(outDir, { recursive: true });

let total = 0;
for (const file of fs.readdirSync(srcDir).filter((f) => f.endsWith('.json')).sort()) {
  const text = fs.readFileSync(path.join(srcDir, file), 'utf8');
  JSON.parse(text); // fail early on a broken export
  let count = 0;
  let out = text;
  for (const known of KNOWN_BASES) {
    count += out.split(known).length - 1;
    out = out.split(known).join(base);
  }
  JSON.parse(out);
  fs.writeFileSync(path.join(outDir, file), out);
  total += count;
  console.log(`${file}: ${count} URL(s) -> ${base}`);
}
console.log(`\nDone. ${total} replacement(s) written to ${path.relative(process.cwd(), outDir) || '.'}`);
if (!inPlace) console.log('Import the files from that folder into n8n.');
