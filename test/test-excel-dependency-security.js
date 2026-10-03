import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';

const pkg = JSON.parse(
  await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'),
);
const vendoredExcel = JSON.parse(
  await fs.readFile(new URL('../vendor/exceljs/package.json', import.meta.url), 'utf8'),
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

assert.equal(
  Object.hasOwn(pkg.dependencies ?? {}, 'exceljs'),
  false,
  'vendored ExcelJS must not be published as a file: dependency',
);
assert.equal(vendoredExcel.version, '4.4.0', 'ExcelJS must not be downgraded');
assert.deepEqual(vendoredExcel.dependencies ?? {}, {}, 'vendored ExcelJS must share root runtime dependencies');
assert.equal(pkg.dependencies?.archiver, '5.3.2');
assert.equal(pkg.dependencies?.['fast-csv'], '5.0.7');
assert.equal(pkg.dependencies?.unzipper, '0.12.5');
assert.equal(pkg.dependencies?.uuid, '11.1.1');
assert.equal(pkg.dependencies?.tmp, '0.2.7');

const rootRequire = createRequire(import.meta.url);
const uuidPackage = rootRequire('uuid/package.json');
const tmpPackage = rootRequire('tmp/package.json');
assert.ok(
  compareVersions(uuidPackage.version, '11.1.1') >= 0,
  `ExcelJS uuid must be >= 11.1.1, found ${uuidPackage.version}`,
);
assert.ok(
  compareVersions(tmpPackage.version, '0.2.6') >= 0,
  `ExcelJS tmp must be >= 0.2.6, found ${tmpPackage.version}`,
);

const uuid = rootRequire('uuid');
assert.equal(typeof uuid.v4, 'function', 'uuid v4 CommonJS API must remain available');

console.log('EXCEL_DEPENDENCY_SECURITY_GREEN');
