// Experimental root-identity regression tests. NOT A SECURITY BOUNDARY.
// Demonstrates pathname replacement and a stable-state root-ID mitigation;
// this does NOT prove safety under concurrent root/ancestor rename races.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const source = path.join(__dirname, 'win32-handle-authority-v2.cs');
const psQuote = value => "'" + value.replace(/'/g, "''") + "'";
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

function callNative(method, values) {
  const expr = '[Win32HandleAuthorityV2]::' + method + '(' +
    values.map(psQuote).join(',') + ')';
  const program = ["$ErrorActionPreference='Stop'", 'Add-Type -Path ' + psQuote(source), expr].join('; ');
  const child = spawnSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command',program],
    { encoding:'utf8', timeout:30000, maxBuffer:256*1024 });
  assert.equal(child.error, undefined, String(child.error));
  assert.equal(child.status, 0, 'Native method unavailable or failed: ' + child.stderr);
  return child.stdout.trim();
}

test('root directory identity must outlive the authorized pathname', {
  skip: process.platform !== 'win32',
}, async t => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'rdc-root-binding-v2-'));
  t.after(async () => fs.rm(parent, {recursive:true, force:true, maxRetries:4}));
  const root = path.join(parent, 'permitted');
  const oldRoot = path.join(parent, 'moved-permitted');
  await fs.mkdir(root);
  const document = path.join(root, 'file.txt');
  await fs.writeFile(document, 'AUTHORIZED_ORIGINAL');

  // The identity MUST be captured from the root at initial authorization time,
  // before an attacker replaces the pathname. Caller responsibility is explicit.
  const trustedRootId = callNative('CaptureRootIdentity', [root]);
  assert.match(trustedRootId, /^ROOT:[A-F0-9]{8}-[A-F0-9]{8}-[A-F0-9]{8}-[a-f0-9]{64}$/);
  await t.test('ordinary authorized file accepted by bound observer', () => {
    assert.equal(callNative('ObserveBound', [root, document, trustedRootId]),
      'ALLOW:' + sha('AUTHORIZED_ORIGINAL'));
  });
  await t.test('forged root identity rejected', () => {
    assert.equal(callNative('ObserveBound', [root, document,
      'ROOT:00000000-00000000-00000000']), 'DENY_ROOT_IDENTITY');
  });

  // The OLD authorized directory retains its identity; a NEW directory takes
  // over the exact same pathname with entirely new contents.
  await fs.rename(root, oldRoot);
  await fs.mkdir(root);
  await fs.writeFile(document, 'UNAUTHORIZED_REPLACEMENT');

  await t.test('baseline pathname-only observer exhibits root-swap vulnerability', () => {
    assert.equal(callNative('Observe', [root, document]),
      'ALLOW:' + sha('UNAUTHORIZED_REPLACEMENT'));
  });
  await t.test('bound observer rejects replacement root before reading bytes', () => {
    assert.equal(callNative('ObserveBound', [root, document, trustedRootId]),
      'DENY_ROOT_IDENTITY');
  });
  await t.test('renamed original root no longer matches trusted pathname', () => {
    assert.equal(callNative('ObserveBound',
      [oldRoot, path.join(oldRoot,'file.txt'),trustedRootId]), 'DENY_ROOT_PATH');
  });
  await t.test('junction used as the trusted root is refused', async () => {
    const rootJunction = path.join(parent, 'root-junction');
    await fs.symlink(oldRoot, rootJunction, 'junction');
    assert.equal(callNative('CaptureRootIdentity', [rootJunction]), 'DENY_ROOT_PATH');
  });
  await t.test('deterministic interleaving defeats separate pre/post root checks', async () => {
    // This is a sequential schedule, NOT a claim that ObserveBound was exploited
    // by a live race. It proves why checking root IDs around a separate pathname
    // open is not an atomic authorization boundary.
    const raceRoot = path.join(parent, 'interleave-root');
    const movedRoot = path.join(parent, 'interleave-original');
    const swappedRoot = path.join(parent, 'interleave-attacker');
    await fs.mkdir(raceRoot);
    const candidate = path.join(raceRoot, 'file.txt');
    await fs.writeFile(candidate, 'BEFORE');
    const authorizedId = callNative('CaptureRootIdentity', [raceRoot]);
    assert.equal(callNative('CaptureRootIdentity', [raceRoot]), authorizedId);
    await fs.rename(raceRoot, movedRoot);
    await fs.mkdir(raceRoot);
    await fs.writeFile(candidate, 'OUTSIDE_AUTHORIZED_ROOT_IDENTITY');
    const insecureResult = callNative('Observe', [raceRoot, candidate]);
    await fs.rename(raceRoot, swappedRoot);
    await fs.rename(movedRoot, raceRoot);
    assert.equal(callNative('CaptureRootIdentity', [raceRoot]), authorizedId);
    assert.equal(insecureResult,
      'ALLOW:' + sha('OUTSIDE_AUTHORIZED_ROOT_IDENTITY'));
  });
});
