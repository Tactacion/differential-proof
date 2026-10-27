import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addedLines, executedTexts, touchedChangedCode } from '../src/coverage.js';

const DIFF = `diff --git a/server.js b/server.js
index 111..222 100644
--- a/server.js
+++ b/server.js
@@ -10,1 +10,4 @@
-const INVOICES_SCRIPT = \`document.getElementById('export').onclick = () => exportInvoices();\`;
+const INVOICES_SCRIPT = \`function exportInvoices() {
+  document.getElementById('status').textContent = 'Export ready: invoices.csv';
+}
+document.getElementById('export').onclick = () => exportInvoices();\`;
`;

const entry = (source, functions) => ({ url: 'http://127.0.0.1:4321/invoices', source, functions });
const fn = (...ranges) => ({ ranges: ranges.map(([startOffset, endOffset, count]) => ({ startOffset, endOffset, count })) });

test('addedLines keeps only significant added lines, never headers or removals', () => {
  const lines = addedLines(DIFF);
  assert.ok(lines.includes("document.getElementById('status').textContent = 'Export ready: invoices.csv';"));
  assert.ok(!lines.some((l) => l.includes('server.js'))); // the +++ header
  assert.ok(!lines.includes('}')); // too short to mean anything
  assert.ok(!lines.some((l) => l.startsWith('-')));
  assert.deepEqual(addedLines(''), []);
  assert.deepEqual(addedLines(undefined), []);
});

test('executedTexts slices only ranges that ran, subtracting count-0 holes', () => {
  const source = 'AAAA function dead() { NEVER } BBBB';
  const texts = executedTexts([entry(source, [fn([0, source.length, 1]), fn([5, 30, 0])])]);
  const joined = texts.join('|');
  assert.ok(joined.includes('AAAA'));
  assert.ok(joined.includes('BBBB'));
  assert.ok(!joined.includes('NEVER'));
});

test('executedTexts tolerates malformed entries', () => {
  assert.deepEqual(executedTexts(null), []);
  assert.deepEqual(executedTexts([{ url: 'x' }, entry('', [])]), []);
});

test('touchedChangedCode: yes when an added line ran in the browser', () => {
  const ran = "function exportInvoices() {\n  document.getElementById('status').textContent = 'Export ready: invoices.csv';\n}";
  const texts = executedTexts([entry(ran, [fn([0, ran.length, 1])])]);
  assert.equal(touchedChangedCode({ texts, diff: DIFF }), 'yes');
});

test('touchedChangedCode: no when the proof only ran untouched code', () => {
  const ran = "document.getElementById('status').textContent = 'Export ready: reports.csv';";
  const texts = executedTexts([entry(ran, [fn([0, ran.length, 1])])]);
  assert.equal(touchedChangedCode({ texts, diff: DIFF }), 'no');
});

test('touchedChangedCode: no when the changed code loaded but never ran', () => {
  const source = "function exportInvoices() {\n  document.getElementById('status').textContent = 'Export ready: invoices.csv';\n}\ndocument.getElementById('export').onclick = () => exportInvoices();";
  // Top level ran (the onclick assignment), but exportInvoices itself did not.
  const bodyEnd = source.indexOf('\n}') + 2;
  const texts = executedTexts([entry(source, [fn([0, source.length, 1]), fn([0, bodyEnd, 0])])]);
  assert.equal(touchedChangedCode({ texts, diff: DIFF }), 'no');
});

test('touchedChangedCode: unknown without coverage or without a usable diff', () => {
  assert.equal(touchedChangedCode({ texts: null, diff: DIFF }), 'unknown');
  assert.equal(touchedChangedCode({ texts: [], diff: DIFF }), 'unknown');
  assert.equal(touchedChangedCode({ texts: ['whatever code ran'], diff: '' }), 'unknown');
  assert.equal(touchedChangedCode({ texts: ['whatever code ran'], diff: '+}\n+x;' }), 'unknown');
});
