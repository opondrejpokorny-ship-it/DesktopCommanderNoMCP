// Experimental adversarial edge checks; not a production access-control implementation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const quote = s => "'" + s.replace(/'/g, "''") + "'";
const digest = s => crypto.createHash('sha256').update(s).digest('hex');
const source = path.join(__dirname, 'win32-handle-authority-v2.cs');

function inspect(root, requested) {
  const program = "$ErrorActionPreference='Stop'; Add-Type -Path " + quote(source) +
    '; [Win32HandleAuthorityV2]::Observe(' + quote(root) + ',' + quote(requested) + ')';
  const r = spawnSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', program],
    {encoding:'utf8',timeout:25000,maxBuffer:256*1024});
  assert.equal(r.status,0,'probe error: '+r.stderr);
  const result=r.stdout.trim();
  assert.match(result,/^(ALLOW:[0-9a-f]{64}|DENY_[A-Z_]+)$/);
  return result;
}

test('Win32 handle POC additional edge cases', {skip:process.platform!=='win32'},async t=>{
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'rdc-handle-edge-'));
  t.after(async()=>fs.rm(tmp,{recursive:true,force:true,maxRetries:5}));
  const allowed=path.join(tmp,'allowed');
  const outside=path.join(tmp,'outside');
  await fs.mkdir(allowed); await fs.mkdir(outside);
  const file=path.join(allowed,'base.txt');
  const secret=path.join(outside,'secret.txt');
  await fs.writeFile(file,'ALLOW'); await fs.writeFile(secret,'DENY');

  await t.test('case variant of trusted root is accepted',()=>{
    assert.equal(inspect(allowed.toUpperCase(),file),'ALLOW:'+digest('ALLOW'));
  });
  await t.test('64KiB exactly accepted',async()=>{
    const candidate=path.join(allowed,'exact-size.bin');
    const payload=Buffer.alloc(65536,0x51);
    await fs.writeFile(candidate,payload);
    assert.equal(inspect(allowed,candidate),'ALLOW:'+digest(payload));
  });
  await t.test('64KiB plus one byte denied before content read',async()=>{
    const candidate=path.join(allowed,'oversize.bin');
    await fs.writeFile(candidate,Buffer.alloc(65537,0x51));
    assert.equal(inspect(allowed,candidate),'DENY_SIZE');
  });
  await t.test('file symlink to external secret is rejected',async t2=>{
    const link=path.join(allowed,'file-link.txt');
    try { await fs.symlink(secret,link,'file'); }
    catch(err){if(err.code==='EPERM'){t2.skip('Windows symlink privilege unavailable');return;}throw err;}
    assert.equal(inspect(allowed,link),'DENY_OUTSIDE');
  });
  await t.test('extended Win32 path spelling normalizes to same authorized file',()=>{
    const extended='\\\\?\\'+file;
    assert.equal(inspect(allowed,extended),'ALLOW:'+digest('ALLOW'));
  });
  await t.test('alternate data stream never exposes a secret outside normal file stream',async()=>{
    const stream=file+':restricted';
    try { await fs.writeFile(stream,'HIDDEN_STREAM'); }
    catch(err){if(err.code==='EINVAL'||err.code==='ENOTSUP'){return;}throw err;}
    const outcome=inspect(allowed,stream);
    assert.ok(!outcome.startsWith('ALLOW:'),'alternate stream must be denied: '+outcome);
  });
});
