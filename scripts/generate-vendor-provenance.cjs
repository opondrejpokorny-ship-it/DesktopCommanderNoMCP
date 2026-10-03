const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const vendorRoot = path.join(repoRoot, 'vendor');

const sources = {
  exceljs: {
    version: '4.4.0',
    gitHead: 'ac96f9a61e9799c7776bd940f05c4a51d7200209',
    tarball: 'https://registry.npmjs.org/exceljs/-/exceljs-4.4.0.tgz',
    integrity: 'sha512-XctvKaEMaj1Ii9oDOqbW/6e1gXknSY4g/aLCDicOXqBE4M0nRWkUu0PTp++UPNzoFY12BNHMfs/VadKIS6llvg==',
  },
  'md-to-pdf': {
    version: '5.2.5',
    gitHead: '9e74457091a8e3f35f35113262ce406e92db0e9a',
    tarball: 'https://registry.npmjs.org/md-to-pdf/-/md-to-pdf-5.2.5.tgz',
    integrity: 'sha512-TG8TgDM0PmEwCldR6j/1QP9gBElLL3DSn5ID8P3bEXEl3Y2zHOUSyszHzabWnDNxklRjKbi40ybli8YQJ5Ym5w==',
  },
};

async function walk(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

async function hashFile(filePath) {
  const buffer = await fsp.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function main() {
  const packages = {};
  for (const [name, source] of Object.entries(sources)) {
    const root = path.join(vendorRoot, name);
    const files = await walk(root);
    const hashes = {};
    for (const file of files) {
      const relative = path.relative(root, file).split(path.sep).join('/');
      hashes[relative] = await hashFile(file);
    }
    packages[name] = { ...source, files: hashes };
  }

  const manifest = {
    schemaVersion: 1,
    generatedFrom: 'npm registry tarballs plus documented local compatibility changes in vendor/README.md',
    packages,
  };
  const output = path.join(vendorRoot, 'provenance.json');
  await fsp.writeFile(output, JSON.stringify(manifest, null, 2) + '\n');
  console.log('VENDOR_PROVENANCE_GENERATED', output);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
