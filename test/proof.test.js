import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateProof, normalizeProof } from '../src/proof.js';

const good = {
  name: 'Invoice export',
  claim: 'Clicking Export on Invoices produces invoices.csv',
  kind: 'bugfix',
  start_path: '/invoices',
  steps: [
    { action: 'click', target: { role: 'button', name: 'Export' } },
    { action: 'expect_text', target: { role: 'status' }, text: 'Export ready: invoices.csv' },
  ],
};

test('a well-formed proof validates', () => {
  const v = validateProof(good);
  assert.deepEqual(v.errors, []);
  assert.equal(v.ok, true);
});

test('a proof with no assertion is rejected', () => {
  const v = validateProof({ ...good, steps: [good.steps[0]] });
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => e.includes('proves nothing')));
});

test('the last step must be an assertion', () => {
  const v = validateProof({ ...good, steps: [...good.steps, good.steps[0]] });
  assert.ok(v.errors.some((e) => e.includes('last step')));
});

test('element refs are rejected with a helpful message', () => {
  const v = validateProof({ ...good, steps: [{ action: 'click', target: { ref: 42 } }, good.steps[1]] });
  assert.ok(v.errors.some((e) => e.includes("don't transfer")));
});

test('a target needs exactly one locator', () => {
  const v = validateProof({ ...good, steps: [{ action: 'click', target: { role: 'button', text: 'x' } }, good.steps[1]] });
  assert.ok(v.errors.some((e) => e.includes('exactly one')));
});

test('name without role is rejected', () => {
  const v = validateProof({ ...good, steps: [{ action: 'click', target: { text: 'Export', name: 'Export' } }, good.steps[1]] });
  assert.ok(v.errors.some((e) => e.includes('only works together with target.role')));
});

test('unknown actions, missing fields and bad regexes are reported', () => {
  const v = validateProof({
    ...good,
    steps: [
      { action: 'hover', target: { text: 'x' } },
      { action: 'fill', target: { label: 'Email' } },
      { action: 'expect_url', pattern: '(' },
    ],
  });
  assert.ok(v.errors.some((e) => e.includes('unknown action "hover"')));
  assert.ok(v.errors.some((e) => e.includes('needs "value"')));
  assert.ok(v.errors.some((e) => e.includes('not a valid regular expression')));
});

test('goto must stay on the app', () => {
  const v = validateProof({ ...good, steps: [{ action: 'goto', path: 'https://evil.example' }, good.steps[1]] });
  assert.ok(v.errors.some((e) => e.includes('must start with "/"')));
});

test('claim is required', () => {
  const { claim, ...rest } = good;
  assert.ok(validateProof(rest).errors.some((e) => e.includes('"claim"')));
});

test('normalizeProof fills defaults without overriding', () => {
  const { kind, start_path, ...rest } = good;
  assert.deepEqual(normalizeProof(rest).kind, 'bugfix');
  assert.deepEqual(normalizeProof(rest).start_path, '/');
  assert.equal(normalizeProof(good).start_path, '/invoices');
});
