import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const packageUrl = new URL('../package.json', import.meta.url);
const lockUrl = new URL('../package-lock.json', import.meta.url);
const pkg = JSON.parse(await fs.readFile(packageUrl, 'utf8'));
const lock = JSON.parse(await fs.readFile(lockUrl, 'utf8'));
const vendoredMdToPdf = JSON.parse(
  await fs.readFile(new URL('../vendor/md-to-pdf/package.json', import.meta.url), 'utf8'),
);

function version(name) {
  return lock.packages?.[`node_modules/${name}`]?.version ?? null;
}

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
  Object.hasOwn(pkg.dependencies ?? {}, 'glob'),
  false,
  'glob must not remain a direct dependency when source does not import it',
);
assert.equal(
  Object.hasOwn(pkg.dependencies ?? {}, 'md-to-pdf'),
  false,
  'vendored md-to-pdf must not be published as a file: dependency',
);
assert.equal(vendoredMdToPdf.version, '5.2.5');
assert.equal(vendoredMdToPdf.dependencies?.chokidar, '^4.0.3');
for (const dependency of Object.keys(vendoredMdToPdf.dependencies ?? {})) {
  assert.ok(
    pkg.dependencies?.[dependency],
    `root package must declare vendored md-to-pdf runtime dependency ${dependency}`,
  );
}
assert.ok(
  compareVersions(version('@opendocsg/pdf2md'), '0.2.9') >= 0,
  `@opendocsg/pdf2md must be >= 0.2.9, found ${version('@opendocsg/pdf2md')}`,
);
assert.ok(
  compareVersions(version('unpdf'), '1.8.1') >= 0,
  `unpdf must be >= 1.8.1, found ${version('unpdf')}`,
);

assert.equal(
  lock.packages?.['node_modules/@opendocsg/pdf2md/node_modules/unpdf'] ?? null,
  null,
  'pdf2md must reuse the modern root unpdf instead of nesting unpdf 0.12.x',
);

for (const legacy of ['canvas', '@mapbox/node-pre-gyp', 'tar']) {
  const entry = lock.packages?.[`node_modules/${legacy}`];
  assert.ok(
    !entry || entry.dev === true,
    `${legacy} must not remain in the production PDF dependency tree`,
  );
}

console.log('PDF_DEPENDENCY_HYGIENE_GREEN');
