const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const provenance = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'vendor', 'provenance.json'), 'utf8'),
);

const required = new Set([
  'vendor/README.md',
  'vendor/provenance.json',
]);

for (const [packageName, info] of Object.entries(provenance.packages ?? {})) {
  for (const relativePath of Object.keys(info.files ?? {})) {
    required.add(`vendor/${packageName}/${relativePath}`);
  }
}

const tracked = new Set(
  execFileSync('git', ['ls-files', '--', 'vendor'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
    .split(/\r?\n/)
    .map(line => line.trim().replaceAll('\\', '/'))
    .filter(Boolean),
);

const missing = [...required].filter(file => !tracked.has(file));
const unexpected = [...tracked].filter(file => !required.has(file));
if (missing.length > 0 || unexpected.length > 0) {
  if (missing.length > 0) {
    console.error('Vendored provenance files missing from Git index:');
    for (const file of missing.slice(0, 100)) console.error(`- ${file}`);
    if (missing.length > 100) console.error(`... and ${missing.length - 100} more`);
  }
  if (unexpected.length > 0) {
    console.error('Tracked vendor files missing provenance coverage:');
    for (const file of unexpected.slice(0, 100)) console.error(`- ${file}`);
    if (unexpected.length > 100) console.error(`... and ${unexpected.length - 100} more`);
  }
  process.exit(1);
}

console.log(`VENDOR_TRACKING_GREEN required=${required.size} tracked=${tracked.size}`);
