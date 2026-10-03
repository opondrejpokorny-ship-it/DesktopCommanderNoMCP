import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { writePdf } from '../dist/tools/filesystem.js';
import { parsePdfToMarkdown } from '../dist/tools/pdf/index.js';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dc-pdf-compat-'));
const generated = path.join(tempDir, 'roundtrip.pdf');
const complex = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/(.:)/, '$1')),
  'samples',
  '03_sample_compex.pdf',
);

try {
  const marker = 'Dependency hardening PDF round-trip';
  await writePdf(generated, `# ${marker}\n\nGenerated through md-to-pdf.`);

  const stats = await fs.stat(generated);
  assert.ok(stats.size > 1000, `generated PDF unexpectedly small: ${stats.size}`);

  const parsed = await parsePdfToMarkdown(generated);
  assert.equal(parsed.pages.length, 1);
  assert.ok(parsed.pages[0].text.includes(marker));
  const selected = await parsePdfToMarkdown(complex, [1, 5, 14]);
  assert.deepEqual(
    selected.pages.map(page => page.pageNumber),
    [1, 5, 14],
    'PDF page filtering must preserve requested pages',
  );
  assert.ok(
    selected.pages.every(page => page.text.length > 0),
    'selected PDF pages must contain extracted text',
  );

  const sharp = (await import('sharp')).default;
  const png = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 4,
      background: { r: 10, g: 20, b: 30, alpha: 1 },
    },
  }).png().toBuffer();
  assert.ok(png.length > 20, 'sharp must remain usable for PDF image conversion');

  console.log('PDF_RUNTIME_COMPAT_GREEN');
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
