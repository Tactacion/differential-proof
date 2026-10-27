// Pure verdict logic. No I/O. Every branch here has a unit test.
//
// Input: the runs of one proof on the base branch and on the PR head.
// Each run is { ok: boolean, errorKind: null | 'assertion' | 'unreplayable' | 'infra', error?: string }.
//   assertion    -> the page loaded and the steps ran, but an expect_* step failed
//   unreplayable -> a non-assertion step could not run (e.g. the button doesn't exist)
//   infra        -> the app or browser broke; says nothing about the code

export const VERDICTS = {
  PROVEN: 'PROVEN', // fails on base, passes on PR: the change caused the behavior
  VACUOUS: 'VACUOUS', // passes on both: the proof doesn't show anything the PR did
  HEAD_FAILS: 'HEAD_FAILS', // the proof doesn't even pass on the PR
  PRESERVED: 'PRESERVED', // refactor: passes on both, behavior kept
  BEHAVIOR_CHANGED: 'BEHAVIOR_CHANGED', // refactor: base fails but PR passes, so behavior changed
  INCONCLUSIVE: 'INCONCLUSIVE', // flaky or broken infra: a human has to look
};

export function summarizeSide(runs) {
  if (!Array.isArray(runs) || runs.length === 0) {
    return { outcome: 'error', passed: 0, total: 0, failKinds: [], reason: 'no runs' };
  }
  const total = runs.length;
  const passed = runs.filter((r) => r.ok).length;
  const infra = runs.filter((r) => !r.ok && r.errorKind === 'infra');
  const failKinds = [...new Set(runs.filter((r) => !r.ok).map((r) => r.errorKind ?? 'assertion'))];
  if (infra.length > 0) {
    return { outcome: 'error', passed, total, failKinds, reason: infra[0].error ?? 'infrastructure error' };
  }
  if (passed === total) return { outcome: 'pass', passed, total, failKinds };
  if (passed === 0) return { outcome: 'fail', passed, total, failKinds };
  return { outcome: 'flaky', passed, total, failKinds };
}

const CONCLUSION = {
  PROVEN: 'success',
  PRESERVED: 'success',
  VACUOUS: 'failure',
  HEAD_FAILS: 'failure',
  BEHAVIOR_CHANGED: 'failure',
  // A required check must not pass while nobody knows the answer.
  INCONCLUSIVE: 'failure',
};

function result(verdict, title, reasons, extra = {}) {
  return { verdict, conclusion: CONCLUSION[verdict], title, reasons, strength: null, ...extra };
}

export function decide({ base, head, kind = 'bugfix' }) {
  const b = summarizeSide(base);
  const h = summarizeSide(head);
  const sides = { base: b, head: h };

  if (b.outcome === 'error' || h.outcome === 'error') {
    const which = b.outcome === 'error' ? 'base' : 'PR';
    const why = (b.outcome === 'error' ? b.reason : h.reason) ?? 'infrastructure error';
    return result(VERDICTS.INCONCLUSIVE, `Inconclusive: the ${which} run broke`, [why], { sides });
  }
  if (h.outcome === 'flaky') {
    return result(
      VERDICTS.INCONCLUSIVE,
      `Inconclusive: proof is flaky on the PR (${h.passed}/${h.total} passed)`,
      ['The same proof gave different results on the same code. Fix the flakiness before trusting it.'],
      { sides },
    );
  }
  if (h.outcome === 'fail') {
    return result(VERDICTS.HEAD_FAILS, 'The proof fails on the PR itself', [
      'The agent’s own proof does not pass on its branch, so the claimed behavior is not there.',
    ], { sides });
  }

  // From here on the proof passes on the PR every time.
  if (kind === 'refactor') {
    if (b.outcome === 'pass') {
      return result(VERDICTS.PRESERVED, 'Behavior preserved: proof passes on base and PR', [
        'A refactor should not change behavior, and this proof behaves the same on both sides.',
      ], { sides });
    }
    if (b.outcome === 'flaky') {
      return result(VERDICTS.INCONCLUSIVE, `Inconclusive: proof is flaky on base (${b.passed}/${b.total} passed)`, [
        'Cannot tell whether the refactor changed behavior.',
      ], { sides });
    }
    return result(VERDICTS.BEHAVIOR_CHANGED, 'Refactor changed behavior: proof fails on base, passes on PR', [
      'This PR is labeled a refactor, but the proof only passes after the change.',
    ], { sides });
  }

  if (b.outcome === 'pass') {
    return result(VERDICTS.VACUOUS, 'Vacuous proof: it also passes on base', [
      'The proof passes with and without the change, so it does not show anything this PR did.',
      'Either the proof tests the wrong thing, or the behavior already worked before the PR.',
    ], { sides });
  }
  if (b.outcome === 'flaky') {
    return result(VERDICTS.INCONCLUSIVE, `Inconclusive: proof sometimes passes on base (${b.passed}/${b.total})`, [
      'Without the change the proof still passes some of the time, so a pass on the PR may be luck.',
    ], { sides });
  }

  // Base fails every time, PR passes every time.
  const onlyAssertion = b.failKinds.every((k) => k === 'assertion');
  if (onlyAssertion) {
    return result(VERDICTS.PROVEN, 'Proven: fails on base, passes on PR', [
      'Every step ran on both sides; the final check only holds after the change.',
    ], { sides, strength: 'behavior' });
  }
  const reasons = [
    'On base, a step could not even run (for example the button does not exist yet). The PR adds what the proof needs.',
    'That shows the new UI exists, not that it behaves correctly. Make sure the last assertion checks the claimed behavior.',
  ];
  if (kind === 'bugfix') {
    reasons.push('This is labeled a bug fix, yet the proof needs UI that is new in the PR. Check it reproduces the reported bug.');
  }
  return result(VERDICTS.PROVEN, 'Proven (weak): base cannot run the proof, PR passes', reasons, {
    sides,
    strength: 'presence',
  });
}

export function formatSummary(decision, meta = {}) {
  const { sides } = decision;
  const line = (label, s) => `| ${label} | ${s.outcome} | ${s.passed}/${s.total} | ${s.failKinds.join(', ') || '-'} |`;
  const out = [
    `## differential-proof: ${decision.verdict}${decision.strength === 'presence' ? ' (weak)' : ''}`,
    '',
    `**${decision.title}**`,
    '',
    ...(meta.claim ? [`Claim: ${meta.claim}`, ''] : []),
    '| Side | Outcome | Passed | Failure kinds |',
    '| --- | --- | --- | --- |',
    line(`base \`${meta.baseRef ?? 'base'}\``, sides.base),
    line(`PR \`${meta.headRef ?? 'head'}\``, sides.head),
    '',
    ...decision.reasons.map((r) => `- ${r}`),
  ];
  if (meta.firstErrors?.base) out.push('', `Base failed at: ${meta.firstErrors.base}`);
  if (meta.firstErrors?.head) out.push('', `PR failed at: ${meta.firstErrors.head}`);
  return out.join('\n');
}
