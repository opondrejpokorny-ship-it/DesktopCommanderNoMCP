#!/usr/bin/env node
import assert from 'node:assert/strict';
import { DesktopCommanderIntegration } from '../dist/remote-device/desktop-commander-integration.js';
import { MCPDevice } from '../dist/remote-device/device.js';

process.env.DESKTOP_COMMANDER_DISABLE_TELEMETRY = '1';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

class FakeAdapter {
  constructor({
    initializeError = null,
    healthReady = true,
    tools = [{ name: 'fixture_tool' }],
    callImpl = async () => ({ content: [{ type: 'text', text: 'fixture-ok' }] }),
    gate = null,
  } = {}) {
    this.initializeError = initializeError;
    this.healthReady = healthReady;
    this.tools = tools;
    this.callImpl = callImpl;
    this.gate = gate;
    this.shutdownCalls = 0;
    this.initializeCalls = 0;
  }

  async initialize() {
    this.initializeCalls++;
    if (this.gate) await this.gate.promise;
    if (this.initializeError) throw this.initializeError;
  }

  async health() {
    return this.healthReady
      ? { ready: true }
      : { ready: false, reason: 'fixture_unhealthy' };
  }

  async listTools() {
    return { tools: this.tools };
  }

  async callTool(request) {
    return this.callImpl(request);
  }

  async shutdown() {
    this.shutdownCalls++;
  }
}

class FixtureIntegration extends DesktopCommanderIntegration {
  constructor(factory) {
    super();
    this.factory = factory;
    this.creates = 0;
  }

  createAdapter() {
    this.creates++;
    return this.factory(this.creates);
  }
}

function makeFakeClient() {
  const writes = [];
  let pending = null;
  const chain = {
    update(payload) {
      writes.push(payload);
      pending = payload;
      return chain;
    },
    select() { return chain; },
    eq() {
      pending = null;
      return Promise.resolve({ data: null, error: null });
    },
  };
  return { writes, from: () => chain };
}

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ PASS  ${name}`);
  } catch (error) {
    failures++;
    console.error(`🔴 FAIL  ${name}\n     ${error?.stack || error}`);
  }
}

await test('healthy direct adapter becomes ready and exposes its tools', async () => {
  const integration = new FixtureIntegration(() => new FakeAdapter());

  await integration.initialize();

  assert.equal(integration.ready, true);
  assert.equal(integration.creates, 1);
  assert.deepEqual(await integration.listClientTools(), { tools: [{ name: 'fixture_tool' }] });

  const result = await integration.callClientTool('fixture_tool', { value: 1 }, {
    clientInfo: { name: 'remote-test', version: '1' },
  });
  assert.match(result.content?.[0]?.text ?? '', /fixture-ok/);

  await integration.shutdown();
  assert.equal(integration.ready, false);
});

await test('failed initialization never advertises ready and immediate retries are backoff-spaced', async () => {
  const integration = new FixtureIntegration(
    () => new FakeAdapter({ initializeError: new Error('fixture init failure') }),
  );

  await assert.rejects(() => integration.ensureReady(), /fixture init failure/);
  assert.equal(integration.ready, false);
  assert.equal(integration.creates, 1);

  await assert.rejects(() => integration.ensureReady(), /next attempt in/i);
  assert.equal(
    integration.creates,
    1,
    'backoff must prevent one adapter construction per routed call',
  );

  await integration.shutdown();
});

await test('concurrent ensureReady calls share one initialization', async () => {
  const gate = deferred();
  const integration = new FixtureIntegration(() => new FakeAdapter({ gate }));

  const a = integration.ensureReady();
  const b = integration.ensureReady();

  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(integration.creates, 1, 'concurrent callers must share one in-flight start');

  gate.resolve();
  await Promise.all([a, b]);

  assert.equal(integration.ready, true);
  assert.equal(integration.creates, 1);
  await integration.shutdown();
});

await test('shutdown during initialization cannot leave the integration ready', async () => {
  const gate = deferred();
  let adapter;
  const integration = new FixtureIntegration(() => {
    adapter = new FakeAdapter({ gate });
    return adapter;
  });

  const starting = integration.ensureReady().catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 20));

  const shuttingDown = integration.shutdown();
  gate.resolve();

  await Promise.all([starting, shuttingDown]);

  assert.equal(integration.ready, false);
  assert(adapter.shutdownCalls >= 1, 'the in-flight adapter must be discarded');
});

await test('a healthy remote channel cannot advertise a dead direct executor as online', async () => {
  const device = new MCPDevice();
  const client = makeFakeClient();

  device.deviceId = 'device-direct-test';
  device.remoteChannel.client = client;
  device.remoteChannel.deviceId = 'device-direct-test';
  device.remoteChannel.channel = { state: 'joined' };
  device.remoteChannel.presenceTracked = true;
  device.desktop = { ready: false };

  await device.remoteChannel.updateHeartbeat('device-direct-test');

  assert.deepEqual(
    client.writes.filter((payload) => payload.status === 'online'),
    [],
    'reachability must include direct executor readiness',
  );
});

console.log(`\n${failures ? '🔴' : '✅'} direct remote readiness: ${failures} failing test(s).`);
process.exit(failures ? 1 : 0);
