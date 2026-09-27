#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  getCurrentCallIsRemote,
  getCurrentRemoteClient,
  runWithToolCallRuntimeContext,
} from '../dist/runtime-context.js';

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

const gateA = deferred();
const gateB = deferred();

const seen = [];

const a = runWithToolCallRuntimeContext(
  { remote: true, remoteClient: { name: 'client-a', version: '1' } },
  async () => {
    seen.push(['a-before', getCurrentCallIsRemote(), getCurrentRemoteClient()?.name]);
    await gateA.promise;
    seen.push(['a-after', getCurrentCallIsRemote(), getCurrentRemoteClient()?.name]);
  },
);

const b = runWithToolCallRuntimeContext(
  { remote: true, remoteClient: { name: 'client-b', version: '2' } },
  async () => {
    seen.push(['b-before', getCurrentCallIsRemote(), getCurrentRemoteClient()?.name]);
    gateA.resolve();
    await gateB.promise;
    seen.push(['b-after', getCurrentCallIsRemote(), getCurrentRemoteClient()?.name]);
  },
);

await new Promise((resolve) => setTimeout(resolve, 10));
gateB.resolve();
await Promise.all([a, b]);

assert.deepEqual(seen, [
  ['a-before', true, 'client-a'],
  ['b-before', true, 'client-b'],
  ['a-after', true, 'client-a'],
  ['b-after', true, 'client-b'],
]);

assert.equal(getCurrentCallIsRemote(), false);
assert.equal(getCurrentRemoteClient(), null);

console.log('RUNTIME_CONTEXT_CONCURRENCY_GREEN');
