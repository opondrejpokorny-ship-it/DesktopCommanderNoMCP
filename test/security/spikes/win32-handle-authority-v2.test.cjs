// Independent disposable Windows native-handle experiment. NOT part of the NoMCP test suite.
// Run explicitly: node --test test/security/spikes/win32-handle-authority-v2.test.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const source = path.join(__dirname, 'win32-handle-authority-v2.cs');
const quotePs = value => "'" + value.replace(/'/g, "''") + "'";
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

function probe(allowedRoot, candidate) {
  const ps = [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -Path ' + quotePs(source),
    '[Win32HandleAuthorityV2]::Observe(' +
      quotePs(allowedRoot) + ', ' + quotePs(candidate) + ')',
  ].join('; ');
  const result = spawnSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', ps],
    { encoding: 'utf8', timeout: 30000, maxBuffer: 256 * 1024 });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, 'PowerShell/.NET probe failed: ' + result.stderr);
  const response = result.stdout.trim();
  assert.match(response, /^(ALLOW:[0-9a-f]{64}|DENY_[A-Z_]+)$/);
  return response;
}

test('opened Win32 file handle confines content reads in disposable fixtures', {
  skip: process.platform !== 'win32',
}, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rdc-win32-handle-v2-'));
  const allowed = path.join(root, 'allowed');
  const outside = path.join(root, 'outside');
  const prefixSibling = path.join(root, 'allowed-evil');
  await fs.mkdir(allowed);
  await fs.mkdir(outside);
  await fs.mkdir(prefixSibling);
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true, maxRetries: 4 });
  });

  const insideFile = path.join(allowed, 'inside.txt');
  const outsideFile = path.join(outside, 'secret.txt');
  const siblingFile = path.join(prefixSibling, 'sibling.txt');
  await fs.writeFile(insideFile, 'EXPECTED_INSIDE');
  await fs.writeFile(outsideFile, 'FORBIDDEN_OUTSIDE');
  await fs.writeFile(siblingFile, 'FORBIDDEN_SIBLING');
  const forbiddenDigest = sha('FORBIDDEN_OUTSIDE');

  await t.test('valid allowed file: read only through verified handle', () => {
    assert.equal(probe(allowed, insideFile), 'ALLOW:' + sha('EXPECTED_INSIDE'));
  });
  await t.test('disallowed path cannot return outside bytes', () => {
    const value = probe(allowed, outsideFile);
    assert.equal(value, 'DENY_OUTSIDE');
    assert.equal(value.includes(forbiddenDigest), false);
  });
  await t.test('sibling-prefix collision rejected', () => {
    assert.equal(probe(allowed, siblingFile), 'DENY_OUTSIDE');
  });
  await t.test('nonexistent file fails closed', () => {
    assert.equal(probe(allowed, path.join(allowed, 'missing.txt')), 'DENY_OPEN');
  });
  await t.test('directory junction pointing to disallowed content rejected', async () => {
    const junction = path.join(allowed, 'junction');
    await fs.symlink(outside, junction, 'junction');
    assert.equal(probe(allowed, path.join(junction, 'secret.txt')), 'DENY_OUTSIDE');
  });
  await t.test('NTFS hardlink to disallowed content rejected', async () => {
    const alias = path.join(allowed, 'hardlink.txt');
    await fs.link(outsideFile, alias);
    assert.equal(probe(allowed, alias), 'DENY_HARDLINK');
  });
  await t.test('allowed nested ordinary file works', async () => {
    const nested = path.join(allowed, 'nested');
    await fs.mkdir(nested);
    const candidate = path.join(nested, 'note.txt');
    await fs.writeFile(candidate, 'NESTED_ALLOWED');
    assert.equal(probe(allowed, candidate), 'ALLOW:' + sha('NESTED_ALLOWED'));
  });
});
