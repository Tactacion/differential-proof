// Runs one proof against one running app, in a fresh browser context.
//
// Determinism controls (both sides get exactly the same ones):
//   - fixed start time via Playwright's clock API (time still moves forward)
//   - Math.random replaced with a seeded generator
//   - fixed viewport, locale, timezone, reduced motion
//   - requests to other hosts are blocked unless allowExternal is set
// Known gaps: crypto.getRandomValues / randomUUID are not seeded, and
// server-side randomness or clocks are outside the browser's control.

import { STEP_SPECS } from './proof.js';

const DEFAULTS = {
  seed: 42,
  fixedTime: '2026-01-01T09:00:00Z',
  timeoutMs: 10_000,
  allowExternal: false,
  videoDir: null,
};

export function seededRandomScript(seed) {
  // mulberry32
  return `(() => {
    let a = ${Number(seed) >>> 0};
    Math.random = function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();`;
}

export function resolveTarget(page, t) {
  let loc;
  const exact = Boolean(t.exact);
  if (t.role) loc = page.getByRole(t.role, t.name !== undefined ? { name: t.name, exact } : {});
  else if (t.label) loc = page.getByLabel(t.label, { exact });
  else if (t.text) loc = page.getByText(t.text, { exact });
  else if (t.testId) loc = page.getByTestId(t.testId);
  else if (t.placeholder) loc = page.getByPlaceholder(t.placeholder, { exact });
  else throw new Error('target has no locator');
  // No implicit .first(): if a target matches several elements, Playwright's
  // strict mode throws, which is what we want. Use "nth" to pick one on purpose.
  if (t.nth !== undefined) loc = loc.nth(t.nth);
  return loc;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pollUntil(check, timeoutMs, describe) {
  const end = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < end) {
    try {
      const { ok, detail } = await check();
      if (ok) return;
      last = detail ?? '';
    } catch (e) {
      last = firstLine(e.message);
    }
    await sleep(100);
  }
  throw new Error(`${describe}${last ? ` (last seen: ${last})` : ''}`);
}

function firstLine(s) {
  return String(s ?? '').split('\n')[0].slice(0, 300);
}

export async function executeStep(page, step, baseUrl, timeoutMs) {
  const t = STEP_SPECS[step.action]?.target ? resolveTarget(page, step.target) : null;
  switch (step.action) {
    case 'goto':
      await page.goto(new URL(step.path, baseUrl).toString(), { timeout: timeoutMs });
      return;
    case 'click':
      await t.click({ timeout: timeoutMs });
      return;
    case 'fill':
      await t.fill(String(step.value), { timeout: timeoutMs });
      return;
    case 'press':
      await page.keyboard.press(String(step.key));
      return;
    case 'select':
      await t.selectOption(String(step.value), { timeout: timeoutMs });
      return;
    case 'check':
      await t.check({ timeout: timeoutMs });
      return;
    case 'expect_visible':
      await t.waitFor({ state: 'visible', timeout: timeoutMs });
      return;
    case 'expect_hidden':
      await t.waitFor({ state: 'hidden', timeout: timeoutMs });
      return;
    case 'expect_text':
      await pollUntil(
        async () => {
          const text = (await t.textContent({ timeout: 1000 })) ?? '';
          return { ok: text.includes(String(step.text)), detail: JSON.stringify(text.trim().slice(0, 120)) };
        },
        timeoutMs,
        `expected text ${JSON.stringify(step.text)}`,
      );
      return;
    case 'expect_url': {
      const re = new RegExp(step.pattern);
      await pollUntil(async () => ({ ok: re.test(page.url()), detail: page.url() }), timeoutMs, `expected URL to match /${step.pattern}/`);
      return;
    }
    case 'expect_count':
      await pollUntil(
        async () => {
          const n = await t.count();
          return { ok: n === step.count, detail: `${n} elements` };
        },
        timeoutMs,
        `expected ${step.count} matching elements`,
      );
      return;
    default:
      throw new Error(`unknown action ${step.action}`);
  }
}

export async function runProof(browser, proof, opts) {
  const o = { ...DEFAULTS, ...opts };
  const baseUrl = o.baseUrl;
  const origin = new URL(baseUrl).origin;
  const startedAt = Date.now();
  const res = { ok: false, errorKind: null, error: null, steps: [], pageErrors: [], video: null, durationMs: 0 };

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'UTC',
    reducedMotion: 'reduce',
    ...(o.videoDir ? { recordVideo: { dir: o.videoDir, size: { width: 1280, height: 800 } } } : {}),
  });
  let page;
  try {
    await context.addInitScript({ content: seededRandomScript(o.seed) });
    if (!o.allowExternal) {
      await context.route('**/*', (route) => {
        const url = route.request().url();
        if (url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
        return route.abort();
      });
    }
    page = await context.newPage();
    await page.clock.install({ time: new Date(o.fixedTime) });
    page.on('pageerror', (e) => res.pageErrors.push(firstLine(e.message)));

    try {
      await page.goto(new URL(proof.start_path ?? '/', baseUrl).toString(), { timeout: o.timeoutMs });
    } catch (e) {
      res.errorKind = 'infra';
      res.error = `could not load ${proof.start_path ?? '/'}: ${firstLine(e.message)}`;
      return res;
    }

    for (let i = 0; i < proof.steps.length; i++) {
      const step = proof.steps[i];
      try {
        await executeStep(page, step, baseUrl, o.timeoutMs);
        res.steps.push({ index: i, action: step.action, ok: true });
      } catch (e) {
        const isAssert = Boolean(STEP_SPECS[step.action]?.assertion);
        res.steps.push({ index: i, action: step.action, ok: false, message: firstLine(e.message) });
        res.errorKind = isAssert ? 'assertion' : 'unreplayable';
        res.error = `step ${i + 1} (${step.action}): ${firstLine(e.message)}`;
        return res;
      }
    }
    res.ok = true;
    return res;
  } catch (e) {
    if (o.videoDir && /ffmpeg/i.test(e.message)) {
      // Video needs Playwright's ffmpeg ("npx playwright install ffmpeg").
      // Don't let a missing recorder turn into an infra failure.
      await context.close().catch(() => {});
      const again = await runProof(browser, proof, { ...o, videoDir: null });
      again.warnings = [...(again.warnings ?? []), 'video skipped: run "npx playwright install ffmpeg" to record'];
      return again;
    }
    res.ok = false;
    res.errorKind = 'infra';
    res.error = `browser error: ${firstLine(e.message)}`;
    return res;
  } finally {
    const video = page?.video?.() ?? null;
    await context.close().catch(() => {});
    if (video) res.video = await video.path().catch(() => null);
    res.durationMs = Date.now() - startedAt;
  }
}
