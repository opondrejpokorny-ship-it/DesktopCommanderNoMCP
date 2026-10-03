import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const lock = JSON.parse(
  await fs.readFile(new URL('../package-lock.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(
  await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'),
);

function productionEntries(name) {
  const suffix = `/node_modules/${name}`;
  return Object.entries(lock.packages ?? {})
    .filter(([key, value]) =>
      value?.dev !== true &&
      (key === `node_modules/${name}` || key.endsWith(suffix)))
    .map(([key, value]) => ({ key, version: value.version }));
}

for (const forbidden of ['lodash.isequal', 'fstream', 'rimraf']) {
  assert.deepEqual(
    productionEntries(forbidden),
    [],
    `${forbidden} must not remain in the production dependency tree`,
  );
}

// ExcelJS 4.4.0 streaming is incompatible with archiver >=6 in our verified
// Windows/Node 24 path. Keep this one bounded compatibility exception until
// upstream ExcelJS can move without breaking streaming read/write behavior.
assert.equal(pkg.dependencies?.archiver, '5.3.2');
assert.deepEqual(
  productionEntries('glob'),
  [{ key: 'node_modules/glob', version: '7.2.3' }],
  'only the bounded archiver@5 glob@7 compatibility exception may remain',
);
assert.deepEqual(
  productionEntries('inflight'),
  [{ key: 'node_modules/inflight', version: '1.0.6' }],
  'only the bounded glob@7 inflight compatibility exception may remain',
);

console.log('PRODUCTION_DEPENDENCY_DEPRECATIONS_BOUNDED');
