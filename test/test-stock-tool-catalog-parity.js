import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

process.env.DESKTOP_COMMANDER_DISABLE_TELEMETRY = '1';
process.env.DC_FLAG_URL = 'http://127.0.0.1:9/flags';

const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/(.:)/, '$1'));
const baseline = JSON.parse(
  await fs.readFile(
    path.join(root, 'test', 'fixtures', 'stock-tool-catalog-baseline-0.2.51.json'),
    'utf8',
  ),
);

const { listStockTools } = await import('../dist/stock-tool-catalog.js');
const { StockDesktopCommanderAdapter } = await import('../dist/stock-desktop-commander-adapter.js');
const { featureFlagManager } = await import('../dist/utils/feature-flags.js');
await featureFlagManager.initialize();

const clientInfo = { name: 'desktop-commander-client', version: '1.0.0' };

const directResult = await listStockTools(clientInfo);
assert.equal(directResult.tools.length, baseline.count);
assert.deepEqual(directResult.tools, baseline.tools);

const adapter = new StockDesktopCommanderAdapter();
try {
  await adapter.initialize({ clientInfo, remote: true });
  const viaAdapter = await adapter.listTools();
  assert.equal(viaAdapter.tools.length, baseline.count);
  assert.deepEqual(viaAdapter.tools, baseline.tools);
} finally {
  await adapter.shutdown();
  featureFlagManager.destroy();
}

console.log('STOCK_TOOL_CATALOG_PARITY_GREEN');
