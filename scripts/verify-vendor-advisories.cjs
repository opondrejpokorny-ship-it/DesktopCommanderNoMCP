const fsp = require('node:fs/promises');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const provenancePath = path.join(repoRoot, 'vendor', 'provenance.json');

async function queryOsv(name, version) {
  const response = await fetch('https://api.osv.dev/v1/query', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'user-agent': 'desktop-commander-vendor-advisory-check',
    },
    body: JSON.stringify({
      package: { ecosystem: 'npm', name },
      version,
    }),
  });
  if (!response.ok) {
    throw new Error(`OSV query failed for ${name}@${version}: HTTP ${response.status}`);
  }
  return response.json();
}

async function main() {
  const provenance = JSON.parse(await fsp.readFile(provenancePath, 'utf8'));
  const findings = [];

  for (const [name, info] of Object.entries(provenance.packages ?? {})) {
    const result = await queryOsv(name, info.version);
    for (const vuln of result.vulns ?? []) {
      findings.push({
        package: `${name}@${info.version}`,
        id: vuln.id,
        aliases: vuln.aliases ?? [],
        summary: vuln.summary ?? '',
      });
    }
  }

  if (findings.length > 0) {
    console.error('Vendored package advisories detected:');
    console.error(JSON.stringify(findings, null, 2));
    process.exit(1);
  }

  console.log('VENDOR_ADVISORIES_GREEN');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
