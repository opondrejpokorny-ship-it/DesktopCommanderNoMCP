import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));

assert.ok(pkg.files?.includes('vendor'), 'vendor directory must be included in npm package files');

for (const section of ['dependencies', 'optionalDependencies']) {
  for (const [name, spec] of Object.entries(pkg[section] ?? {})) {
    const value = String(spec);
    assert.equal(
      value.startsWith('file:'),
      false,
      `published ${section} entry ${name} must not use a local file: specifier`,
    );
    assert.match(
      value,
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/,
      `published ${section} entry ${name} must be exactly pinned, found ${value}`,
    );
  }
}

assert.equal(Object.hasOwn(pkg.dependencies ?? {}, 'exceljs'), false);
assert.equal(Object.hasOwn(pkg.dependencies ?? {}, 'md-to-pdf'), false);

const pinnedRuntimeDependencies = {
  '@modelcontextprotocol/sdk': '1.32.0',
  '@opendocsg/pdf2md': '0.2.9',
  '@tiptap/core': '3.30.5',
  '@tiptap/extension-image': '3.30.5',
  '@tiptap/extension-table': '3.30.5',
  '@tiptap/extension-table-cell': '3.30.5',
  '@tiptap/extension-table-header': '3.30.5',
  '@tiptap/extension-table-row': '3.30.5',
  '@tiptap/pm': '3.30.5',
  '@tiptap/starter-kit': '3.30.5',
  'archiver': '5.3.2',
  'arg': '5.0.2',
  'chalk': '4.1.2',
  'chokidar': '4.0.3',
  'dayjs': '1.11.23',
  'fast-csv': '5.0.7',
  'file-type': '21.3.4',
  'get-port': '5.1.1',
  'get-stdin': '8.0.0',
  'gray-matter': '4.0.3',
  'iconv-lite': '0.6.3',
  'jszip': '3.10.2',
  'listr': '0.14.3',
  'markdown-it': '14.3.2',
  'marked': '4.3.0',
  'puppeteer': '25.12.0',
  'readable-stream': '3.6.2',
  'saxes': '5.0.1',
  'semver': '7.8.5',
  'serve-handler': '6.1.7',
  'sharp': '0.35.5',
  'tmp': '0.2.7',
  'unpdf': '1.8.1',
  'unzipper': '0.12.5',
  'uuid': '11.1.1',
};

assert.equal(pkg.engines?.node, '>=22.12.0', 'published package engine floor must match hardened Puppeteer/unpdf requirements');

for (const [name, expected] of Object.entries(pinnedRuntimeDependencies)) {
  assert.equal(
    pkg.dependencies?.[name],
    expected,
    `hardened runtime dependency ${name} must stay exactly pinned to ${expected}`,
  );
}

for (const licensePath of [
  new URL('../vendor/exceljs/LICENSE', import.meta.url),
  new URL('../vendor/md-to-pdf/license', import.meta.url),
]) {
  const license = await fs.readFile(licensePath, 'utf8');
  assert.ok(license.trim().length > 100, `vendor license missing or unexpectedly short: ${licensePath.pathname}`);
}

console.log('PACKAGE_PUBLISH_SAFETY_GREEN');
