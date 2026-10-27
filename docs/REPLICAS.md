# What we know about Replicas

Checked against their public docs on 2026-10-27. Anything marked **verify** is not confirmed; test it before building on it.

## Account and money

- Free trial: $100 of usage, no card, no time limit. When it runs out, new workspaces are blocked and running ones are suspended (state kept). (docs.replicas.dev/admin/billing)
- The $100 pays for workspace minutes only. Model usage runs on your own Claude/ChatGPT subscription or API key; Replicas doesn't resell model usage. (replicas.dev/pricing)
- Rates per awake minute: small (2 vCPU, 8 GB) $0.004 included / $0.006 overage; large (4 vCPU, 16 GB) $0.008 / $0.012; ultra (8 vCPU, 32 GB) $0.016 / $0.024. One-minute minimum per session, including wake-ups. Sleeping and archived workspaces cost nothing.
- Workspaces sleep after 30 idle minutes. API- and automation-created workspaces delete themselves when the agent finishes unless `lifecycle_policy` says otherwise. (docs.replicas.dev/changelog, week of Oct 10, 2026)

## Setup

- CLI: `npm install -g replicas-cli`, then `replicas login` (browser) or `replicas login --api-key`. Inside a workspace the CLI is already authenticated as that workspace. (docs.replicas.dev/features/cli)
- Connect Claude Code with your subscription: `replicas claude-auth`. (docs.replicas.dev/quickstart)
- API keys: personal key under Personal → API Keys (acts as you). Trial orgs can create keys after onboarding. (docs.replicas.dev/features/api)
- Adding a repository creates an environment for it. (quickstart)

## Environments, hooks, snapshots

- `replicas.yaml` at the repo root:

  ```yaml
  warmHook:
    timeout: 300000        # ms per command; default 60 min, max 120
    commands:
      - npm ci
  startHook:
    timeout: 300000        # default 5 min, max 15
    commands:
      - npm run dev
  ```

- Warm hooks run ahead of time; a snapshot joins the pool only after the warm hook succeeds. Start hooks run when a workspace starts, before the agent. (docs.replicas.dev/features/environments)
- Pool workspaces start from one snapshot, but some things are refreshed at claim time (skill registries, start hook, prompts, MCPs). Don't assume two workspaces are byte-identical. That's why diffproof runs both sides inside one workspace.
- Docker is installed but starts on demand: add `sudo service docker start && until docker info >/dev/null 2>&1; do sleep 0.2; done` to a start hook. (docs.replicas.dev/features/workspaces/overview)
- Long-running services: `replicas service start web "<cmd>"` survives the turn ending and sleep/wake. (CLI docs)
- **verify**: there is no documented way to start a workspace on a specific branch or commit through the API. Workaround used here: one workspace, two git worktrees.
- Workspace clones only have `main` checked out; `git fetch origin <branch>` updates `FETCH_HEAD` and `origin/<branch>` but creates no local branch, so bare branch names don't resolve for diffproof. Use `origin/<branch>` refs (as the automation prompt does) or create local branches first. (hit in the diffproof-m1 run, 2026-10-27)
- A workspace created right after saving a warm hook can be claimed from a pre-hook snapshot and miss the hook's work (happened with diffproof-m1). Give the pool time to re-warm, or have the agent fall back to installing by hand.
- Confirmed 2026-10-27: `npx playwright install --with-deps chromium ffmpeg` works in a warm hook (ran via `replicas env warm-hooks save-test` on the diffproof-demo environment, exit 0). The fallback of pointing `--executable-path` at the workspace desktop's Chrome was not needed.

## Browser and proof tools inside a workspace

- `replicas computer browser-state [path] [--full]`: accessibility tree with `[ref=N]` handles. Refs reset when the page navigates, so they can't be replayed elsewhere.
- `replicas computer browser-click --ref <n>`, `browser-fill --ref <n> <value>`, `browser-batch '<json>'` (up to 100 actions: click, fill, drag, key, type, scroll, wait), `browser-wait <text>`.
- `replicas computer record start <path>` / `record stop`: an MP4 that speeds up idle time and zooms on clicks.
- `replicas media upload before.png after.png --name "Before" --name "After"`; `replicas media gif <recording> --start 2 --duration 6` makes a looping GIF under GitHub's 5 MiB limit. Confirmed 2026-10-27: `media upload` accepts `.webm` directly (diffproof-m1 workspace). **verify**: whether `media gif` accepts `.webm` or needs `.mp4` first.
- `replicas preview create <port>` exposes a port on a preview URL.
- `replicas exec <id> -- <command>` from outside has a 50-second max timeout, too short for a full run. Run diffproof from inside the workspace (agent or terminal) instead.

## Automations and required checks

- Create: `replicas automation create "<name>" --prompt "<...>" --environment <env> --trigger-github pull_request.opened --github-checks "Differential Proof" --size small --lifecycle archive_when_done`. (CLI docs)
- **verify**: the exact event name for "PR updated (new commits)" in `--trigger-github` (likely `pull_request.synchronize`); run `replicas automation create --help`.
- The check is created in progress as soon as the PR event lands, and only the agent's reported verdict completes it. Repeat events on the same commit reuse the check. A run that dies is reported as a failure. So it's safe to mark it required in a GitHub ruleset. (docs.replicas.dev/features/automations)
- The agent is told which check runs it owns and a token. It reports with: `replicas automation check <checkRunId> --token <token> --conclusion success --title "..." --summary "..."`.
- **verify**: accepted `--conclusion` values besides `success` (we use `success` and `failure`).
- Read-only: setting `config.capabilities.read_only_contents: true` (API) gives the automation a token that can comment and report checks but can't push. Good for a checker. **verify**: CLI flag for it.
- The PR's repository, number and URL are injected into the prompt for PR triggers.
- Automations are available on every plan; trial has no automation count limit. Min cron interval 60 minutes (irrelevant here).

## Terms

- Their automations doc says automations and the public API are the only sanctioned ways to use Replicas programmatically, and driving the app, Slack, Linear, GitHub or the CLI from scripts is prohibited. Their CLI doc says scripts, CI and agents can drive the CLI. Stay on the safe side: automations, the API, and the CLI from inside workspaces.

## People

- Connor Loi (CEO), Saai Arora (CTO). Contact: founders@replicas.dev. Template suggestions go to founders@replicas.dev per the automations docs.
