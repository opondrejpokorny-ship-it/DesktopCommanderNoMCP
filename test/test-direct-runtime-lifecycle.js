#!/usr/bin/env node
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.DESKTOP_COMMANDER_DISABLE_TELEMETRY = '1';
process.env.DC_FLAG_URL = 'http://127.0.0.1:9/flags';
const testHome = await fs.mkdtemp(path.join(os.tmpdir(), 'dc-direct-lifecycle-'));
process.env.USERPROFILE = testHome;
process.env.HOME = testHome;

const { configManager } = await import('../dist/config-manager.js');
const { featureFlagManager } = await import('../dist/utils/feature-flags.js');
const { searchManager } = await import('../dist/search-manager.js');
const { terminalManager } = await import('../dist/terminal-manager.js');
const { toolHistory } = await import('../dist/utils/toolHistory.js');
const { StockDesktopCommanderAdapter } =
  await import('../dist/stock-desktop-commander-adapter.js');
const { DesktopCommanderIntegration } =
  await import('../dist/remote-device/desktop-commander-integration.js');

const testConfigDir = path.join(testHome, '.claude-server-commander');
await fs.mkdir(testConfigDir, { recursive: true });
configManager.configPath = path.join(testConfigDir, 'config.json');
configManager.config = {};
configManager.initialized = false;
featureFlagManager.cachePath = path.join(testConfigDir, 'feature-flags.json');
toolHistory.historyFile = path.join(testConfigDir, 'tool-history.jsonl');
toolHistory.history = [];
toolHistory.writeQueue = [];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
class FakeChild extends EventEmitter {
  constructor(pid) {
    super();
    this.pid = pid;
    this.killed = false;
    this.exitCode = null;
    this.kills = [];
  }

  kill(signal = 'SIGTERM') {
    this.kills.push(signal);
    this.killed = true;
    queueMicrotask(() => {
      this.exitCode = 0;
      this.emit('exit', 0);
      this.emit('close', 0);
    });
    return true;
  }
}

class FakeAdapter {
  async initialize() {}
  async health() { return { ready: true }; }
  async listTools() { return { tools: [{ name: 'fixture_tool' }] }; }
  async callTool() { return { content: [{ type: 'text', text: 'ok' }] }; }
  async shutdown() {}
}

class FixtureIntegration extends DesktopCommanderIntegration {
  createAdapter() { return new FakeAdapter(); }
}

class LateResourceAdapter extends FakeAdapter {
  constructor() {
    super();
    this.activeCall = null;
    this.release = null;
    this.entered = false;
  }

  async callTool() {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    this.release = release;
    this.entered = true;
    this.activeCall = (async () => {
      await gate;
      return terminalManager.executeCommand('echo late-resource', 100, 'cmd.exe');
    })();
    return this.activeCall;
  }

  async shutdown() {
    if (this.activeCall) await this.activeCall.catch(() => {});
  }
}

class LateResourceIntegration extends DesktopCommanderIntegration {
  constructor(adapter) {
    super();
    this.fixtureAdapter = adapter;
  }
  createAdapter() { return this.fixtureAdapter; }
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

await test('direct adapter shutdown waits for an in-flight stock call', async () => {
  const adapter = new StockDesktopCommanderAdapter();
  await adapter.initialize({ remote: true });

  const originalGetConfig = configManager.getConfig.bind(configManager);
  let entered = false;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  configManager.getConfig = async () => {
    entered = true;
    await gate;
    return originalGetConfig();
  };
  try {
    const call = adapter.callTool({ name: 'get_config', arguments: {} });
    while (!entered) await delay(5);

    let shutdownSettled = false;
    const shutdown = adapter.shutdown().then(() => { shutdownSettled = true; });
    await delay(30);
    assert.equal(shutdownSettled, false, 'shutdown must wait for the active call');

    release();
    await Promise.all([call, shutdown]);
  } finally {
    release?.();
    configManager.getConfig = originalGetConfig;
  }
});

await test('process-wide managers dispose active search and terminal children', async () => {
  assert.equal(typeof searchManager.shutdown, 'function');
  assert.equal(typeof terminalManager.shutdown, 'function');

  const searchChild = new FakeChild(91001);
  searchManager.sessions.set('fixture-search', {
    id: 'fixture-search',
    process: searchChild,
    results: [],
    isComplete: false,
    isError: false,
    startTime: Date.now(),
    lastReadTime: Date.now(),
    options: { rootPath: testHome, pattern: 'x', searchType: 'content' },
    buffer: '',
    totalMatches: 0,
    totalContextLines: 0,
  });

  const terminalChild = new FakeChild(91002);
  terminalManager.sessions.set(91002, {
    pid: 91002,
    process: terminalChild,
    outputLines: [],
    lastReadIndex: 0,
    isBlocked: false,
    startTime: new Date(),
    bufferedChars: 0,
    evictedLines: 0,
    evictedChars: 0,
  });

  await Promise.all([searchManager.shutdown(), terminalManager.shutdown()]);
  assert(searchChild.kills.length > 0, 'search child must be terminated');
  assert(terminalChild.kills.length > 0, 'terminal child must be terminated');
  assert.equal(searchManager.getActiveSessionCount(), 0);
  assert.equal(terminalManager.listActiveSessions().length, 0);
});
await test('runtime shutdown prevents an in-flight call from creating a late child', async () => {
  terminalManager.initialize?.();
  searchManager.initialize?.();
  const adapter = new LateResourceAdapter();
  const integration = new LateResourceIntegration(adapter);
  await integration.initialize();

  const call = integration.callClientTool('fixture_tool', {});
  while (!adapter.entered) await delay(5);

  const shutdown = integration.shutdown();
  await delay(30);
  adapter.release();

  const result = await call;
  await shutdown;
  assert.equal(result?.pid, -1, 'late terminal creation must be rejected during shutdown');
  assert.equal(terminalManager.listActiveSessions().length, 0);
});

await test('shut down managers reject new terminal and search work until reinitialized', async () => {
  await Promise.all([terminalManager.shutdown(), searchManager.shutdown()]);
  const terminalResult = await terminalManager.executeCommand('echo denied', 100, 'cmd.exe');
  assert.equal(terminalResult.pid, -1);
  await assert.rejects(
    () => searchManager.startSearch({ rootPath: testHome, pattern: 'x', searchType: 'content' }),
    /shutting down/i,
  );

  terminalManager.initialize?.();
  searchManager.initialize?.();
});

await test('config shutdown drains an in-flight nonblocking mutation', async () => {
  await configManager.getConfig();
  const originalMutation = configManager.performConfigMutation.bind(configManager);
  let entered = false;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });

  configManager.performConfigMutation = async (...args) => {
    entered = true;
    await gate;
    return originalMutation(...args);
  };

  try {
    await configManager.setValueNonBlocking('__directLifecycleDrain', Date.now());
    while (!entered) await delay(5);

    let shutdownSettled = false;
    const shutdown = Promise.resolve(configManager.shutdown())
      .then(() => { shutdownSettled = true; });
    await delay(30);
    assert.equal(shutdownSettled, false, 'config shutdown must drain queued writes');

    release();
    await shutdown;
  } finally {
    release?.();
    configManager.performConfigMutation = originalMutation;
  }
});
await test('feature flags create a fresh readiness promise on reinitialize', async () => {
  await featureFlagManager.initialize();
  const first = featureFlagManager.freshFetchPromise;
  featureFlagManager.destroy();

  await featureFlagManager.initialize();
  const second = featureFlagManager.freshFetchPromise;
  assert.notEqual(second, first, 'reinitialize must wait on a new fresh fetch');
  featureFlagManager.destroy();
});

await test('old feature-flag fetch cannot resolve the next generation readiness', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  let resolveSecond;
  globalThis.fetch = (_url, options = {}) => {
    fetchCount++;
    if (fetchCount === 1) {
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => {
          setTimeout(() => reject(new Error('old generation aborted')), 25);
        }, { once: true });
      });
    }
    return new Promise((resolve) => {
      resolveSecond = () => resolve({
        ok: true,
        json: async () => ({ flags: { generation: 2 } }),
      });
    });
  };

  try {
    await featureFlagManager.initialize();
    featureFlagManager.destroy();
    await featureFlagManager.initialize();

    let settled = false;
    const wait = featureFlagManager.waitForFreshFlags().then(() => { settled = true; });
    await delay(80);
    assert.equal(settled, false, 'old fetch must not resolve the new generation promise');
    resolveSecond();
    await wait;
    featureFlagManager.destroy();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

await test('integration shutdown owns all process-wide runtime cleanup', async () => {
  const integration = new FixtureIntegration();
  await integration.initialize();

  toolHistory.addCall('fixture_tool', {}, {
    content: [{ type: 'text', text: 'fixture' }],
  });

  await integration.shutdown();
  assert.equal(searchManager.getActiveSessionCount(), 0);
  assert.equal(terminalManager.listActiveSessions().length, 0);
  assert.equal(toolHistory.getStats().queuedWrites, 0);
});

await toolHistory.cleanup();
await Promise.resolve(configManager.shutdown());
featureFlagManager.destroy();
await fs.rm(testHome, { recursive: true, force: true }).catch(() => {});

console.log(`\n${failures ? '🔴' : '✅'} direct runtime lifecycle: ${failures} failing test(s).`);
process.exit(failures ? 1 : 0);
