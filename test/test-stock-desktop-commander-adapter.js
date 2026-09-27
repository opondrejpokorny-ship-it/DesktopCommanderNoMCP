import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.DESKTOP_COMMANDER_DISABLE_TELEMETRY = '1';
process.env.DC_FLAG_URL = 'http://127.0.0.1:9/flags';

async function main() {
  const testHome = await fs.mkdtemp(path.join(os.tmpdir(), 'dc-direct-home-'));
  process.env.USERPROFILE = testHome;
  process.env.HOME = testHome;

  const module = await import('../dist/stock-desktop-commander-adapter.js');
  const { StockDesktopCommanderAdapter } = module;
  assert.equal(typeof StockDesktopCommanderAdapter, 'function', 'adapter class must be exported');

  const source = await fs.readFile(
    new URL('../src/stock-desktop-commander-adapter.ts', import.meta.url),
    'utf8'
  );
  assert.doesNotMatch(source, /StdioClientTransport/);
  assert.doesNotMatch(source, /dist[\\/]index\.js/);
  assert.doesNotMatch(source, /from ['"].*[\\/]server\.js['"]/);
  assert.doesNotMatch(source, /new Server\s*\(/);
  assert.match(source, /from ['"]\.\/stock-tool-catalog\.js['"]/);

  const serverSource = await fs.readFile(
    new URL('../src/server.ts', import.meta.url),
    'utf8'
  );
  assert.match(serverSource, /from ['"]\.\/stock-tool-catalog\.js['"]/);
  assert.doesNotMatch(serverSource, /const allTools\s*=\s*\[/);

  const root = await fs.mkdtemp(path.join(testHome, 'allowed-'));
  const fixture = path.join(root, 'fixture.txt');
  await fs.writeFile(fixture, 'alpha\nbeta\n', 'utf8');

  const { configManager } = await import('../dist/config-manager.js');
  const { featureFlagManager } = await import('../dist/utils/feature-flags.js');
  await featureFlagManager.initialize();
  const adapter = new StockDesktopCommanderAdapter();

  try {
    await adapter.initialize({
      clientInfo: { name: 'direct-adapter-test', version: '1.0.0' },
      remote: true,
    });
    await configManager.setValue('allowedDirectories', [root]);

    const health = await adapter.health();
    assert.equal(health.ready, true);

    const normalCatalog = await adapter.listTools();
    assert.equal(normalCatalog.tools.length, 26, 'normal stock catalog must expose exactly 26 tools');
    const normalNames = normalCatalog.tools.map((tool) => tool.name).sort();
    assert.equal(normalNames.includes('track_ui_event'), false, 'track_ui_event must remain hidden');
    assert.equal(normalNames.includes('give_feedback_to_desktop_commander'), true);
    assert.equal(normalNames.includes('get_prompts'), true);

    const appCatalog = await adapter.listTools({
      name: 'desktop-commander-app',
      version: '1.0.0',
    });
    const appNames = appCatalog.tools.map((tool) => tool.name).sort();
    assert.equal(appCatalog.tools.length, 24, 'desktop-commander-app must hide exactly two stock tools');
    assert.equal(appNames.includes('give_feedback_to_desktop_commander'), false);
    assert.equal(appNames.includes('get_prompts'), false);
    assert.deepEqual(
      normalNames.filter((name) => !appNames.includes(name)),
      ['get_prompts', 'give_feedback_to_desktop_commander'],
    );

    const listing = await adapter.callTool({
      name: 'list_directory',
      arguments: { path: root, depth: 1 },
      metadata: { remote: true, clientInfo: { name: 'direct-test', version: '1' } },
    });
    assert.equal(listing.isError, undefined);
    assert.match(listing.content?.[0]?.text ?? '', /fixture\.txt/);

    const read = await adapter.callTool({
      name: 'read_file',
      arguments: { path: fixture, offset: 0, length: 10 },
      metadata: { remote: true, clientInfo: { name: 'direct-test', version: '1' } },
    });
    assert.equal(read.isError, undefined);
    assert.match(read.content?.[0]?.text ?? '', /alpha/);
    assert.match(read.content?.[0]?.text ?? '', /beta/);

    const info = await adapter.callTool({
      name: 'get_file_info',
      arguments: { path: fixture },
      metadata: { remote: true, clientInfo: { name: 'direct-test', version: '1' } },
    });
    assert.equal(info.isError, undefined);
    assert.match(info.content?.[0]?.text ?? '', /isFile: true/);

    const denied = await adapter.callTool({
      name: 'get_file_info',
      arguments: { path: path.dirname(root) },
      metadata: { remote: true, clientInfo: { name: 'direct-test', version: '1' } },
    });
    assert.equal(denied.isError, true);
    assert.match(denied.content?.[0]?.text ?? '', /Path not allowed/i);

    const unknown = await adapter.callTool({
      name: 'not_a_real_tool',
      arguments: {},
    });
    assert.equal(unknown.isError, true);
    assert.match(unknown.content?.[0]?.text ?? '', /Unknown tool/i);

    console.log('DIRECT_ADAPTER_PILOT_GREEN');
  } finally {
    // Queue a durable mutation behind any non-blocking usage-stat writes so the
    // config write chain has drained before the isolated HOME disappears.
    await configManager.setValue('allowedDirectories', [root]).catch(() => {});
    await adapter.shutdown().catch(() => {});
    featureFlagManager.destroy();
    await configManager.shutdown();
    await fs.rm(testHome, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
