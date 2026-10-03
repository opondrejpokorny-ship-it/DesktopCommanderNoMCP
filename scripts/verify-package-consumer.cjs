const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const npmExecPath = process.env.npm_execpath;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      PUPPETEER_SKIP_DOWNLOAD: '1',
      ...(options.env ?? {}),
    },
    shell: false,
    timeout: options.timeout ?? 180000,
  });

  if (!options.allowFailure && result.status !== 0) {
    const detail = result.error ? `\nERROR: ${result.error.stack ?? result.error}` : '';
    throw new Error(
      `${command} ${args.join(' ')} failed with exit ${result.status}${detail}\nSTDOUT:\n${result.stdout ?? ''}\nSTDERR:\n${result.stderr ?? ''}`,
    );
  }

  return result;
}

function runNpm(args, options = {}) {
  assert.ok(
    npmExecPath,
    'test:package-consumer must run through npm so npm_execpath is available',
  );
  return run(process.execPath, [npmExecPath, ...args], options);
}

function phase(name) {
  console.log(`PACKAGE_CONSUMER_PHASE ${name}`);
}

async function writeScript(filePath, content) {
  await fsp.writeFile(filePath, content, 'utf8');
}

async function main() {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'dc-package-consumer-'));
  let tarballPath;

  try {
    phase('pack');
    const pack = runNpm(['pack', '--ignore-scripts', '--json']);
    const packResult = JSON.parse(pack.stdout);
    assert.ok(Array.isArray(packResult) && packResult[0]?.filename, 'npm pack must return a tarball filename');
    tarballPath = path.join(repoRoot, packResult[0].filename);

    const consumer = path.join(tempRoot, 'consumer');
    await fsp.mkdir(consumer, { recursive: true });
    await fsp.writeFile(
      path.join(consumer, 'package.json'),
      JSON.stringify({ name: 'desktop-commander-consumer-smoke', private: true, version: '1.0.0' }, null, 2) + '\n',
    );

    phase('isolated-install');
    const install = runNpm(
      ['install', tarballPath, '--ignore-scripts', '--omit=dev', '--engine-strict'],
      { cwd: consumer },
    );
    const installOutput = `${install.stdout}\n${install.stderr}`;
    const deprecatedLines = installOutput
      .split(/\r?\n/)
      .filter(line => /npm warn deprecated/i.test(line));
    for (const line of deprecatedLines) {
      assert.match(
        line,
        /(inflight@1\.0\.6|glob@7\.2\.3)/,
        `unexpected production deprecation warning: ${line}`,
      );
    }

    runNpm([
      'ls',
      '@wonderwhy-er/desktop-commander',
      'archiver',
      'uuid',
      'chokidar',
      'puppeteer',
      '--omit=dev',
      '--all',
    ], { cwd: consumer });

    phase('audit');
    const audit = runNpm(['audit', '--omit=dev', '--json'], {
      cwd: consumer,
      allowFailure: true,
    });
    const auditJson = JSON.parse(audit.stdout);
    assert.equal(auditJson.metadata?.vulnerabilities?.total, 0, 'fresh consumer runtime audit must stay at zero');

    const installedRoot = path.join(
      consumer,
      'node_modules',
      '@wonderwhy-er',
      'desktop-commander',
    );
    const installedPackage = JSON.parse(
      await fsp.readFile(path.join(installedRoot, 'package.json'), 'utf8'),
    );
    assert.equal(installedPackage.bin?.['desktop-commander'], 'dist/index.js');

    for (const licensePath of [
      path.join(installedRoot, 'vendor', 'exceljs', 'LICENSE'),
      path.join(installedRoot, 'vendor', 'md-to-pdf', 'license'),
    ]) {
      assert.ok(fs.existsSync(licensePath), `missing vendored license in packed artifact: ${licensePath}`);
    }

    phase('excel-runtime');
    const excelScript = path.join(consumer, 'excel-smoke.mjs');
    await writeScript(excelScript, `
import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from './node_modules/@wonderwhy-er/desktop-commander/vendor/exceljs/index.js';

const excelPath = path.resolve('consumer-stream.xlsx');
const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: excelPath });
const sheet = workbook.addWorksheet('Data');
sheet.addRow(['Name', 'Value']).commit();
sheet.addRow(['Consumer', 1]).commit();
await workbook.commit();

const check = new ExcelJS.Workbook();
await check.xlsx.readFile(excelPath);
if (check.getWorksheet('Data').getCell('A2').value !== 'Consumer') {
  throw new Error('consumer Excel streaming round-trip failed');
}
await fs.rm(excelPath, { force: true });
console.log('PACKAGE_CONSUMER_EXCEL_GREEN');
`);
    run(process.execPath, [excelScript], { cwd: consumer, timeout: 30000 });

    phase('pdf-runtime');
    const pdfScript = path.join(consumer, 'pdf-smoke.mjs');
    await writeScript(pdfScript, `
import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import {
  parsePdfToMarkdown,
  parseMarkdownToPdf,
} from './node_modules/@wonderwhy-er/desktop-commander/dist/tools/pdf/index.js';

const pdf = await PDFDocument.create();
const page = pdf.addPage([320, 200]);
const font = await pdf.embedFont(StandardFonts.Helvetica);
page.drawText('Consumer PDF parser smoke', { x: 20, y: 150, size: 18, font });
const pdfPath = path.resolve('consumer-parser.pdf');
await fs.writeFile(pdfPath, await pdf.save());

const parsed = await parsePdfToMarkdown(pdfPath);
if (!parsed.pages.length || !parsed.pages.map(p => p.text).join(' ').includes('Consumer PDF parser smoke')) {
  throw new Error('consumer PDF parser smoke failed');
}

const generatedPdf = await parseMarkdownToPdf('# Consumer generated PDF\\n\\nPacked consumer PDF generation smoke.');
if (!generatedPdf || generatedPdf.length < 1000) {
  throw new Error('consumer PDF generation returned an unexpectedly small buffer');
}
const generatedPdfPath = path.resolve('consumer-generated.pdf');
await fs.writeFile(generatedPdfPath, generatedPdf);
const generatedParsed = await parsePdfToMarkdown(generatedPdfPath);
if (!generatedParsed.pages.length || !generatedParsed.pages.map(p => p.text).join(' ').includes('Consumer generated PDF')) {
  throw new Error('consumer generated PDF could not be parsed back');
}

await fs.rm(pdfPath, { force: true });
await fs.rm(generatedPdfPath, { force: true });
console.log('PACKAGE_CONSUMER_PDF_GREEN');
`);
    run(process.execPath, [pdfScript], { cwd: consumer, timeout: 120000 });

    phase('mcp-runtime');
    const mcpScript = path.join(consumer, 'mcp-smoke.mjs');
    await writeScript(mcpScript, `
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const installedRoot = path.resolve('node_modules/@wonderwhy-er/desktop-commander');
const client = new Client(
  { name: 'package-consumer-smoke', version: '1.0.0' },
  { capabilities: {} },
);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(installedRoot, 'dist', 'index.js')],
  cwd: installedRoot,
  stderr: 'pipe',
  env: { ...process.env, DESKTOP_COMMANDER_DISABLE_TELEMETRY: 'true' },
});
try {
  await client.connect(transport);
  const tools = await client.listTools();
  if (!Array.isArray(tools.tools) || tools.tools.length === 0) {
    throw new Error('packed Desktop Commander MCP entrypoint returned no tools');
  }
  console.log('PACKAGE_CONSUMER_MCP_GREEN');
} finally {
  await client.close().catch(() => {});
}
`);
    run(process.execPath, [mcpScript], { cwd: consumer, timeout: 30000 });

    phase('normal-install');
    const normalConsumer = path.join(tempRoot, 'normal-consumer');
    await fsp.mkdir(normalConsumer, { recursive: true });
    await fsp.writeFile(
      path.join(normalConsumer, 'package.json'),
      JSON.stringify({ name: 'desktop-commander-normal-install-smoke', private: true, version: '1.0.0' }, null, 2) + '\n',
    );
    runNpm(['install', tarballPath, '--omit=dev', '--engine-strict'], {
      cwd: normalConsumer,
      env: { DC_DISABLE_INSTALL_TELEMETRY: '1' },
    });

    const normalInstalledRoot = path.join(
      normalConsumer,
      'node_modules',
      '@wonderwhy-er',
      'desktop-commander',
    );
    const binShim = path.join(
      normalConsumer,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'desktop-commander.cmd' : 'desktop-commander',
    );
    assert.ok(fs.existsSync(binShim), `published desktop-commander bin shim missing: ${binShim}`);

    const ripgrepCheck = `
const fs = require('node:fs');
const { createRequire } = require('node:module');
const root = ${JSON.stringify(normalInstalledRoot)};
const requireFromPackage = createRequire(root + '/package.json');
const ripgrep = requireFromPackage('@vscode/ripgrep');
if (!ripgrep.rgPath || !fs.existsSync(ripgrep.rgPath)) {
  throw new Error('normal install did not produce a usable ripgrep binary');
}
console.log('NORMAL_INSTALL_RIPGREP_GREEN');
`;
    run(process.execPath, ['-e', ripgrepCheck], { cwd: normalConsumer, timeout: 15000 });

    console.log('PACKAGE_CONSUMER_INSTALL_GREEN');
  } finally {
    if (tarballPath) {
      await fsp.rm(tarballPath, { force: true });
    }
    await fsp.rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
