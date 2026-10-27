#!/usr/bin/env node
// diffproof: replay one proof on the base branch and on the PR, then decide.
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { validateProof, normalizeProof } from '../src/proof.js';
import { decide, formatSummary } from '../src/verdict.js';
import { runShell, startApp, waitForHttp, stopApp, resolveCommit, addWorktree, removeWorktree, changedFiles, diffFullText } from '../src/proc.js';
import { executedTexts, touchedChangedCode } from '../src/coverage.js';

const HELP = `diffproof — does the agent's proof fail on base and pass on the PR?

Usage:
  diffproof validate <proof.json>
  diffproof run --proof <proof.json> --start "<cmd>" [options]

Run options:
  --repo <dir>            git repository to test (default: .)
  --base <ref>            base branch or commit (default: main)
  --head <ref>            PR branch or commit (default: HEAD)
  --proof <file>          proof script (JSON), see docs/SPEC.md
  --start "<cmd>"         starts the app; it must listen on $PORT
  --setup "<cmd>"         run once in each checkout before starting (e.g. "npm ci")
  --reset "<cmd>"         run before every proof run to restore the same data
  --port <n>              port for the app (default: 4100); sides run one after the other
  --ready-path <path>     path polled until the app answers (default: proof start_path)
  --runs <n>              runs per side, to catch flakiness (default: 3)
  --seed <n>              Math.random seed, same on both sides (default: 42)
  --timeout <ms>          per-step timeout (default: 10000)
  --ready-timeout <ms>    how long to wait for the app (default: 180000)
  --video                 record the first run on each side (base.webm, head.webm)
  --out <dir>             where results go (default: .diffproof)
  --headed                show the browser
  --allow-external        let the page reach other hosts (blocked by default)
  --executable-path <p>   use a specific Chrome/Chromium binary
  --report-check <id>     report the verdict with "replicas automation check <id>"
  --check-token <token>   token for --report-check (comes from the automation prompt)
  --json                  print the result as JSON
  --keep-worktrees        don't delete the temporary checkouts

Exit code: 0 when the check passes, 1 when it fails, 2 for usage errors.`;

function die(msg, code = 2) {
  process.stderr.write(`diffproof: ${msg}\n`);
  process.exit(code);
}

function readProof(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    die(`cannot read proof ${file}: ${e.message}`);
  }
  let proof;
  try {
    proof = JSON.parse(raw);
  } catch (e) {
    die(`proof ${file} is not valid JSON: ${e.message}`);
  }
  const v = validateProof(proof);
  return { proof, v };
}

function cmdValidate(args) {
  const file = args[0];
  if (!file) die('validate needs a proof file');
  const { v } = readProof(file);
  if (v.ok) {
    process.stdout.write(`ok: ${file}\n`);
    return 0;
  }
  process.stdout.write(`invalid: ${file}\n${v.errors.map((e) => `  - ${e}`).join('\n')}\n`);
  return 1;
}

function int(name, value) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) die(`--${name} must be a non-negative integer`);
  return n;
}

async function cmdRun(argv) {
  let parsed;
  try {
    parsed = parseArgs({
    args: argv,
    options: {
      repo: { type: 'string', default: '.' },
      base: { type: 'string', default: 'main' },
      head: { type: 'string', default: 'HEAD' },
      proof: { type: 'string' },
      start: { type: 'string' },
      setup: { type: 'string' },
      reset: { type: 'string' },
      port: { type: 'string', default: '4100' },
      'ready-path': { type: 'string' },
      runs: { type: 'string', default: '3' },
      seed: { type: 'string', default: '42' },
      timeout: { type: 'string', default: '10000' },
      'ready-timeout': { type: 'string', default: '180000' },
      video: { type: 'boolean', default: false },
      out: { type: 'string', default: '.diffproof' },
      headed: { type: 'boolean', default: false },
      'allow-external': { type: 'boolean', default: false },
      'executable-path': { type: 'string' },
      'report-check': { type: 'string' },
      'check-token': { type: 'string' },
      json: { type: 'boolean', default: false },
      'keep-worktrees': { type: 'boolean', default: false },
    },
    allowPositionals: false,
    });
  } catch (e) {
    die(`${e.message}\nRun "diffproof --help" for options.`);
  }
  const a = parsed.values;
  if (!a.proof) die('--proof is required');
  if (!a.start) die('--start is required (the command that starts your app on $PORT)');
  if (a['report-check'] && !a['check-token']) die('--report-check needs --check-token');

  const { proof: rawProof, v } = readProof(a.proof);
  if (!v.ok) die(`invalid proof:\n${v.errors.map((e) => `  - ${e}`).join('\n')}`);
  const proof = normalizeProof(rawProof);

  const repo = path.resolve(a.repo);
  const runs = Math.max(1, int('runs', a.runs));
  const port = int('port', a.port);
  const seed = int('seed', a.seed);
  const timeoutMs = int('timeout', a.timeout);
  const readyTimeoutMs = int('ready-timeout', a['ready-timeout']);
  const baseUrl = `http://127.0.0.1:${port}`;
  const readyPath = a['ready-path'] ?? proof.start_path ?? '/';

  let baseSha, headSha;
  try {
    baseSha = resolveCommit(repo, a.base);
    headSha = resolveCommit(repo, a.head);
  } catch (e) {
    die(`could not resolve refs in ${repo}: ${String(e.stderr || e.message).trim()}`);
  }
  if (baseSha === headSha) die(`base and head are the same commit (${baseSha.slice(0, 8)}); nothing to compare`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.resolve(a.out, stamp);
  fs.mkdirSync(outDir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'diffproof-'));
  const sides = [
    { name: 'base', ref: a.base, sha: baseSha, dir: path.join(tmp, 'base'), runs: [] },
    { name: 'head', ref: a.head, sha: headSha, dir: path.join(tmp, 'head'), runs: [] },
  ];

  let browser = null;
  let app = null;
  const cleanup = async () => {
    await stopApp(app).catch(() => {});
    await browser?.close().catch(() => {});
    if (!a['keep-worktrees']) {
      for (const s of sides) removeWorktree(repo, s.dir);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  };
  const onSignal = async () => {
    await cleanup();
    process.exit(130);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  try {
    for (const s of sides) addWorktree(repo, s.sha, s.dir);

    const { chromium } = await import('playwright');
    const { runProof } = await import('../src/runner.js');
    browser = await chromium.launch({
      headless: !a.headed,
      ...(a['executable-path'] ? { executablePath: a['executable-path'] } : {}),
    });

    // Sides run one after the other on the same port, so the app config and
    // any shared state (DB, files) are identical. --reset restores data.
    for (const s of sides) {
      const log = path.join(outDir, `${s.name}.app.log`);
      const infraFail = (msg) => {
        for (let i = 0; i < runs; i++) s.runs.push({ ok: false, errorKind: 'infra', error: msg });
      };
      if (a.setup) {
        const r = runShell(a.setup, { cwd: s.dir, logFile: log });
        if (r.code !== 0) {
          infraFail(`setup failed on ${s.name} (exit ${r.code}); see ${log}`);
          continue;
        }
      }
      app = startApp(a.start, { cwd: s.dir, env: { PORT: String(port) }, logFile: log });
      try {
        await waitForHttp(baseUrl + readyPath, { timeoutMs: readyTimeoutMs, child: app });
      } catch (e) {
        infraFail(`${e.message}; see ${log}`);
        await stopApp(app);
        app = null;
        continue;
      }
      for (let i = 0; i < runs; i++) {
        if (a.reset) {
          const r = runShell(a.reset, { cwd: s.dir, logFile: log });
          if (r.code !== 0) {
            s.runs.push({ ok: false, errorKind: 'infra', error: `reset failed (exit ${r.code}); see ${log}` });
            continue;
          }
        }
        const videoDir = a.video && i === 0 ? path.join(outDir, `${s.name}-video`) : null;
        // Coverage is collected on the PR side's first run only: the question
        // is whether the proof exercises the code this PR changed.
        const collectCoverage = s.name === 'head' && i === 0;
        const res = await runProof(browser, proof, { baseUrl, seed, timeoutMs, videoDir, collectCoverage, allowExternal: a['allow-external'] });
        if (res.video) {
          const dest = path.join(outDir, `${s.name}.webm`);
          try {
            fs.renameSync(res.video, dest);
            res.video = dest;
          } catch {}
        }
        s.runs.push(res);
      }
      await stopApp(app);
      app = null;
    }
  } finally {
    await cleanup();
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }

  const [base, head] = sides;
  const decision = decide({ base: base.runs, head: head.runs, kind: proof.kind });
  const firstErr = (s) => s.runs.find((r) => !r.ok)?.error;
  const meta = {
    claim: proof.claim,
    baseRef: `${base.ref} @ ${base.sha.slice(0, 8)}`,
    headRef: `${head.ref} @ ${head.sha.slice(0, 8)}`,
    firstErrors: { base: firstErr(base), head: firstErr(head) },
  };
  let changed = [];
  try {
    changed = changedFiles(repo, base.sha, head.sha);
  } catch {}
  let touched = 'unknown';
  try {
    const entries = head.runs.find((r) => r.coverage)?.coverage ?? null;
    touched = touchedChangedCode({
      texts: entries ? executedTexts(entries) : null,
      diff: diffFullText(repo, base.sha, head.sha),
    });
  } catch {}
  for (const s of sides) for (const r of s.runs) delete r.coverage;
  const coverageNote = {
    yes: 'The proof executed code this PR changed.',
    no: 'The proof never executed a line this PR changed (expected for server-only changes; otherwise the proof may not test this PR).',
    unknown: 'Whether the proof executed the changed code could not be determined.',
  }[touched];
  const summary = `${formatSummary(decision, meta)}\n- Diff coverage: ${coverageNote} (touchedChangedCode: ${touched})`;
  const result = {
    verdict: decision.verdict,
    strength: decision.strength,
    conclusion: decision.conclusion,
    title: decision.title,
    reasons: decision.reasons,
    proof: { file: path.resolve(a.proof), name: proof.name, claim: proof.claim, kind: proof.kind },
    base: { ref: base.ref, sha: base.sha, summary: decision.sides.base, runs: base.runs },
    head: { ref: head.ref, sha: head.sha, summary: decision.sides.head, runs: head.runs },
    changedFiles: changed,
    touchedChangedCode: touched,
    settings: { runs, seed, port, timeoutMs },
    outDir,
  };
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(outDir, 'summary.md'), summary + '\n');

  if (a['report-check']) {
    const r = spawnSync(
      'replicas',
      ['automation', 'check', a['report-check'], '--token', a['check-token'], '--conclusion', decision.conclusion, '--title', decision.title, '--summary', summary],
      { encoding: 'utf8' },
    );
    if (r.status !== 0) process.stderr.write(`diffproof: reporting the check failed: ${r.stderr || r.error?.message || r.status}\n`);
  }

  process.stdout.write(a.json ? JSON.stringify(result, null, 2) + '\n' : `${summary}\n\nResults: ${outDir}\n`);
  return decision.conclusion === 'success' ? 0 : 1;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') {
    process.stdout.write(HELP + '\n');
    return 0;
  }
  if (cmd === 'validate') return cmdValidate(rest);
  if (cmd === 'run') return cmdRun(rest);
  die(`unknown command "${cmd}". Try --help.`);
}

main().then(
  (code) => process.exit(code ?? 0),
  (e) => die(e?.stack ?? String(e), 1),
);
