// Disposable race-stress evidence only. No production authority; Windows/NTFS only.
// This toggles a junction between two fixture directories while reading the SAME
// already-open handle. Passing doesn't prove a complete filesystem sandbox.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const quote = text => "'" + text.replace(/'/g, "''") + "'";
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const source = path.join(__dirname, 'win32-handle-authority-v2.cs');

test('junction retarget race never returns disallowed fixture digest', {
  skip: process.platform !== 'win32',
  timeout: 30000,
}, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'rdc-handle-race-'));
  t.after(async () => fs.rm(root, { recursive: true, force: true, maxRetries: 5 }));
  const allowed = path.join(root, 'allowed');
  const nested = path.join(allowed, 'inside');
  const outside = path.join(root, 'outside');
  const junction = path.join(allowed, 'swapping');
  await fs.mkdir(nested, { recursive: true });
  await fs.mkdir(outside);
  await fs.writeFile(path.join(nested, 'sample.txt'), 'INSIDE_MARKER');
  await fs.writeFile(path.join(outside, 'sample.txt'), 'OUTSIDE_MARKER');
  await fs.symlink(nested, junction, 'junction');

  const candidate = path.join(junction, 'sample.txt');
  const ps = [
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -Path ' + quote(source),
    "Write-Output 'READY'",
    'for ($i=0; $i -lt 300; $i++) {',
    '[Win32HandleAuthorityV2]::Observe(' + quote(allowed) + ',' + quote(candidate) + ')',
    'Start-Sleep -Milliseconds 2',
    '}',
  ].join('; ');
  const child = spawn('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true });
  let result = '';
  let stderr = '';
  let ready = false;
  let finished = false;
  let flips = 0;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', text => { result += text; if (result.includes('READY')) ready = true; });
  child.stderr.on('data', text => { stderr += text; });
  const completion = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => { finished = true; resolve(code); });
  });

  // Wait for compiled helper to start, rather than spend all flips during Add-Type.
  for (let i = 0; i < 500 && !ready && !finished; i++) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(ready, true, 'PowerShell observer did not become ready: ' + stderr);

  while (!finished && flips < 400) {
    try {
      await fs.unlink(junction);
      await fs.symlink(flips % 2 ? nested : outside, junction, 'junction');
      flips++;
    } catch (error) {
      if (!['ENOENT', 'EPERM', 'EBUSY'].includes(error.code)) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 2));
  }

  const exitCode = await completion;
  assert.equal(exitCode, 0, stderr);
  assert.ok(flips >= 3, 'insufficient concurrent retargets: ' + flips);
  const lines = result.trim().split(/\r?\n/).filter(Boolean);
  assert.equal(lines.shift(), 'READY');
  assert.equal(lines.length, 300);
  const insideDigest = 'ALLOW:' + hash('INSIDE_MARKER');
  const forbiddenDigest = 'ALLOW:' + hash('OUTSIDE_MARKER');
  assert.equal(lines.includes(forbiddenDigest), false);
  for (const line of lines) {
    assert.ok(line === insideDigest || /^DENY_[A-Z_]+$/.test(line),
      'unexpected result: ' + line);
  }
  t.diagnostic('junction retargets=' + flips + '; observations=' + lines.length);
});
