# differential-proof

AI coding agents attach a video or screenshots to their pull request as proof that the change works. But the proof is made by the same agent that wrote the code, so it can show something that already worked before the PR.

`diffproof` replays the proof on the base branch and on the PR, from the same starting state. The check passes only if the proof **fails on base and passes on the PR**.

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
