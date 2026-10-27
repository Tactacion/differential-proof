import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, summarizeSide, formatSummary, VERDICTS } from '../src/verdict.js';

const pass = { ok: true, errorKind: null };
const assertFail = { ok: false, errorKind: 'assertion', error: 'step 2 (expect_text): expected text' };
const unreplayable = { ok: false, errorKind: 'unreplayable', error: 'step 1 (click): no element' };
const infra = { ok: false, errorKind: 'infra', error: 'app did not answer' };
const x3 = (r) => [r, r, r];

test('summarizeSide: pass, fail, flaky, error', () => {
  assert.equal(summarizeSide(x3(pass)).outcome, 'pass');
  assert.equal(summarizeSide(x3(assertFail)).outcome, 'fail');
  assert.equal(summarizeSide([pass, assertFail, pass]).outcome, 'flaky');
  assert.equal(summarizeSide([pass, infra, pass]).outcome, 'error');
  assert.equal(summarizeSide([]).outcome, 'error');
});

test('fails on base with an assertion, passes on PR -> PROVEN (behavior)', () => {
  const d = decide({ base: x3(assertFail), head: x3(pass), kind: 'bugfix' });
  assert.equal(d.verdict, VERDICTS.PROVEN);
  assert.equal(d.strength, 'behavior');
  assert.equal(d.conclusion, 'success');
});

test('base cannot even run the proof, PR passes -> PROVEN (presence, weak)', () => {
  const d = decide({ base: x3(unreplayable), head: x3(pass), kind: 'feature' });
  assert.equal(d.verdict, VERDICTS.PROVEN);
  assert.equal(d.strength, 'presence');
  assert.equal(d.conclusion, 'success');
});

test('bug fix that only passes because of new UI gets an extra warning', () => {
  const d = decide({ base: x3(unreplayable), head: x3(pass), kind: 'bugfix' });
  assert.equal(d.strength, 'presence');
  assert.ok(d.reasons.some((r) => r.includes('bug fix')));
});

test('passes on both -> VACUOUS, which fails the check', () => {
  const d = decide({ base: x3(pass), head: x3(pass), kind: 'bugfix' });
  assert.equal(d.verdict, VERDICTS.VACUOUS);
  assert.equal(d.conclusion, 'failure');
});

test('fails on PR -> HEAD_FAILS', () => {
  const d = decide({ base: x3(assertFail), head: x3(assertFail) });
  assert.equal(d.verdict, VERDICTS.HEAD_FAILS);
  assert.equal(d.conclusion, 'failure');
});

test('flaky on PR -> INCONCLUSIVE and blocks', () => {
  const d = decide({ base: x3(assertFail), head: [pass, assertFail, pass] });
  assert.equal(d.verdict, VERDICTS.INCONCLUSIVE);
  assert.equal(d.conclusion, 'failure');
});

test('sometimes passes on base -> INCONCLUSIVE, not PROVEN', () => {
  const d = decide({ base: [pass, assertFail, assertFail], head: x3(pass) });
  assert.equal(d.verdict, VERDICTS.INCONCLUSIVE);
});

test('infra error on either side never becomes PROVEN or VACUOUS', () => {
  for (const [base, head] of [
    [x3(infra), x3(pass)],
    [x3(pass), x3(infra)],
    [[assertFail, infra, assertFail], x3(pass)],
  ]) {
    const d = decide({ base, head });
    assert.equal(d.verdict, VERDICTS.INCONCLUSIVE);
    assert.equal(d.conclusion, 'failure');
  }
});

test('refactor: passes on both -> PRESERVED', () => {
  const d = decide({ base: x3(pass), head: x3(pass), kind: 'refactor' });
  assert.equal(d.verdict, VERDICTS.PRESERVED);
  assert.equal(d.conclusion, 'success');
});

test('refactor: base fails, PR passes -> BEHAVIOR_CHANGED', () => {
  const d = decide({ base: x3(assertFail), head: x3(pass), kind: 'refactor' });
  assert.equal(d.verdict, VERDICTS.BEHAVIOR_CHANGED);
  assert.equal(d.conclusion, 'failure');
});

test('refactor: flaky base -> INCONCLUSIVE', () => {
  const d = decide({ base: [pass, assertFail, pass], head: x3(pass), kind: 'refactor' });
  assert.equal(d.verdict, VERDICTS.INCONCLUSIVE);
});

test('summary mentions verdict, both sides and the claim', () => {
  const d = decide({ base: x3(assertFail), head: x3(pass) });
  const s = formatSummary(d, { claim: 'Export works on invoices', baseRef: 'main', headRef: 'fix' });
  assert.match(s, /PROVEN/);
  assert.match(s, /Export works on invoices/);
  assert.match(s, /base `main`/);
  assert.match(s, /PR `fix`/);
});
