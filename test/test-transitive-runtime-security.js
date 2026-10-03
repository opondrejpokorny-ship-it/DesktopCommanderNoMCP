import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const lock = JSON.parse(
  await fs.readFile(new URL('../package-lock.json', import.meta.url), 'utf8'),
);

function compareVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const delta = (a[i] ?? 0) - (b[i] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function productionEntries(name) {
  const suffix = `/node_modules/${name}`;
  return Object.entries(lock.packages ?? {})
    .filter(([key, value]) =>
      value?.dev !== true &&
      (key === `node_modules/${name}` || key.endsWith(suffix)))
    .map(([key, value]) => ({ key, version: value.version }));
}

function requireAll(name, predicate, message) {
  for (const entry of productionEntries(name)) {
    assert.ok(predicate(entry.version), `${message}: ${entry.key}=${entry.version}`);
  }
}
requireAll('ajv', v => compareVersions(v, '8.18.0') >= 0, 'ajv must be patched');
requireAll('fast-uri', v => {
  const major = Number(v.split('.')[0]);
  return major >= 4 || compareVersions(v, '3.1.8') >= 0;
}, 'fast-uri must be patched');
requireAll('js-yaml', v => {
  const major = Number(v.split('.')[0]);
  if (major === 3) return compareVersions(v, '3.15.2') >= 0;
  if (major === 4) return compareVersions(v, '4.3.2') >= 0;
  return major >= 5;
}, 'js-yaml must be patched');
requireAll('path-to-regexp', v => {
  const major = Number(v.split('.')[0]);
  return major !== 8 || compareVersions(v, '8.3.1') >= 0;
}, 'path-to-regexp 8.x must be patched');
requireAll('minimatch', v => {
  const major = Number(v.split('.')[0]);
  if (major === 3) return compareVersions(v, '3.1.4') >= 0;
  if (major === 5) return compareVersions(v, '5.1.8') >= 0;
  if (major === 9) return compareVersions(v, '9.0.7') >= 0;
  return true;
}, 'minimatch must be patched');
requireAll('brace-expansion', v => {
  const major = Number(v.split('.')[0]);
  if (major === 1) return compareVersions(v, '1.1.21') >= 0;
  if (major === 2) return compareVersions(v, '2.1.7') >= 0;
  return true;
}, 'brace-expansion must be patched');

console.log('TRANSITIVE_RUNTIME_SECURITY_GREEN');
