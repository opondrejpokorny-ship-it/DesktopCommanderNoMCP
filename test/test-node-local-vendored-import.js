import assert from 'node:assert/strict';
import { rewriteNodeLocalModuleSpecifiers } from '../dist/tools/improved-process-tools.js';

const input = [
  "import ExcelJS from 'exceljs';",
  'const dynamic = await import("exceljs");',
  'const templateDynamic = await import(`exceljs`);',
  "import 'exceljs';",
  "export { Workbook } from 'exceljs';",
  "const untouched = 'exceljs';",
  "// import Fake from 'exceljs';",
  "const template = `import Fake from 'exceljs';`;",
  "const regex = /from 'exceljs'/;",
].join('\n');

const rewritten = await rewriteNodeLocalModuleSpecifiers(input);

assert.ok(rewritten.includes("import ExcelJS from './vendor/exceljs/index.js';"));
assert.ok(rewritten.includes('await import("./vendor/exceljs/index.js")'));
assert.ok(rewritten.includes('await import(`./vendor/exceljs/index.js`)'));
assert.ok(rewritten.includes("import './vendor/exceljs/index.js';"));
assert.ok(rewritten.includes("export { Workbook } from './vendor/exceljs/index.js';"));
assert.ok(rewritten.includes("const untouched = 'exceljs';"), 'ordinary string values must not be rewritten');
assert.ok(rewritten.includes("// import Fake from 'exceljs';"), 'comments must not be rewritten');
assert.ok(rewritten.includes("const template = `import Fake from 'exceljs';`;"), 'template literal text must not be rewritten');
assert.ok(rewritten.includes("const regex = /from 'exceljs'/;"), 'regex literals must not be rewritten');

console.log('NODE_LOCAL_VENDORED_IMPORT_GREEN');
