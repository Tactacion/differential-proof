// Proof script format + validator.
//
// A proof is a short, replayable browser script that ends in an assertion.
// It is written once (by the agent that made the change, or by an
// independent verifier) and replayed on BOTH the base branch and the PR.
//
// Targets are semantic (role+name, label, text, testId, placeholder) so they
// re-resolve on a fresh machine. Element refs like `[ref=42]` from
// `replicas computer browser-state` are rejected on purpose: they reset on
// navigation and never transfer between VMs.

export const KINDS = ['bugfix', 'feature', 'refactor'];

export const TARGET_KEYS = ['role', 'label', 'text', 'testId', 'placeholder'];

export const STEP_SPECS = {
  goto: { target: false, fields: ['path'] },
  click: { target: true },
  fill: { target: true, fields: ['value'] },
  press: { target: false, fields: ['key'] },
  select: { target: true, fields: ['value'] },
  check: { target: true },
  expect_visible: { target: true, assertion: true },
  expect_hidden: { target: true, assertion: true },
  expect_text: { target: true, fields: ['text'], assertion: true },
  expect_url: { target: false, fields: ['pattern'], assertion: true },
  expect_count: { target: true, fields: ['count'], assertion: true },
};

export const MAX_STEPS = 100;

export function isAssertion(step) {
  return Boolean(STEP_SPECS[step?.action]?.assertion);
}

function validateTarget(target, where, errors) {
  if (target === null || typeof target !== 'object' || Array.isArray(target)) {
    errors.push(`${where}: "target" must be an object`);
    return;
  }
  if ('ref' in target || 'targetId' in target) {
    errors.push(
      `${where}: element refs don't transfer between machines; use { "role", "name" }, "label", "text", "testId" or "placeholder" instead`,
    );
    return;
  }
  const primary = TARGET_KEYS.filter((k) => target[k] !== undefined);
  if (primary.length !== 1) {
    errors.push(`${where}: target needs exactly one of ${TARGET_KEYS.join(', ')} (got ${primary.length})`);
    return;
  }
  for (const k of primary) {
    if (typeof target[k] !== 'string' || target[k].trim() === '') {
      errors.push(`${where}: target.${k} must be a non-empty string`);
    }
  }
  if (target.name !== undefined && !target.role) {
    errors.push(`${where}: target.name only works together with target.role`);
  }
  if (target.name !== undefined && typeof target.name !== 'string') {
    errors.push(`${where}: target.name must be a string`);
  }
  if (target.nth !== undefined && !(Number.isInteger(target.nth) && target.nth >= 0)) {
    errors.push(`${where}: target.nth must be a non-negative integer`);
  }
  if (target.exact !== undefined && typeof target.exact !== 'boolean') {
    errors.push(`${where}: target.exact must be true or false`);
  }
}

export function validateProof(proof) {
  const errors = [];
  if (proof === null || typeof proof !== 'object' || Array.isArray(proof)) {
    return { ok: false, errors: ['proof must be a JSON object'] };
  }
  if (typeof proof.name !== 'string' || proof.name.trim() === '') {
    errors.push('"name" is required');
  }
  if (typeof proof.claim !== 'string' || proof.claim.trim() === '') {
    errors.push('"claim" is required: one sentence saying what behavior the change is supposed to cause');
  }
  if (proof.kind !== undefined && !KINDS.includes(proof.kind)) {
    errors.push(`"kind" must be one of ${KINDS.join(', ')}`);
  }
  if (proof.start_path !== undefined && (typeof proof.start_path !== 'string' || !proof.start_path.startsWith('/'))) {
    errors.push('"start_path" must start with "/"');
  }
  if (!Array.isArray(proof.steps) || proof.steps.length === 0) {
    errors.push('"steps" must be a non-empty array');
    return { ok: false, errors };
  }
  if (proof.steps.length > MAX_STEPS) {
    errors.push(`"steps" can have at most ${MAX_STEPS} entries`);
  }

  proof.steps.forEach((step, i) => {
    const where = `steps[${i}]`;
    const spec = STEP_SPECS[step?.action];
    if (!spec) {
      errors.push(`${where}: unknown action "${step?.action}" (allowed: ${Object.keys(STEP_SPECS).join(', ')})`);
      return;
    }
    if (spec.target) validateTarget(step.target, where, errors);
    else if (step.target !== undefined) errors.push(`${where}: "${step.action}" does not take a target`);
    for (const f of spec.fields ?? []) {
      if (step[f] === undefined || step[f] === null || step[f] === '') {
        errors.push(`${where}: "${step.action}" needs "${f}"`);
      }
    }
    if (step.action === 'goto' && typeof step.path === 'string' && !step.path.startsWith('/')) {
      errors.push(`${where}: goto.path must start with "/" (stay on the app under test)`);
    }
    if (step.action === 'expect_count' && !(Number.isInteger(step.count) && step.count >= 0)) {
      errors.push(`${where}: expect_count.count must be a non-negative integer`);
    }
    if (step.action === 'expect_url') {
      try {
        new RegExp(step.pattern);
      } catch {
        errors.push(`${where}: expect_url.pattern is not a valid regular expression`);
      }
    }
  });

  if (!proof.steps.some(isAssertion)) {
    errors.push('a proof needs at least one expect_* step; a recording with no assertion proves nothing');
  } else if (!isAssertion(proof.steps[proof.steps.length - 1])) {
    errors.push('the last step must be an expect_* assertion');
  }

  return { ok: errors.length === 0, errors };
}

export function normalizeProof(proof) {
  return {
    kind: 'bugfix',
    start_path: '/',
    ...proof,
  };
}
