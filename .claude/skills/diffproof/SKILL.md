---
name: diffproof
description: Run a differential proof check between two git refs and explain the verdict. Use when asked to check whether a proof really shows what a PR changed.
argument-hint: [repo] [base] [head] [proof.json] [start command]
---

Run the differential proof check and report the result plainly.

Arguments (in order, ask for any that are missing): repo path, base ref, head ref, proof file, start command. Given: $ARGUMENTS

1. Validate the proof first: `node bin/diffproof.js validate <proof>`. If it fails, show the errors and stop.
2. Run `node bin/diffproof.js run --repo <repo> --base <base> --head <head> --proof <proof> --start "<start>" --video`. Add `--setup "npm ci"` if the repo has a lockfile and no `node_modules`.
3. Read `summary.md` and `result.json` from the results folder it prints.
4. Reply with: the verdict, one sentence on why, where the two videos are, and, if the result is INCONCLUSIVE, the first error from each side and what to try next (more runs, a `--reset` command, `--allow-external`).

Never change `src/verdict.js` to make a result come out differently.
