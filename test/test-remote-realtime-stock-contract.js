import assert from 'node:assert/strict';
import test from 'node:test';
import {RealtimeClient} from '@supabase/realtime-js';

test('Remote dependency speaks Realtime wire v2 expected by owned gateway',()=>{
  const client=new RealtimeClient('http://127.0.0.1:3344/realtime/v1',{
    params:{apikey:'test-public-key'}
  });
  const endpoint=new URL(client.endpointURL());
  assert.equal(endpoint.searchParams.get('vsn'),'2.0.0');
});
