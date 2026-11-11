/* Animation pass + performance check.
 *   node tests/perf.js          writes frame strips to shots/frames-*.png and prints frame timing
 * Part 1 captures frame sequences of key moments (reel, peek, timer alert, decision, reveal).
 * Part 2 replays the reveal under 4x CPU throttling and measures rAF frame gaps. */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const serve = require('./serve.js');
const ROOT = path.join(__dirname, '..');
const SHOTS = path.resolve(process.env.SHOTS || path.join(ROOT, 'shots'));
fs.mkdirSync(SHOTS, { recursive: true });
const URL = 'http://localhost:8127/';

async function toDecide(page, force) {
  await page.goto(URL);
  await page.waitForFunction(() => window.__docvi && window.__docvi.phase() === 'home');
  await page.click('#bStart');
  await page.waitForFunction(() => window.__docvi.phase() === 'roles' && !window.__docvi.busy());
}
async function hold(page, sel, ms) {
  const b = await page.locator(sel).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.waitForTimeout(ms); await page.mouse.up();
}
async function frames(page, name, count, every) {
  const files = [];
  for (let i = 0; i < count; i++) {
    const f = path.join(SHOTS, 'frame-' + name + '-' + String(i).padStart(2, '0') + '.png');
    await page.screenshot({ path: f }); files.push(f);
    await page.waitForTimeout(every);
  }
  return files;
}

(async () => {
  const srv = await serve(8127);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  await ctx.addInitScript(() => { crypto.getRandomValues = function (a) { a.fill(1); return a; }; });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await toDecide(page);
  // reel
  await page.click('#bSpin');
  await frames(page, 'reel', 10, 180);
  await page.waitForFunction(() => !document.getElementById('bGive').disabled);
  await page.click('#bGive');
  await page.waitForFunction(() => window.__docvi.phase() === 'peek' && !window.__docvi.busy());
  await page.waitForTimeout(500);
  // peek open + slam
  const b = await page.locator('#bPeek').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.waitForTimeout(450);
  await frames(page, 'peek', 4, 60);
  await page.waitForTimeout(2400);
  await frames(page, 'slam', 6, 50);
  await page.mouse.up();
  await page.waitForFunction(() => window.__docvi.phase() === 'peek' && !window.__docvi.busy());
  await page.click('#bTalk');
  await page.waitForFunction(() => window.__docvi.phase() === 'talk' && !window.__docvi.busy());
  // jump to the last 10 s: pause, then fast-forward by reloading with remain 11 s is not exposed; use +/- via waiting instead
  await page.evaluate(() => {
    const k = 'docvi.round.v1'; const o = JSON.parse(localStorage.getItem(k)); o.remain = 11500; localStorage.setItem(k, JSON.stringify(o));
    window.removeEventListener('pagehide', () => {});
  });
  await page.evaluate(() => { const o = JSON.parse(localStorage.getItem('docvi.round.v1')); window.__seed = o; });
  // reload resumes paused at the stored remaining time; pagehide would overwrite it, so seed via init script
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem('ff')) return;
    sessionStorage.setItem('ff', '1');
    const k = 'docvi.round.v1';
    const once = () => { try { const o = JSON.parse(localStorage.getItem(k)); if (o && o.phase === 'talk') { o.remain = 11500; localStorage.setItem(k, JSON.stringify(o)); } } catch (e) {} };
    once();
  });
  await page.reload();
  await page.waitForFunction(() => window.__docvi && window.__docvi.phase() === 'talk' && !window.__docvi.busy());
  await page.waitForTimeout(400);
  await page.click('#bPause');
  await page.waitForTimeout(1300);
  await frames(page, 'alert', 8, 120);
  await page.waitForFunction(() => window.__docvi.phase() === 'decide' && !window.__docvi.busy(), null, { timeout: 20000 });
  await page.waitForTimeout(600);
  // decision charge + confirm
  const c = await page.locator('.choice[data-c="swap"]').boundingBox();
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2); await page.mouse.down();
  await frames(page, 'charge', 4, 150);
  await page.mouse.up();
  await frames(page, 'confirm', 4, 90);
  await page.waitForTimeout(900);
  await frames(page, 'reveal', 22, 140);
  await page.waitForFunction(() => window.__docvi.phase() === 'result' && !window.__docvi.busy());
  console.log('frames written; page errors: ' + errs.length);

  // ---- part 2: throttled reveal timing ----
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const p2 = await ctx2.newPage();
  await toDecide(p2);
  await p2.click('.chip[data-i="0"]');
  await p2.waitForFunction(() => !document.getElementById('bGive').disabled);
  await p2.click('#bGive');
  await p2.waitForFunction(() => window.__docvi.phase() === 'peek' && !window.__docvi.busy());
  await hold(p2, '#bPeek', 600);
  await p2.waitForFunction(() => window.__docvi.phase() === 'peek' && !window.__docvi.busy());
  await p2.click('#bTalk');
  await p2.waitForFunction(() => window.__docvi.phase() === 'talk' && !window.__docvi.busy());
  await hold(p2, '#bEnd', 900);
  await p2.waitForFunction(() => window.__docvi.phase() === 'decide' && !window.__docvi.busy());
  await p2.waitForTimeout(500);
  const cdp = await ctx2.newCDPSession(p2);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await p2.evaluate(() => {
    window.__fr = []; let last = performance.now();
    (function loop(t) { window.__fr.push(t - last); last = t; if (window.__fr.length < 2000) requestAnimationFrame(loop); })(performance.now());
  });
  await hold(p2, '.choice[data-c="keep"]', 900);
  await p2.waitForFunction(() => window.__docvi.phase() === 'result' && !window.__docvi.busy(), null, { timeout: 30000 });
  await p2.waitForTimeout(800);
  const fr = await p2.evaluate(() => window.__fr.slice(2));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  fr.sort((a, b) => a - b);
  const pct = q => fr[Math.min(fr.length - 1, Math.floor(fr.length * q))].toFixed(1);
  const long = fr.filter(x => x > 50).length;
  console.log('reveal @4x CPU: frames=' + fr.length + ' p50=' + pct(0.5) + 'ms p95=' + pct(0.95) + 'ms max=' + fr[fr.length - 1].toFixed(1) + 'ms >50ms=' + long);
  await browser.close(); srv.close();
  process.exit(long > 2 ? 1 : 0);
})();
