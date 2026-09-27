import assert from 'node:assert/strict';
import test from 'node:test';
import {sanitizeChildProcessError} from '../dist/remote-device/remote-channel.js';

test('child-process error logging never exposes spawn arguments or credentials',()=>{
  const err=new Error('spawnSync node ETIMEDOUT');
  Object.assign(err,{
    code:'ETIMEDOUT',
    errno:-4039,
    syscall:'spawnSync node',
    path:'node',
    spawnargs:['helper.js','device-id','https://example.invalid','public-key','access-secret','refresh-secret'],
  });
  const safe=sanitizeChildProcessError(err);
  const serialized=JSON.stringify(safe);
  assert.equal(safe.code,'ETIMEDOUT');
  assert.match(safe.message,/ETIMEDOUT/);
  assert.doesNotMatch(serialized,/access-secret|refresh-secret|public-key|spawnargs|helper\.js/);
});
