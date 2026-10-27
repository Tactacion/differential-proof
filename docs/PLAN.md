# Plan

Each milestone ends with something you can show. Don't start the next one until the current one's "done when" is true.

## M0: local demo (done in the kit, re-run on your machine)

- `npm install && npx playwright install chromium ffmpeg`
- `npm test` → 23 passing.
- `npm run demo -- --video` → PROVEN, VACUOUS, HEAD_FAILS, in that order, with `base.webm` / `head.webm` in each result folder.

Done when: all three verdicts match and the videos play.

## M1: run it inside a Replicas workspace

1. Push this repo to GitHub as `differential-proof`.
2. Push the demo app as its own repo: `bash demo/make-demo-repo.sh ../diffproof-demo`, then create `diffproof-demo` on GitHub and push all three branches (`git push -u origin main fix-invoice-export fake-fix`).
3. In Replicas, add the `diffproof-demo` repo (this creates its environment).
4. Add a warm hook to that environment that installs the checker:

   ```bash
   git clone https://github.com/<you>/differential-proof ~/diffproof
   cd ~/diffproof && npm ci && npx playwright install --with-deps chromium
   ```

   If the Playwright download fails there, try pointing `--executable-path` at the Chrome that ships with the workspace desktop.
5. Start a workspace on that environment and ask the agent to run the three demo scenarios against the demo repo and upload the before/after videos with `replicas media`.

Done when: the same three verdicts come back from inside a workspace, and you know the real cost per run (check billing).

## M2: a required GitHub check on the demo repo

1. Create the automation with the prompt in `docs/automation-prompt.md` (CLI or app). Use a read-only repository token if you can.
2. In the `diffproof-demo` GitHub repo, add a ruleset that requires the `Differential Proof` check on `main`.
3. Open PR A from `fix-invoice-export` with `demo/proofs/invoices-export.json` in its description → green check.
4. Open PR B from `fake-fix` with `demo/proofs/reports-export.json` → red check, "Vacuous proof: it also passes on base", merge blocked.

Done when: PR B is blocked by the check and its comment shows before/after GIFs that look the same.

## M3: the money shot (this is what goes in the email)

- Open a GitHub issue on `diffproof-demo`: "Export does nothing on the Invoices page".
- Tag Replicas on it and let a real agent fix it and write the proof. Whatever it does, the check shows its real verdict.
- Record a 10–15 second screen capture: the PR, the red or green check, the before/after GIFs side by side. Make the GIF.
- Stretch: run the same thing on a real open-source app (they benchmarked memory on Next.js, ClickHouse, Grafana, Supabase and PostHog repos).

Done when: you have one GIF that a stranger understands without reading anything.

## M4: diff coverage (strengthens the verdict)

Record which JS files the proof actually ran on the PR side (Playwright `page.coverage.startJSCoverage()` in Chromium) and compare with `git diff --name-only`. Add `touchedChangedCode: yes | no | unknown` to `result.json` and the summary. A PROVEN proof that never ran the changed code is suspicious; a VACUOUS proof that never ran it explains why.

Done when: unit tests cover the mapping, and the demo shows `yes` for the honest proof and `no` for the reports proof.

## M5: independent proof

Add a second proof written by a separate verifier that only sees the issue or PR description, never the author's transcript (`.claude/agents/proof-skeptic.md` is a starting point locally; in Replicas this would be a separate automation). Both proofs must come back PROVEN.

## M6: confidence signal (research angle)

Log every verdict with what happened to the PR later (merged, reverted, fixed up). The question: which verdicts predict a later revert? That is the PR-time confidence signal Replicas said they want for auto-merge.
