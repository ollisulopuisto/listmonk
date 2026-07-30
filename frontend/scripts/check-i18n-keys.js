#!/usr/bin/env node
/**
 * Fails if a translation key referenced in frontend/src is missing from
 * i18n/en.json. en.json is the fallback locale, so a key absent there renders
 * the raw key string ("campaigns.sourceCode") in the UI rather than any text.
 *
 * Only en.json is checked: other locales legitimately fall back to it.
 *
 * Usage: node scripts/check-i18n-keys.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const EN = path.join(__dirname, '..', '..', 'i18n', 'en.json');

// $t('key') / $tc('key') / this.$t("key") — static string literals only.
const KEY_RE = /\$tc?\(\s*['"]([a-zA-Z0-9_.-]+)['"]/g;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (/\.(vue|js)$/.test(entry.name)) out.push(p);
  }
  return out;
}

// This reads i18n/en.json from the repo root, so it only works in a full
// checkout. It is deliberately wired into `yarn lint` and not `prebuild`: the
// Docker builder stage copies only frontend/ and static/, so running it during
// `yarn build` breaks the image build.
if (!fs.existsSync(EN)) {
  console.error(`i18n: cannot find ${EN}.`);
  console.error('This check needs a full repo checkout (it reads i18n/en.json at the repo root).');
  process.exit(1);
}

const en = JSON.parse(fs.readFileSync(EN, 'utf8'));
const missing = new Map();

for (const file of walk(SRC)) {
  const body = fs.readFileSync(file, 'utf8');
  for (const m of body.matchAll(KEY_RE)) {
    const key = m[1];
    if (!(key in en)) {
      if (!missing.has(key)) missing.set(key, new Set());
      missing.get(key).add(path.relative(path.join(__dirname, '..'), file));
    }
  }
}

if (missing.size === 0) {
  console.log('i18n: all referenced keys exist in en.json');
  process.exit(0);
}

console.error(`i18n: ${missing.size} key(s) referenced in src but missing from i18n/en.json:\n`);
for (const [key, files] of [...missing].sort()) {
  console.error(`  ${key}`);
  for (const f of files) console.error(`      ${f}`);
}
console.error('\nAdd them to i18n/en.json (other locales fall back to it).');
process.exit(1);
