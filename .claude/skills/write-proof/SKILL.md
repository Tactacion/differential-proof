---
name: write-proof
description: Write a differential proof (JSON) for a code change or bug report, so it fails on the base branch and passes on the fixed branch. Use when a PR or issue needs a proof file.
argument-hint: [issue, PR description, or branch name]
---

Write a proof for: $ARGUMENTS

1. Read `src/proof.js` for the exact format and rules.
2. Work out the claim in one sentence: what a user can see or do after the change that they could not before. Write it in the proof's `claim` field.
3. Pick `kind`: `bugfix`, `feature`, or `refactor` (behavior must stay the same).
4. Make the proof reproduce the original problem, not just exercise the new code. The final step must be an assertion that fails on the old behavior. Ask yourself: "would this exact script also pass on main?" If yes, it is vacuous; change it.
5. Use semantic targets only: `{ "role": "button", "name": "Export" }`, `label`, `text`, `testId`, `placeholder`. Prefer role + name. Never use element refs.
6. Keep it short: usually 2–6 steps.
7. Save it under `.proofs/<short-name>.json` (or where the user says) and run `node bin/diffproof.js validate <file>`.
8. If you can, run it with the `/diffproof` skill to confirm it comes back PROVEN.
