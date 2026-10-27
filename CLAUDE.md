# differential-proof

AI coding agents attach a browser recording to their PR as "proof", and teams now merge on that proof instead of reading the diff. The proof is made by the same agent that wrote the code, so it can show something that already worked before the PR. This tool replays the proof on the base branch and on the PR, and the check passes only if the proof fails on base and passes on the PR.

The goal is a working demo on Replicas (a cloud coding-agent platform): a required GitHub check that catches a vacuous proof, plus a before/after video, to show their founders.

## Status

- Done and tested: proof format + validator (`src/proof.js`), verdict logic (`src/verdict.js`, 23 unit tests), CLI that checks out base and head as git worktrees, starts the app, replays the proof in Playwright and decides (`bin/diffproof.js`), toy demo repo with three scenarios.
- The demo was run end to end in real Chromium: real fix → PROVEN, fake fix with its own proof → VACUOUS, fake fix with the honest proof → HEAD_FAILS.
- Not yet done: running inside Replicas, the automation + required check, coverage signal, independent verifier. See `docs/PLAN.md` for the order.

## Commands

```bash
npm install && npx playwright install chromium ffmpeg   # once
npm test                                               # unit tests, no browser needed
npm run demo -- --video                                # builds .demo-repo and runs all 3 scenarios
node bin/diffproof.js validate <proof.json>
node bin/diffproof.js run --repo <repo> --base main --head <branch> --proof <proof.json> --start "npm start" [--setup "npm ci"] [--reset "<cmd>"] [--video]
```

Results go to `.diffproof/<timestamp>/` (`result.json`, `summary.md`, `base.webm`, `head.webm`, app logs). Exit code 0 = check passes.

## Layout

- `src/proof.js`: proof schema. Read it before writing or changing proof files.
- `src/verdict.js`: pure decision logic. The only place verdicts are decided.
- `src/runner.js`: Playwright replay with determinism controls.
- `src/proc.js`: git worktrees, starting and stopping the app, shell hooks.
- `bin/diffproof.js`: CLI.
- `demo/`: toy app generator, demo proofs, demo runner.
- `docs/SPEC.md`: design and verdict table. `docs/PLAN.md`: milestones. `docs/REPLICAS.md`: what we know about Replicas, with sources and open questions. `docs/RESEARCH.md`: methods from papers and other tools. `docs/automation-prompt.md`: the prompt for the Replicas automation.

## Rules

- Verdicts are decided only in `src/verdict.js`, which stays pure (no I/O). Every new verdict or branch gets a unit test in `test/verdict.test.js`. Run `npm test` after any change there.
- An infra problem (app didn't start, browser crashed) must never become PROVEN or VACUOUS. When unsure, return INCONCLUSIVE, which fails the check and sends it to a human.
- Proof targets are semantic: `{ "role", "name" }`, `label`, `text`, `testId`, `placeholder`. Never store element refs such as `[ref=42]` from `replicas computer browser-state`: they reset on navigation and don't exist on another VM.
- Base and head must start from the same state: same data (`--reset`), same clock, same `Math.random` seed. Sides run one after the other on the same port. Don't parallelize them without solving shared state first.
- Before relying on any Replicas behavior, check `docs/REPLICAS.md`. Facts there link to their docs; anything marked "verify" is unconfirmed, so test it with `--help` or a small run before building on it.
- Replicas: use only the API, automations and the CLI. Their docs say driving the app, Slack, Linear or GitHub from scripts is against their Terms.
- Never commit API keys or check tokens. `REPLICAS_API_KEY` lives in `.env`, which is gitignored.
- Keep output plain: verdict, one-line reason, the two videos. The reader is a busy engineer deciding whether to merge.
