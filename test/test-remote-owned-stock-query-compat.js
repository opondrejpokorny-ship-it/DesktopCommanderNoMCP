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
        select(v){ops.push(['select',v]);return q;},
        maybeSingle(){ops.push(['maybeSingle']);seen.push([...ops]);return Promise.resolve(handler(ops));},
        then(resolve,reject){seen.push([...ops]);return Promise.resolve(handler(ops)).then(resolve,reject);},
      };
      return q;
    }
  };
}
const has=(ops,name)=>ops.some(x=>x[0]===name);
const hasEq=(ops,k,v)=>ops.some(x=>x[0]==='eq'&&x[1]===k&&x[2]===v);

test('doorbell retries exact stock claim shape for owned stock adapter',async()=>{
  const seen=[]; const delivered=[];
  const channel=new RemoteChannel();
  channel.deviceId='dev-1';
  channel.onToolCall=p=>delivered.push(p);
  channel.client=makeClient(ops=>{
    if(has(ops,'update')&&has(ops,'gt')) return {data:null,error:{code:'PGRST100',message:'Invalid request'}};
    if(has(ops,'update')) return {data:[{id:'call-1',device_id:'dev-1',status:'executing'}],error:null};
    return {data:null,error:null};
  },seen);
  await channel.onDoorbell({call_id:'call-1',device_id:'dev-1'});
  const stock=seen.find(ops=>has(ops,'update')&&!has(ops,'gt'));
  assert.ok(stock,'expected stock-shaped fallback update');
  assert.ok(hasEq(stock,'device_id','dev-1'));
  assert.ok(hasEq(stock,'status','pending'));
  assert.equal(delivered.length,1);
  assert.equal(delivered[0].claimed,true);
});

test('expired call is not dispatched when server-authoritative stock claim returns no row',async()=>{
  const seen=[]; const delivered=[];
  const channel=new RemoteChannel();
  channel.deviceId='dev-1';
  channel.onToolCall=p=>delivered.push(p);
  channel.client=makeClient(ops=>{
    if(has(ops,'update')&&has(ops,'gt')) return {data:null,error:{code:'PGRST100',message:'Invalid request'}};
    if(has(ops,'update')) return {data:[],error:null};
    return {data:null,error:null};
  },seen);
  await channel.onDoorbell({call_id:'expired-call',device_id:'dev-1'});
  assert.equal(delivered.length,0);
  assert.ok(seen.some(ops=>has(ops,'update')&&!has(ops,'gt')));
});

test('markCallExecuting falls back only for exact shape incompatibility',async()=>{
  const seen=[]; const channel=new RemoteChannel();
  channel.client=makeClient(ops=>has(ops,'gt')
    ? {data:null,error:{code:'PGRST100',message:'Invalid request'}}
    : {data:[{id:'call-2'}],error:null},seen);
  assert.equal(await channel.markCallExecuting('call-2'),true);
  assert.ok(seen.some(ops=>has(ops,'update')&&!has(ops,'gt')));
});

test('auth errors never trigger stock-shape fallback',async()=>{
  const seen=[]; const channel=new RemoteChannel();
  channel.client=makeClient(()=>({data:null,error:{code:'PGRST301',message:'JWT expired'}}),seen);
  assert.equal(await channel.markCallExecuting('call-3'),true);
  assert.equal(seen.some(ops=>has(ops,'update')&&!has(ops,'gt')),false);
});
