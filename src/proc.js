// Starting/stopping the app under test and running shell hooks.
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';

export function runShell(cmd, { cwd, env = {}, logFile } = {}) {
  const r = spawnSync('bash', ['-c', cmd], {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (logFile) fs.appendFileSync(logFile, `$ ${cmd}\n${output}\n`);
  return { code: r.status ?? 1, output };
}

export function startApp(cmd, { cwd, env = {}, logFile }) {
  const fd = fs.openSync(logFile, 'a');
  const child = spawn('bash', ['-c', cmd], {
    cwd,
    env: { ...process.env, ...env },
    detached: true, // own process group, so we can kill npm and its children together
    stdio: ['ignore', fd, fd],
  });
  fs.closeSync(fd);
  return child;
}

export async function waitForHttp(url, { timeoutMs = 180_000, child } = {}) {
  const end = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < end) {
    if (child && child.exitCode !== null) {
      throw new Error(`app exited with code ${child.exitCode} before it answered ${url}`);
    }
    try {
      const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(2000) });
      await r.arrayBuffer().catch(() => {});
      return r.status; // any HTTP answer means the server is up
    } catch (e) {
      last = e.cause?.code ?? e.message;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`app did not answer ${url} within ${Math.round(timeoutMs / 1000)}s (${last})`);
}

export async function stopApp(child, { graceMs = 5000 } = {}) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((r) => child.once('exit', r));
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    return;
  }
  const t = setTimeout(() => {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {}
  }, graceMs);
  await exited;
  clearTimeout(t);
}

export function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export function resolveCommit(repo, ref) {
  return git(['rev-parse', '--verify', `${ref}^{commit}`], repo);
}

export function addWorktree(repo, sha, dir) {
  git(['worktree', 'add', '--detach', dir, sha], repo);
}

export function removeWorktree(repo, dir) {
  try {
    git(['worktree', 'remove', '--force', dir], repo);
  } catch {
    fs.rmSync(dir, { recursive: true, force: true });
    try {
      git(['worktree', 'prune'], repo);
    } catch {}
  }
}

export function changedFiles(repo, baseSha, headSha) {
  const out = git(['diff', '--name-only', `${baseSha}...${headSha}`], repo);
  return out ? out.split('\n') : [];
}

export function diffFullText(repo, baseSha, headSha) {
  return git(['diff', '--unified=0', `${baseSha}...${headSha}`], repo);
}
