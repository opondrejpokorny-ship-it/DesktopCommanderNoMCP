import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from '../vendor/exceljs/index.js';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dc-excel-transitive-'));
const streamingFile = path.join(tempDir, 'streaming.xlsx');

try {
  const streaming = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: streamingFile });
  const sheet = streaming.addWorksheet('Data');
  sheet.addRow(['Name', 'Value']).commit();
  sheet.addRow(['Alpha', 1]).commit();
  await streaming.commit();

  const classic = new ExcelJS.Workbook();
  await classic.xlsx.readFile(streamingFile);
  assert.equal(classic.getWorksheet('Data').getCell('A2').value, 'Alpha');

  const reader = new ExcelJS.stream.xlsx.WorkbookReader(streamingFile, {
    worksheets: 'emit',
    sharedStrings: 'cache',
    hyperlinks: 'ignore',
    styles: 'cache',
  });
  const rows = [];
  for await (const worksheet of reader) {
    for await (const row of worksheet) {
      rows.push(row.values.slice(1));
    }
  }
  assert.deepEqual(rows[0], ['Name', 'Value']);
  assert.deepEqual(rows[1], ['Alpha', 1]);

  const csvBook = new ExcelJS.Workbook();
  const csvSheet = csvBook.addWorksheet('CSV');
  csvSheet.addRow(['Name', 'Value']);
  csvSheet.addRow(['Alpha', 1]);
  const csv = await csvBook.csv.writeBuffer();
  assert.ok(csv.toString().includes('Alpha,1'));

  console.log('EXCEL_TRANSITIVE_COMPAT_GREEN');
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
