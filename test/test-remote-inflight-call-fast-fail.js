#!/usr/bin/env node
import assert from 'node:assert/strict';
import { DesktopCommanderIntegration } from '../dist/remote-device/desktop-commander-integration.js';

process.env.DESKTOP_COMMANDER_DISABLE_TELEMETRY = '1';

class FakeAdapter {
  constructor({ healthReady = true, callImpl } = {}) {
    this.healthReady = healthReady;
    this.callImpl = callImpl ?? (async () => ({
      content: [{ type: 'text', text: 'fixture-ok' }],
    }));
    this.shutdownCalls = 0;
  }

  async initialize() {}
  async health() {
    return this.healthReady
      ? { ready: true }
      : { ready: false, reason: 'fixture_unhealthy' };
  }
  async listTools() {
    return { tools: [{ name: 'fixture_tool' }] };
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

await test('an in-flight direct execution failure rejects fast and reports executor loss', async () => {
  const disconnects = [];
  const integration = new FixtureIntegration((createNo) => {
    if (createNo === 1) {
      const adapter = new FakeAdapter({ healthReady: true });
      adapter.callImpl = async () => {
        adapter.healthReady = false;
        throw new Error('fixture direct execution crashed');
      };
      return adapter;
    }
    return new FakeAdapter();
  });

  integration.onDisconnect((reason) => disconnects.push(reason));
  await integration.initialize();

  const started = Date.now();
  await assert.rejects(
    () => integration.callClientTool('fixture_tool', {}),
    /fixture direct execution crashed/,
  );
  const elapsed = Date.now() - started;

  assert(
    elapsed < 2_000,
    `direct failure took ${elapsed}ms; no transport timeout should exist in direct mode`,
  );
  assert.equal(integration.ready, false);
  assert.equal(disconnects.length, 1, 'unhealthy adapter must notify the device exactly once');

  const result = await integration.callClientTool('fixture_tool', {});
  assert.match(result.content?.[0]?.text ?? '', /fixture-ok/);
  assert.equal(integration.creates, 2, 'next call should rebuild the direct adapter once');
  assert.equal(integration.ready, true);

  await integration.shutdown();
});

await test('tool-level isError result is not mistaken for executor death', async () => {
  const disconnects = [];
  const integration = new FixtureIntegration(() => new FakeAdapter({
    healthReady: true,
    callImpl: async () => ({
      content: [{ type: 'text', text: 'fixture validation error' }],
      isError: true,
    }),
  }));

  integration.onDisconnect((reason) => disconnects.push(reason));
  await integration.initialize();

  const result = await integration.callClientTool('fixture_tool', {});
  assert.equal(result.isError, true);
  assert.equal(integration.ready, true);
  assert.deepEqual(disconnects, []);

  await integration.shutdown();
});

await test('remote metadata reaches the direct adapter without an MCP serialization hop', async () => {
  let captured;
  const integration = new FixtureIntegration(() => new FakeAdapter({
    callImpl: async (request) => {
      captured = request;
      return { content: [{ type: 'text', text: 'ok' }] };
    },
  }));

  await integration.initialize();
  await integration.callClientTool(
    'fixture_tool',
    { alpha: 1 },
    { clientInfo: { name: 'remote-client-a', version: '7' }, trace: 'opaque' },
  );

  assert.equal(captured.name, 'fixture_tool');
  assert.deepEqual(captured.arguments, { alpha: 1 });
  assert.equal(captured.metadata.remote, true);
  assert.deepEqual(captured.metadata.clientInfo, { name: 'remote-client-a', version: '7' });
  assert.equal(captured.metadata.trace, 'opaque');

  await integration.shutdown();
});

console.log(`\n${failures ? '🔴' : '✅'} direct remote fast-fail: ${failures} failing test(s).`);
process.exit(failures ? 1 : 0);
