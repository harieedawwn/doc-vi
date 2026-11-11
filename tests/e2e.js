/* End-to-end tests with Playwright (no test runner).
 *   node tests/e2e.js            full suite
 *   SHOTS=dir node tests/e2e.js  where to write screenshots (default: shots/)
 * Plays full rounds (both results × both choices) on six viewports, audits layout on every key
 * screen, pixel-diffs the secret screens across results, tests reload at every step and file://.
 * Results are forced by stubbing crypto.getRandomValues in the page (test only). */
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const serve = require('./serve.js');

const ROOT = path.join(__dirname, '..');
const SHOTS = path.resolve(process.env.SHOTS || path.join(ROOT, 'shots'));
const PORT = 8125;
const URL = 'http://localhost:' + PORT + '/';
const ALL_VPS = [[360, 640], [375, 667], [390, 844], [430, 932], [768, 1024], [844, 390]];
const VPS = process.env.VPS === "none" ? [] : process.env.VPS ? ALL_VPS.filter(v => process.env.VPS.split(",").indexOf(v.join("x")) >= 0) : ALL_VPS;
const DIACRITICS = 'Ặ Ữ Ỗ Ị ĐỔI MÁY BỊ LOẠI AN TOÀN NGƯỜI CHƠI';

let failures = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { failures++; console.log('  FAIL ' + msg); } }
function log(m) { console.log(m); }
fs.mkdirSync(SHOTS, { recursive: true });

async function newPage(browser, vp, force) {
  const land = vp[0] > vp[1];
  const ctx = await browser.newContext({ viewport: { width: vp[0], height: vp[1] }, hasTouch: true, isMobile: vp[0] < 700 || land, deviceScaleFactor: 1 });
  // Simulated notch / home indicator so safe-area handling is exercised.
  const sa = land ? { top: 0, bottom: 21, left: 44, right: 44 } : vp[0] < 700 ? { top: 44, bottom: 34, left: 0, right: 0 } : { top: 24, bottom: 20, left: 0, right: 0 };
  await ctx.addInitScript(([f, sa]) => {
    if (f !== null) crypto.getRandomValues = function (a) { a.fill(f); return a; };
    document.addEventListener('DOMContentLoaded', () => {
      const s = document.createElement('style');
      s.textContent = ':root{--sat:' + sa.top + 'px;--sab:' + sa.bottom + 'px;--sal:' + sa.left + 'px;--sar:' + sa.right + 'px}';
      document.head.appendChild(s);
    });
  }, [force, sa]);
  const page = await ctx.newPage();
  page.__errors = [];
  page.on('console', m => { if (m.type() === 'error') page.__errors.push(m.text()); });
  page.on('pageerror', e => page.__errors.push('pageerror: ' + e.message));
  page.__sa = sa; page.__vp = vp;
  return { ctx, page };
}

async function settle(page, name, extra) {
  await page.waitForFunction(n => window.__docvi && window.__docvi.phase() === n && !window.__docvi.busy(), name, { timeout: 15000 });
  await page.waitForTimeout(extra == null ? 900 : extra);
}

/* Layout audit: overflow, clipped text, safe areas, touch target size. */
async function audit(page, label) {
  const issues = await page.evaluate((sa) => {
    const W = innerWidth, H = innerHeight, out = [];
    const de = document.documentElement;
    if (de.scrollWidth > W + 1) out.push('page scrollWidth ' + de.scrollWidth + ' > ' + W);
    if (window.scrollY || window.scrollX) out.push('page scrolled');
    const skip = el => el.closest('.radar, .wipe, .edges, .flash, svg, .strip, [hidden]');
    const vis = el => { const cs = getComputedStyle(el); return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.05; };
    const all = Array.from(document.querySelectorAll('#app *')).filter(el => !skip(el) && vis(el));
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const id = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '');
      if (r.left < -1 || r.right > W + 1) out.push('h-overflow ' + id + ' [' + Math.round(r.left) + ',' + Math.round(r.right) + ']');
      const hasText = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
      if (hasText) {
        if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) out.push('clipped text ' + id + ' "' + el.textContent.trim().slice(0, 30) + '" ' + el.scrollWidth + '>' + el.clientWidth);
        if (r.top < -1 || r.bottom > H + 1) out.push('v-overflow text ' + id);
      }
      if (el.matches('button') && el.scrollWidth > el.clientWidth + 2) out.push('button overflow ' + id + ' ' + el.scrollWidth + '>' + el.clientWidth);
      if (el.matches('button, input')) {
        if (r.top < sa.top - 1 || r.bottom > H - sa.bottom + 1 || r.left < sa.left - 1 || r.right > W - sa.right + 1) out.push('in safe area ' + id + ' ' + JSON.stringify([r.left, r.top, r.right, r.bottom].map(Math.round)));
        if (Math.min(r.width, r.height) < 44) out.push('small target ' + id + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      }
    }
    // text overlap between sibling text blocks in the stage (cheap check on big text)
    const big = Array.from(document.querySelectorAll('#stage .big, #stage .btn, #stage .lbl')).filter(e => vis(e) && !skip(e));
    for (let i = 0; i < big.length; i++) for (let j = i + 1; j < big.length; j++) {
      const a = big[i], b = big[j];
      if (a.contains(b) || b.contains(a)) continue;
      const p = a.getBoundingClientRect(), q = b.getBoundingClientRect();
      const ox = Math.min(p.right, q.right) - Math.max(p.left, q.left), oy = Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top);
      if (ox > 4 && oy > 4) out.push('overlap ' + a.className + ' / ' + b.className);
    }
    return out;
  }, page.__sa);
  ok(issues.length === 0, label + ': ' + issues.slice(0, 6).join(' | '));
}

async function shot(page, file) {
  const p = path.join(SHOTS, file);
  await page.screenshot({ path: p });
  return fs.readFileSync(p);
}

async function holdOn(page, sel, ms) {
  const b = await page.locator(sel).boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

const SECRET_WORDS = /AN TOÀN|BỊ LOẠI/;
async function noLeak(page, label) {
  const t = await page.evaluate(() => document.body.innerText + ' ' + (document.getElementById('peekLayer').innerHTML));
  ok(!SECRET_WORDS.test(t), label + ': result text present in DOM');
  const st = await page.evaluate(() => JSON.stringify(localStorage));
  ok(!/\\"(safe|out)\\"/.test(st.replace(/\\"choice\\":\\"(keep|swap)\\"/, '')), label + ': plain secret in storage');
}

/* Plays one full round; returns screenshots of the secret screens for diffing. */
async function round(browser, vp, force, choice, tag, names) {
  const { ctx, page } = await newPage(browser, vp, force);
  const pre = vp.join('x') + '-' + tag;
  await page.goto(URL);
  await settle(page, 'home', 1300);
  const fontsOk = await page.evaluate(async (s) => {
    await document.fonts.ready;
    await Promise.all([document.fonts.load('900 40px BVP', s), document.fonts.load('800 40px BVP', s), document.fonts.load('700 20px JBM', s)]);
    return document.fonts.check('900 40px BVP', s) && document.fonts.check('700 20px JBM', s) &&
      Array.from(document.fonts).filter(f => f.status === 'loaded' && /1EA0/i.test(f.unicodeRange)).length >= 2;
  }, DIACRITICS);
  ok(fontsOk, pre + ': Vietnamese font faces loaded');
  await audit(page, pre + ' home');
  await shot(page, pre + '-0-home.png');
  if (names) { await page.fill('#n1', names[0]); await page.fill('#n2', names[1]); }
  await page.click('#bStart');
  await settle(page, 'roles');
  await audit(page, pre + ' roles');
  await page.click('.chip[data-i="0"]');
  await page.waitForFunction(() => !document.getElementById('bGive').disabled);
  await page.waitForTimeout(700);
  await audit(page, pre + ' roles picked');
  await shot(page, pre + '-1-roles.png');
  await page.click('#bGive');
  await settle(page, 'peek');
  await noLeak(page, pre + ' peek locked');
  await audit(page, pre + ' peek');
  const lockPre = await shot(page, pre + '-2-peek-lock.png');
  // open
  const b = await page.locator('#bPeek').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(1300);
  await shot(page, pre + '-3-peek-open.png');
  const openWord = await page.evaluate(() => { const w = document.querySelector('#peekLayer .w'); const r = w.getBoundingClientRect(); return { t: w.textContent, wr: r.width / innerWidth, l: r.left, rr: r.right }; });
  ok(openWord.t === (force === 0 ? 'AN TOÀN' : 'BỊ LOẠI'), pre + ': peek shows forced result');
  ok(openWord.wr > 0.66 && openWord.wr < 0.86 && openWord.l >= 0 && openWord.rr <= vp[0], pre + ': result word ~70-80% width (' + openWord.wr.toFixed(2) + ')');
  await page.waitForTimeout(2600); // past 3 s: must lock while still holding
  const stillOpen = await page.evaluate(() => !!document.querySelector('#peekLayer .res'));
  ok(!stillOpen, pre + ': peek auto-locks at 3 s while holding');
  await page.mouse.up();
  await settle(page, 'peek', 1200);
  await noLeak(page, pre + ' post-lock');
  await audit(page, pre + ' post-lock');
  const lockPost = await shot(page, pre + '-4-peek-post.png');
  ok(await page.locator('#bTalk').count() === 1, pre + ': post-lock shows start button');
  await page.click('#bTalk');
  await settle(page, 'talk', 1400);
  await noLeak(page, pre + ' talk');
  await audit(page, pre + ' talk');
  await shot(page, pre + '-5-talk.png');
  // pause, +15, resume
  await page.click('#bPause');
  await page.waitForTimeout(300);
  const d1 = await page.textContent('.digits');
  await page.waitForTimeout(1200);
  ok(d1 === await page.textContent('.digits'), pre + ': pause holds the timer');
  await page.click('#bAdd');
  await page.waitForTimeout(300);
  ok(+await page.textContent('.digits') === +d1 + 15, pre + ': +15S adds 15 s');
  await page.click('#bPause');
  // center taps do nothing
  await page.mouse.click(vp[0] / 2, vp[1] / 2);
  ok(await page.evaluate(() => window.__docvi.phase()) === 'talk', pre + ': center tap is inert');
  await holdOn(page, '#bEnd', 950);
  await settle(page, 'decide', 1000);
  await noLeak(page, pre + ' decide');
  await audit(page, pre + ' decide');
  const decideShot = await shot(page, pre + '-6-decide.png');
  // a short press must not commit
  await holdOn(page, '.choice[data-c="' + choice + '"]', 250);
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => window.__docvi.phase()) === 'decide', pre + ': short press does not commit');
  await holdOn(page, '.choice[data-c="' + choice + '"]', 900);
  await page.waitForTimeout(450);
  await shot(page, pre + '-7-confirm.png');
  await settle(page, 'result', 1200);
  await audit(page, pre + ' result');
  await shot(page, pre + '-8-result.png');
  const res = await page.evaluate(() => ({ win: document.querySelector('.result .nmbox').innerText.replace(/\s+/g, ' ').trim(), lose: document.querySelector('.loser .ln').textContent }));
  // device result × choice → expected winner (A = player 1 since chip 0 was picked)
  const n = names || ['NGƯỜI CHƠI 1', 'NGƯỜI CHƠI 2'];
  const aSafe = (force === 0) === (choice === 'keep');
  const expWin = (aSafe ? n[0] : n[1]).toLocaleUpperCase('vi-VN');
  ok(res.win === expWin, pre + ': winner ' + res.win + ' expected ' + expWin);
  // next round goes back to roles with same names
  await page.click('#bAgain');
  await settle(page, 'roles', 400);
  ok(/VÁN 02/.test(await page.textContent('#roundLabel')), pre + ': round counter advances');
  ok(page.__errors.length === 0, pre + ': console errors: ' + page.__errors.join(' | '));
  await ctx.close();
  return { lockPre, lockPost, decideShot };
}

async function diffPng(a, b) {
  if (a.equals(b)) return 0;
  // Decode in a page to count differing pixels.
  const br = await chromium.launch();
  const p = await br.newPage();
  const n = await p.evaluate(async ([x, y]) => {
    const load = s => new Promise(r => { const i = new Image(); i.onload = () => r(i); i.src = 'data:image/png;base64,' + s; });
    const [i1, i2] = await Promise.all([load(x), load(y)]);
    const c = document.createElement('canvas'); c.width = i1.width; c.height = i1.height; const g = c.getContext('2d');
    g.drawImage(i1, 0, 0); const d1 = g.getImageData(0, 0, c.width, c.height).data;
    g.clearRect(0, 0, c.width, c.height); g.drawImage(i2, 0, 0); const d2 = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 0; i < d1.length; i += 4) if (d1[i] !== d2[i] || d1[i + 1] !== d2[i + 1] || d1[i + 2] !== d2[i + 2]) n++;
    return n;
  }, [a.toString('base64'), b.toString('base64')]);
  await br.close();
  return n;
}

async function reloadSuite(browser, force) {
  const vp = [390, 844], tag = 'reload-' + (force === 0 ? 'safe' : 'out');
  const { ctx, page } = await newPage(browser, vp, force);
  const phase = () => page.evaluate(() => window.__docvi.phase());
  await page.goto(URL);
  await settle(page, 'home', 300);
  await page.click('#bStart'); await settle(page, 'roles', 300);
  await page.reload(); await settle(page, 'roles', 300);
  ok(true, '');
  await page.click('.chip[data-i="1"]'); await page.waitForFunction(() => !document.getElementById('bGive').disabled);
  await page.click('#bGive'); await settle(page, 'peek', 300);
  await page.reload(); await settle(page, 'peek', 300);
  ok(await page.locator('#bPeek').count() === 1, tag + ': reload before peek keeps hold-to-view');
  // reload while the result is visible
  const b = await page.locator('#bPeek').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.waitForTimeout(1000);
  ok(await page.evaluate(() => !!document.querySelector('#peekLayer .res')), tag + ': peek open');
  await page.reload(); await page.mouse.up();
  await settle(page, 'peek', 600);
  ok(await page.locator('#bTalk').count() === 1 && await page.locator('#bPeek').count() === 0, tag + ': reload during peek -> locked, no re-reveal');
  await noLeak(page, tag + ' after peek reload');
  // hidden tab during peek locks immediately
  await page.click('#bTalk'); await settle(page, 'talk', 2600);
  const before = +await page.textContent('.digits');
  await page.reload(); await settle(page, 'talk', 1500);
  const after = +await page.textContent('.digits');
  ok(await page.evaluate(() => document.querySelector('.talk').classList.contains('paused')), tag + ': reload during timer -> paused');
  ok(Math.abs(after - before) <= 1 && after < 45, tag + ': remaining time kept (' + before + ' -> ' + after + ')');
  await page.waitForTimeout(1200);
  ok(+await page.textContent('.digits') === after, tag + ': stays paused');
  await noLeak(page, tag + ' talk reload');
  await page.click('#bPause'); await page.waitForTimeout(200);
  await holdOn(page, '#bEnd', 950); await settle(page, 'decide', 300);
  await page.reload(); await settle(page, 'decide', 300);
  await noLeak(page, tag + ' decide reload');
  await holdOn(page, '.choice[data-c="keep"]', 900);
  await page.waitForTimeout(500);
  await page.reload(); await settle(page, 'result', 600);
  ok(await phase() === 'result', tag + ': reload during reveal -> result');
  await page.click('#bPeople'); await settle(page, 'home', 300);
  ok(await page.locator('#bResume').count() === 0, tag + ': ĐỔI NGƯỜI clears the round');
  // tab hidden during peek locks immediately
  await page.click('#bStart'); await settle(page, 'roles', 300);
  await page.click('.chip[data-i="0"]'); await page.waitForFunction(() => !document.getElementById('bGive').disabled);
  await page.click('#bGive'); await settle(page, 'peek', 300);
  {
    const bp = await page.locator('#bPeek').boundingBox();
    await page.mouse.move(bp.x + bp.width / 2, bp.y + bp.height / 2); await page.mouse.down();
    await page.waitForTimeout(900);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(50);
    ok(!await page.evaluate(() => !!document.querySelector('#peekLayer .res')), tag + ': hidden tab locks peek instantly');
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.mouse.up();
    await settle(page, 'peek', 300);
    ok(await page.locator('#bTalk').count() === 1, tag + ': after hidden tab the peek is spent');
  }
  // home -> resume an unfinished round
  await page.click('#btnHome'); await settle(page, 'home', 300);
  ok(await page.locator('#bResume').count() === 1, tag + ': home shows TIẾP TỤC VÁN');
  await page.click('#bResume'); await settle(page, 'peek', 300);
  ok(await page.locator('#bTalk').count() === 1, tag + ': resume lands on locked peek');
  await page.click('#btnHome'); await settle(page, 'home', 300);
  // host override: 2 s hold on round label gives one extra peek on the post-lock screen
  await page.click('#bStart'); await settle(page, 'roles', 300);
  await page.click('.chip[data-i="0"]'); await page.waitForFunction(() => !document.getElementById('bGive').disabled);
  await page.click('#bGive'); await settle(page, 'peek', 300);
  await holdOn(page, '#bPeek', 700); await settle(page, 'peek', 600);
  const lb = await page.locator('#roundLabel').boundingBox();
  await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2); await page.mouse.down();
  await page.waitForTimeout(1000);
  ok(!await page.evaluate(() => !!document.querySelector('#peekLayer .res')), tag + ': no override before 2 s');
  await page.waitForTimeout(1400);
  ok(await page.evaluate(() => !!document.querySelector('#peekLayer .res')), tag + ': override opens after 2 s');
  await page.mouse.up(); await settle(page, 'peek', 600);
  await page.mouse.move(lb.x + lb.width / 2, lb.y + lb.height / 2); await page.mouse.down();
  await page.waitForTimeout(2600);
  ok(!await page.evaluate(() => !!document.querySelector('#peekLayer .res')), tag + ': override only once');
  await page.mouse.up();
  // visibility hidden during peek → locks
  ok(page.__errors.length === 0, tag + ': console errors: ' + page.__errors.join(' | '));
  await ctx.close();
}

/* Corrupted or hostile storage must land on Home without errors. */
async function corruptSuite(browser) {
  const bad = ['{', 'null', '[]', '{"v":1,"phase":"talk","names":["a","b"],"a":0,"s":"%%%"}', '{"v":1,"phase":"reveal","names":["a","b"],"a":0,"s":"AAAA","choice":"swap"}', '\u0000garbage'];
  for (const v of bad) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(val => { if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.setItem('docvi.round.v1', val); localStorage.setItem('docvi.names.v1', '{bad'); } }, v);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
    await page.goto(URL);
    await settle(page, 'home', 200);
    ok(errs.length === 0 && await page.locator('#bResume').count() === 0, 'corrupt storage ' + JSON.stringify(v).slice(0, 30) + ' -> clean home ' + errs.join('|'));
    await ctx.close();
  }
  // storage that throws (blocked cookies / private mode)
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('SecurityError'); } });
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.goto(URL);
  await settle(page, 'home', 200);
  await page.click('#bStart'); await settle(page, 'roles', 200);
  await page.click('.chip[data-i="0"]'); await page.waitForFunction(() => !document.getElementById('bGive').disabled);
  await page.click('#bGive'); await settle(page, 'peek', 200);
  ok(errs.length === 0, 'throwing localStorage: playable with memory fallback ' + errs.join('|'));
  await ctx.close();
}

async function fileSuite(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => errs.push(e.message));
  await page.goto('file://' + path.join(ROOT, 'index.html'));
  await settle(page, 'home', 600);
  await page.click('#bStart'); await settle(page, 'roles', 300);
  await page.click('#bSpin'); await page.waitForFunction(() => !document.getElementById('bGive').disabled, null, { timeout: 8000 });
  await page.click('#bGive'); await settle(page, 'peek', 300);
  await shot(page, 'file-protocol-peek.png');
  const ff = await page.evaluate(s => document.fonts.check('900 40px BVP', s), DIACRITICS);
  ok(ff, 'file://: fonts load');
  ok(errs.length === 0, 'file://: console errors: ' + errs.join(' | '));
  await ctx.close();
}

(async () => {
  const srv = await serve(PORT);
  const browser = await chromium.launch();
  const t0 = Date.now();
  try {
    log('rounds on ' + VPS.length + ' viewports');
    await Promise.all(VPS.map(async (vp) => {
      const names = vp[0] === 390 ? ['Ngọc Ánh', 'Đức Ữỗ Ặị'] : null;
      const safeKeep = await round(browser, vp, 0, 'keep', 'safe-keep', names);
      const outSwap = await round(browser, vp, 1, 'swap', 'out-swap', names);
      const safeSwap = await round(browser, vp, 0, 'swap', 'safe-swap', names);
      const outKeep = await round(browser, vp, 1, 'keep', 'out-keep', names);
      const lockDiff = await diffPng(safeKeep.lockPost, outSwap.lockPost);
      ok(lockDiff === 0, vp.join('x') + ': post-peek lock screen differs between results (' + lockDiff + ' px)');
      const preDiff = await diffPng(safeKeep.lockPre, outKeep.lockPre);
      ok(preDiff === 0, vp.join('x') + ': pre-peek lock screen differs between results (' + preDiff + ' px)');
      const decDiff = await diffPng(safeSwap.decideShot, outKeep.decideShot);
      ok(decDiff === 0, vp.join('x') + ': decision screen differs between results (' + decDiff + ' px)');
      log('  done ' + vp.join('x'));
    }));
    log('reload suite');
    await Promise.all([reloadSuite(browser, 0), reloadSuite(browser, 1)]);
    log('corrupt storage suite');
    await corruptSuite(browser);
    log('file:// suite');
    await fileSuite(browser);
  } catch (e) {
    failures++; console.log('  FAIL exception: ' + (e && e.stack || e));
  } finally {
    await browser.close(); srv.close();
  }
  log('\n' + (checks - failures) + '/' + checks + ' checks passed in ' + Math.round((Date.now() - t0) / 1000) + 's' + (failures ? ' — ' + failures + ' FAILED' : ''));
  process.exit(failures ? 1 : 0);
})();
