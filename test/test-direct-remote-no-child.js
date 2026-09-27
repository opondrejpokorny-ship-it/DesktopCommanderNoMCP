import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = await fs.readFile(
  new URL('../src/remote-device/desktop-commander-integration.ts', import.meta.url),
  'utf8',
);

assert.doesNotMatch(source, /StdioClientTransport/);
assert.doesNotMatch(source, /@modelcontextprotocol\/sdk\/client/);
assert.doesNotMatch(source, /\bspawn\b/);
assert.doesNotMatch(source, /resolveMcpConfig/);
assert.doesNotMatch(source, /dist[\\/]index\.js/);

console.log('DIRECT_REMOTE_NO_CHILD_GREEN');
