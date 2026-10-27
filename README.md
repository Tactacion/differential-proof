# differential-proof

AI coding agents attach a video or screenshots to their pull request as proof that the change works, and teams merge on that proof instead of reading the diff. But the proof is made by the same agent that wrote the code, so it can show something that already worked before the PR. `diffproof` replays the proof on the base branch and on the PR, from the same starting state, and a required GitHub check passes only if the proof **fails on base and passes on the PR**.

![demo](demo.gif) <!-- TODO: 10–15s capture of PR #2 (blocked) next to PR #4 (green) -->

See it live on the demo repo:

- [PR #2 — fake fix, **blocked**](https://github.com/Tactacion/diffproof-demo/pull/2): the agent's proof also passes on `main` ("Vacuous proof"), and its before/after GIFs look identical.
- [PR #4 — real agent fix, **both checks green**](https://github.com/Tactacion/diffproof-demo/pull/4): a Replicas agent fixed [issue #3](https://github.com/Tactacion/diffproof-demo/issues/3) and wrote its own proof; the check replayed it (PROVEN), and an independent verifier's proof, written from the issue alone, came back PROVEN too.

## Use it as a Replicas automation

The checks above run as [Replicas](https://replicas.dev) automations triggered on `pull_request.opened` / `.synchronize`: the agent finds the proof in the PR, runs `diffproof`, and `diffproof` reports the GitHub check itself — the agent never decides the verdict. The exact prompts for both automations (Differential Proof, and the M5 Independent Proof verifier) are in [`docs/automation-prompt.md`](docs/automation-prompt.md); a warm hook that preinstalls the checker is in [`docs/PLAN.md`](docs/PLAN.md) (M1).

```
=== fix-invoice-export + invoices-export.json ===
## differential-proof: PROVEN          ← real fix, honest proof

=== fake-fix + reports-export.json ===
## differential-proof: VACUOUS         ← "fix" whose proof also passes on main

=== fake-fix + invoices-export.json ===
## differential-proof: HEAD_FAILS      ← the bug is still there
```

## Quick start

Needs Node 18+ and git.

```bash
npm install
npx playwright install chromium ffmpeg
npm test
npm run demo -- --video
```

Results and the before/after videos land in `.diffproof/`.

## Use it on your own repo

1. Write a proof (see `docs/SPEC.md`, or the `/write-proof` skill in Claude Code).
2. Run:

```bash
node bin/diffproof.js run --repo ../my-app --base main --head my-branch \
  --proof proofs/my-fix.json --setup "npm ci" --start "npm run dev" --video
```

Your app must listen on `$PORT`.

## Working on this with Claude Code

Open this folder in a terminal and run `claude`. It reads `CLAUDE.md` automatically. Useful starts:

- "Run M0 from docs/PLAN.md and tell me if all three verdicts match."
- "/write-proof the Export button on Invoices does nothing"
- "Start M4 from docs/PLAN.md. Write the tests first."

## Docs

- `docs/SPEC.md`: design, proof format, verdict table
- `docs/PLAN.md`: milestones from local demo to a required check on Replicas
- `docs/REPLICAS.md`: what's confirmed about Replicas, with sources and open questions
- `docs/automation-prompt.md`: prompt for the Replicas automation
- `docs/RESEARCH.md`: related methods from papers and other tools
