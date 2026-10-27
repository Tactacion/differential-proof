# Differential proof: design

## The problem

On Replicas, agents verify their own work by driving a browser and attaching a recording or screenshots to the PR. Their CTO wrote that nobody on the team reads every diff anymore; they look at the proof instead (replicas.dev/blog/how-we-run-our-software-factory). Their recorder also speeds up idle time and zooms on clicks, so the proof is a highlight reel chosen by the agent.

Nothing checks that the behavior in the proof was caused by the diff. Two ways that goes wrong:

1. **Vacuous proof.** The proof shows something that already worked on main. Example: the bug is the Export button on Invoices, the agent changes and demos the Export button on Reports, which always worked. The video looks perfect.
2. **Unfalsifiable proof.** A video of clicks with no check at the end. It cannot fail, so it cannot prove anything.

Their own backlog experiment had a case like this (REP-434): asked to test, the agent tested the SDK in isolation and never checked the feature from the dashboard (replicas.dev/blog/we-gave-replicas-our-entire-backlog). The same post lists "a confidence signal at PR time" as something they want for deciding what to auto-merge.

## The idea

A test is only evidence if it could have failed. So the proof becomes a short replayable script that ends in an assertion, and we run it twice: on the base branch and on the PR, from the same starting state. The check passes only if the result changes the way the PR claims.

## Proof format

JSON, validated by `src/proof.js`:

```json
{
  "name": "Invoices export shows a ready file",
  "claim": "Clicking Export on the Invoices page now produces invoices.csv",
  "kind": "bugfix",
  "start_path": "/invoices",
  "steps": [
    { "action": "click", "target": { "role": "button", "name": "Export" } },
    { "action": "expect_text", "target": { "role": "status" }, "text": "Export ready: invoices.csv" }
  ]
}
```

- `kind`: `bugfix` (default), `feature`, or `refactor`. It changes what result we expect.
- Actions: `goto`, `click`, `fill`, `press`, `select`, `check`, and assertions `expect_visible`, `expect_hidden`, `expect_text`, `expect_url`, `expect_count`.
- Targets: exactly one of `role` (+ optional `name`), `label`, `text`, `testId`, `placeholder`; optional `exact`, `nth`.
- Rules: at least one assertion, and the last step must be one. Element refs are rejected. `goto` paths stay on the app.

These map one-to-one onto Replicas' own browser actions (`browser-click`, `browser-fill`, `browser-wait <text>`), so an agent that verified its work with `replicas computer` commands can write the same steps as a proof, using the role and name it saw in `browser-state` instead of the ref number.

## Verdicts

Each side runs `--runs` times (default 3). A run either passes, fails on an assertion, fails because a step could not run (`unreplayable`, e.g. the button doesn't exist), or breaks (`infra`).

| Base | PR | kind | Verdict | Check |
| --- | --- | --- | --- | --- |
| any infra error | or any infra error | any | INCONCLUSIVE | failure |
| any | flaky | any | INCONCLUSIVE | failure |
| any | fails | any | HEAD_FAILS | failure |
| passes | passes | bugfix / feature | VACUOUS | failure |
| flaky | passes | any | INCONCLUSIVE | failure |
| fails on an assertion | passes | bugfix / feature | PROVEN (behavior) | success |
| fails because a step can't run | passes | bugfix / feature | PROVEN (presence, weak) | success, with a warning |
| passes | passes | refactor | PRESERVED | success |
| fails | passes | refactor | BEHAVIOR_CHANGED | failure |

Why INCONCLUSIVE fails the check: as a required GitHub check, a pass means "safe to merge". If we don't know, a human should look.

Why "presence" is weak: if base can't even click the button, the proof shows the new UI exists, not that it does the right thing. For a bug fix this is suspicious, since fixing a bug usually shouldn't need new UI.

## Same starting state

The only difference between the two sides should be the diff.

- Both sides run one after the other, on the same port, with the same start command.
- `--reset "<cmd>"` runs before every run to restore data (re-seed the DB, clear files).
- In the browser: fixed start time (Playwright clock, time still moves), seeded `Math.random`, fixed viewport, locale, timezone, reduced motion, and requests to other hosts blocked.
- Not covered yet: `crypto.randomUUID` / `getRandomValues`, server-side clocks and randomness, and external APIs the server calls. These show up as flakiness, which the repeated runs catch and turn into INCONCLUSIVE.

On Replicas, both checkouts live inside one workspace that was claimed from the environment's warm snapshot, so dependencies and services start the same. Their docs say pool workspaces start from one snapshot but refresh some things at claim time, so don't assume two separate workspaces are byte-identical (see `docs/REPLICAS.md`).

## Which "base"?

- Default: the tip of the base branch (`--base main`). This answers "does the proof pass on main as it is today?", which is what matters for merging. If someone already fixed the bug on main, the proof correctly comes back VACUOUS.
- Better later: compare main's tip against GitHub's test merge commit (`refs/pull/<n>/merge`), which is what will actually land.

## Flakiness

A proof that gives different answers on the same code is not evidence. Each side runs several times; any disagreement means INCONCLUSIVE. Later: rerun only when results disagree, to save minutes.

## Diff coverage (M4)

Next to the verdict, the result carries `touchedChangedCode: yes | no | unknown` — whether the proof actually executed code this PR changed. On the PR side's first run, Playwright's JS coverage records which source ranges ran (count > 0, minus count-0 holes, per script); the added lines from `git diff --unified=0 base...head` are then matched into that executed text by content, since inline scripts generated by server code carry page URLs, not file paths (`src/coverage.js`, pure, unit-tested).

It is a signal, never a verdict: coverage failures or an empty diff degrade it to `unknown`. A PROVEN proof with `no` is suspicious; a VACUOUS proof with `no` explains itself. For server-only changes `no` is expected — the browser never sees that code.

## Not in v0 (see PLAN.md)

- Independent proof: a separate verifier agent writes the proof from the issue or PR description only, without the author's transcript. Then both an author-written and an independent proof must pass the differential check.
- Calibration: across many PRs, measure which verdicts predict a later revert or fix-up. That's the "confidence signal" for auto-merge.

## Reporting

`bin/diffproof.js run --report-check <checkRunId> --check-token <token>` calls `replicas automation check` with the verdict's conclusion, a one-line title, and the markdown summary. Replicas automations create the GitHub check in progress when the PR event lands, and only the agent's reported verdict completes it, so it is safe to make it required.
