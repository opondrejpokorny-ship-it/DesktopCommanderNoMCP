import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const lockUrl = new URL('../package-lock.json', import.meta.url);
const lock = JSON.parse(await fs.readFile(lockUrl, 'utf8'));

function installedVersion(name) {
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

function requireFloor(name, floor) {
  const actual = installedVersion(name);
  assert.ok(actual, `${name} must be installed`);
  assert.ok(
    compareVersions(actual, floor) >= 0,
    `${name} must be >= ${floor}, found ${actual}`,
  );
}
const safeFloors = {
  '@modelcontextprotocol/sdk': '1.26.0',
  '@tiptap/core': '3.30.5',
  '@tiptap/extension-image': '3.30.5',
  '@tiptap/extension-table': '3.30.5',
  '@tiptap/extension-table-cell': '3.30.5',
  '@tiptap/extension-table-header': '3.30.5',
  '@tiptap/extension-table-row': '3.30.5',
  '@tiptap/pm': '3.30.5',
  '@tiptap/starter-kit': '3.30.5',
  'sharp': '0.35.5',
  'file-type': '21.3.4',
  'markdown-it': '14.3.2',
  'puppeteer': '25.12.0',
  '@puppeteer/browsers': '3.0.0',
  'serve-handler': '6.1.7',
  'chokidar': '4.0.3',
  'picomatch': '2.3.2',
};

for (const [name, floor] of Object.entries(safeFloors)) {
  requireFloor(name, floor);
}

const bracesEntry = lock.packages?.['node_modules/braces'];
assert.ok(
  !bracesEntry || bracesEntry.dev === true,
  `vulnerable braces 3.x must not be in the production tree, found ${bracesEntry?.version}`,
);

const basicFtp = installedVersion('basic-ftp');
assert.ok(
  basicFtp === null || compareVersions(basicFtp, '6.2.1') >= 0,
  `basic-ftp must be absent or >= 6.2.1, found ${basicFtp}`,
);

console.log('RUNTIME_DEPENDENCY_SECURITY_GREEN');
