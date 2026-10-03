const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const vendorRoot = path.join(repoRoot, 'vendor');

async function walk(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

async function hashFile(filePath) {
  const buffer = await fsp.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function main() {
  const manifest = JSON.parse(
    await fsp.readFile(path.join(vendorRoot, 'provenance.json'), 'utf8'),
  );
  assert.equal(manifest.schemaVersion, 1);

  const allowedVendorEntries = ['README.md', 'exceljs', 'md-to-pdf', 'provenance.json'];
  const actualVendorEntries = (await fsp.readdir(vendorRoot)).sort();
  assert.deepEqual(
    actualVendorEntries,
    allowedVendorEntries.slice().sort(),
    'vendor/ contains an unmanifested file or package',
  );
  assert.deepEqual(
    Object.keys(manifest.packages ?? {}).sort(),
    ['exceljs', 'md-to-pdf'],
    'vendor provenance must enumerate exactly the shipped package snapshots',
  );

  for (const [name, info] of Object.entries(manifest.packages ?? {})) {
    assert.match(info.integrity, /^sha512-[A-Za-z0-9+/=]+$/);
    assert.match(info.gitHead, /^[0-9a-f]{40}$/);
    assert.match(info.tarball, /^https:\/\/registry\.npmjs\.org\//);

    const root = path.join(vendorRoot, name);
    const currentFiles = await walk(root);
    const current = {};
    for (const file of currentFiles) {
      const relative = path.relative(root, file).split(path.sep).join('/');
      current[relative] = await hashFile(file);
    }

    assert.deepEqual(
      current,
      info.files,
      `vendored snapshot ${name} differs from vendor/provenance.json; regenerate only after reviewing and documenting the source change`,
    );
  }

  console.log('VENDOR_PROVENANCE_GREEN');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
