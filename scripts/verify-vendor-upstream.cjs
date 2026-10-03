const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const vendorRoot = path.join(repoRoot, 'vendor');
const manifestPath = path.join(vendorRoot, 'provenance.json');

const expectedDifferences = {
  exceljs: {
    added: ['index.js'],
    removed: ['index.ts'],
    modified: ['package.json'],
  },
  'md-to-pdf': {
    added: [],
    removed: [],
    modified: ['package.json'],
  },
};

async function fetchOk(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': 'desktop-commander-vendor-provenance-check' },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  }
  return response;
}

async function fileMap(base, dir = base, map = {}) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await fileMap(base, full, map);
    } else if (entry.isFile()) {
      const relative = path.relative(base, full).split(path.sep).join('/');
      const contents = await fsp.readFile(full);
      map[relative] = crypto.createHash('sha256').update(contents).digest('hex');
    }
  }
  return map;
}

function compareFileMaps(upstream, vendored) {
  const added = [];
  const removed = [];
  const modified = [];
  const names = new Set([...Object.keys(upstream), ...Object.keys(vendored)]);

  for (const name of [...names].sort()) {
    if (!(name in upstream)) added.push(name);
    else if (!(name in vendored)) removed.push(name);
    else if (upstream[name] !== vendored[name]) modified.push(name);
  }

  return { added, removed, modified };
}

async function main() {
  const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));

  for (const [name, info] of Object.entries(manifest.packages ?? {})) {
    const registryUrl = `https://registry.npmjs.org/${encodeURIComponent(name)}/${info.version}`;
    const metadata = await (await fetchOk(registryUrl)).json();

    assert.equal(metadata.version, info.version, `${name} registry version mismatch`);
    assert.equal(metadata.gitHead, info.gitHead, `${name} registry gitHead mismatch`);
    assert.equal(metadata.dist?.tarball, info.tarball, `${name} registry tarball URL mismatch`);
    assert.equal(metadata.dist?.integrity, info.integrity, `${name} registry integrity mismatch`);

    const tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dc-vendor-upstream-'));
    try {
      const tarballPath = path.join(tempDir, 'package.tgz');
      const tarball = Buffer.from(await (await fetchOk(info.tarball)).arrayBuffer());
      const actualIntegrity = `sha512-${crypto.createHash('sha512').update(tarball).digest('base64')}`;
      assert.equal(actualIntegrity, info.integrity, `${name} downloaded tarball integrity mismatch`);
      await fsp.writeFile(tarballPath, tarball);

      const extractDir = path.join(tempDir, 'extract');
      await fsp.mkdir(extractDir);
      const extract = spawnSync('tar', ['-xzf', tarballPath, '-C', extractDir], {
        encoding: 'utf8',
        shell: false,
      });
      if (extract.status !== 0) {
        throw new Error(`Failed to extract ${name} upstream tarball: ${extract.stderr || extract.error || 'unknown error'}`);
      }

      const upstream = await fileMap(path.join(extractDir, 'package'));
      const vendored = await fileMap(path.join(vendorRoot, name));
      const differences = compareFileMaps(upstream, vendored);
      assert.deepEqual(
        differences,
        expectedDifferences[name],
        `${name} vendor differs from official npm tarball outside the reviewed allowlist`,
      );
    } finally {
      await fsp.rm(tempDir, { recursive: true, force: true });
    }
  }

  console.log('VENDOR_UPSTREAM_GREEN');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
