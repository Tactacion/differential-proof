#!/usr/bin/env node
// Collect every Differential/Independent Proof verdict on a repo's PRs and
// what later happened to each PR (merged, closed, reverted). Append-safe:
// re-running refreshes the outcome columns, so the log can answer the M6
// question — which verdicts predict a later revert? — once there is data.
//
// Usage: node bin/verdict-log.js <owner/repo> [--out verdicts.jsonl]
// Needs the gh CLI, authenticated.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const CHECKS = ['Differential Proof', 'Independent Proof'];

function gh(args) {
  return JSON.parse(execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
}

function main() {
  const [repo, ...rest] = process.argv.slice(2);
  if (!repo || !repo.includes('/')) {
    process.stderr.write('usage: verdict-log <owner/repo> [--out verdicts.jsonl]\n');
    process.exit(2);
  }
  const out = rest[0] === '--out' && rest[1] ? rest[1] : 'verdicts.jsonl';

  const prs = gh(['pr', 'list', '--repo', repo, '--state', 'all', '--limit', '200', '--json',
    'number,title,state,mergedAt,closedAt,headRefOid,url']);

  // Best-effort revert detection: default-branch commits whose message names a
  // revert of the PR or of its merge commit.
  let defaultBranchLog = '';
  try {
    defaultBranchLog = execFileSync('gh', ['api', `repos/${repo}/commits?per_page=100`, '--jq',
      '[.[].commit.message] | join("\\n---\\n")'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  } catch {}

  const rows = [];
  for (const pr of prs) {
    let runs = [];
    try {
      runs = gh(['api', `repos/${repo}/commits/${pr.headRefOid}/check-runs`, '--jq', '.check_runs'])
        .filter((r) => CHECKS.includes(r.name));
    } catch {}
    const reverted = pr.mergedAt
      ? /revert/i.test(defaultBranchLog) && new RegExp(`#${pr.number}\\b`).test(defaultBranchLog)
      : false;
    for (const r of runs) {
      rows.push({
        repo,
        pr: pr.number,
        pr_url: pr.url,
        sha: pr.headRefOid,
        check: r.name,
        conclusion: r.conclusion,
        title: r.output?.title ?? null,
        pr_state: pr.state,
        merged_at: pr.mergedAt,
        closed_at: pr.closedAt,
        reverted_later: reverted,
        collected_at: new Date().toISOString(),
      });
    }
  }
  fs.writeFileSync(out, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  process.stdout.write(`${rows.length} verdict rows for ${prs.length} PRs -> ${out}\n`);
}

main();
