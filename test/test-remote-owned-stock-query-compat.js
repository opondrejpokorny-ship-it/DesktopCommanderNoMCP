import assert from 'node:assert/strict';
import test from 'node:test';
import {RemoteChannel} from '../dist/remote-device/remote-channel.js';

function makeClient(handler,seen){
  return {
    from(table){
      const ops=[['from',table]];
      const q={
        update(v){ops.push(['update',v]);return q;},
        eq(k,v){ops.push(['eq',k,v]);return q;},
        gt(k,v){ops.push(['gt',k,v]);return q;},
        select(v){ops.push(['select',v]);seen.push([...ops]);return Promise.resolve(handler(ops));},
      };
      return q;
    }
  };
}
const hasEq=(ops,k,v)=>ops.some(x=>x[0]==='eq'&&x[1]===k&&x[2]===v);
const has=(ops,name)=>ops.some(x=>x[0]===name);

test('markCallExecuting keeps device and timeout filters on the authoritative claim',async()=>{
  const seen=[];
  const channel=new RemoteChannel();
  channel.deviceId='dev-1';
  channel.client=makeClient(()=>({data:[{id:'call-1'}],error:null}),seen);
  assert.equal(await channel.markCallExecuting('call-1'),true);
  assert.equal(seen.length,1);
  assert.ok(hasEq(seen[0],'device_id','dev-1'));
  assert.ok(hasEq(seen[0],'status','pending'));
  assert.ok(has(seen[0],'gt'));
});

test('all authoritative claim failures fail closed',async()=>{
  for(const error of [
    {code:'PGRST301',message:'JWT expired',status:401},
    {code:'PGRST303',message:'JWT claims validation failed'},
    {code:'42501',message:'permission denied'},
    {code:'28000',message:'invalid authorization specification'},
    {message:'forbidden',status:403},
    {code:'PGRST500',message:'Request unavailable',status:503},
    {message:'network unavailable'}
  ]){
    const seen=[];
    const channel=new RemoteChannel();
    channel.deviceId='dev-1';
    channel.client=makeClient(()=>({data:null,error}),seen);
    assert.equal(await channel.markCallExecuting('call-auth'),false);
    assert.equal(seen.length,1);
    assert.ok(hasEq(seen[0],'device_id','dev-1'));
    assert.ok(has(seen[0],'gt'));
  }
});
