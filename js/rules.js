/* rules.js — pure game logic for ĐỌC VỊ. No DOM, no side effects.
 * Loads as a classic script (window.Rules) and as a CommonJS module (Node tests).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Rules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SAFE = 'safe';
  var OUT = 'out';
  var KEEP = 'keep';
  var SWAP = 'swap';

  var T = {
    PEEK_MS: 3000,
    TALK_MS: 45000,
    BONUS_MS: 15000,
    ALERT_MS: 10000,
    HOLD_PEEK_MS: 400,
    HOLD_DECIDE_MS: 700,
    HOLD_FINISH_MS: 700,
    HOLD_OVERRIDE_MS: 2000,
    MAX_TALK_MS: 5 * 60000
  };

  var PHASES = ['roles', 'peek', 'talk', 'decide', 'reveal'];
  var SCHEMA = 1;

  function getCrypto(c) {
    if (c && c.getRandomValues) return c;
    if (typeof self !== 'undefined' && self.crypto && self.crypto.getRandomValues) return self.crypto;
    if (typeof globalThis !== 'undefined' && globalThis.crypto && globalThis.crypto.getRandomValues) return globalThis.crypto;
    throw new Error('crypto.getRandomValues unavailable');
  }

  /* Uniform integer in [0, n) via rejection sampling on a 32-bit draw (no modulo bias). */
  function randomInt(n, c) {
    var cr = getCrypto(c);
    if (!(n > 0) || n > 0x100000000) throw new Error('bad range');
    var buf = new Uint32Array(1);
    var limit = 0x100000000 - (0x100000000 % n);
    for (;;) {
      cr.getRandomValues(buf);
      if (buf[0] < limit) return buf[0] % n;
    }
  }

  /* Exactly 50/50: one unbiased random bit. */
  function drawResult(c) {
    return randomInt(2, c) === 0 ? SAFE : OUT;
  }

  function opposite(r) {
    if (r === SAFE) return OUT;
    if (r === OUT) return SAFE;
    throw new Error('bad result');
  }

  /* deviceResult: what the device holds. choice: B's decision.
   * keep -> A holds the device; swap -> B holds it. The holder gets the device result,
   * the other player the opposite. Exactly one winner (the SAFE one). */
  function resolve(deviceResult, choice) {
    opposite(deviceResult);
    if (choice !== KEEP && choice !== SWAP) throw new Error('bad choice');
    var holder = choice === KEEP ? 'A' : 'B';
    var a = holder === 'A' ? deviceResult : opposite(deviceResult);
    var b = opposite(a);
    return { holder: holder, a: a, b: b, winner: a === SAFE ? 'A' : 'B', loser: a === SAFE ? 'B' : 'A' };
  }

  /* ---------- timer (timestamp based, drift-free) ---------- */
  function timerCreate(durMs) { return { dur: durMs, acc: 0, since: null }; }
  function timerRunning(t) { return t.since !== null; }
  function timerElapsed(t, now) { return t.acc + (t.since !== null ? Math.max(0, now - t.since) : 0); }
  function timerRemaining(t, now) { return Math.max(0, t.dur - timerElapsed(t, now)); }
  function timerStart(t, now) { return t.since !== null ? t : { dur: t.dur, acc: t.acc, since: now }; }
  function timerPause(t, now) { return t.since === null ? t : { dur: t.dur, acc: timerElapsed(t, now), since: null }; }
  function timerAdd(t, ms, now) {
    var rem = timerRemaining(t, now);
    var add = Math.max(0, Math.min(ms, T.MAX_TALK_MS - rem));
    return { dur: t.dur + add, acc: t.acc, since: t.since };
  }
  /* Whole seconds shown on screen (ceil so "45" shows at start and "1" until zero). */
  function displaySeconds(remMs) { return Math.ceil(remMs / 1000 - 1e-9); }

  /* ---------- storage codec ---------- */
  var KEY = 'đọc-vị/mind-game/v1';

  function utf8(s) { return unescape(encodeURIComponent(s)); }
  function deutf8(s) { return decodeURIComponent(escape(s)); }
  function b64(s) {
    if (typeof btoa === 'function') return btoa(s);
    return Buffer.from(s, 'binary').toString('base64');
  }
  function unb64(s) {
    if (typeof atob === 'function') return atob(s);
    return Buffer.from(s, 'base64').toString('binary');
  }
  function xor(s, key) {
    var out = '';
    for (var i = 0; i < s.length; i++) out += String.fromCharCode(s.charCodeAt(i) ^ key.charCodeAt(i % key.length) & 0xff);
    return out;
  }
  function randomHex(len, c) {
    var s = '';
    for (var i = 0; i < len; i++) s += randomInt(16, c).toString(16);
    return s;
  }
  /* Light obfuscation only: XOR with a fixed key, salted so the same result never encodes the same twice. */
  function encodeSecret(result, c) {
    opposite(result);
    var k = utf8(KEY);
    return b64(xor(randomHex(8, c) + '|' + result, k));
  }
  function decodeSecret(str) {
    try {
      if (typeof str !== 'string' || !str) return null;
      var plain = xor(unb64(str), utf8(KEY));
      var parts = plain.split('|');
      if (parts.length !== 2 || parts[0].length !== 8) return null;
      return parts[1] === SAFE || parts[1] === OUT ? parts[1] : null;
    } catch (e) { return null; }
  }

  function cleanName(s, fallback) {
    if (typeof s !== 'string') return fallback;
    var n = s.replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim();
    if (n.normalize) n = n.normalize('NFC');
    n = n.slice(0, 16).trim();
    return n || fallback;
  }

  /* Round state persisted to storage:
   * { v, phase, names:[n1,n2], round, a:0|1|null, s:encodedSecret, peekUsed, override, remain, choice } */
  function serialize(st, c) {
    var o = {
      v: SCHEMA,
      phase: st.phase,
      names: [st.names[0], st.names[1]],
      round: st.round,
      a: st.a,
      s: st.secret ? (st.secretEnc || encodeSecret(st.secret, c)) : null,
      peekUsed: !!st.peekUsed,
      override: !!st.override,
      remain: st.remain == null ? null : Math.round(st.remain),
      choice: st.choice || null,
      ts: typeof st.ts === 'number' ? st.ts : Date.now()
    };
    return JSON.stringify(o);
  }

  /* Returns a validated round state, or null if missing/corrupted. Never throws. */
  function parse(str) {
    try {
      if (typeof str !== 'string' || !str) return null;
      var o = JSON.parse(str);
      if (!o || typeof o !== 'object' || o.v !== SCHEMA) return null;
      if (PHASES.indexOf(o.phase) < 0) return null;
      if (!o.names || typeof o.names !== 'object' || typeof o.names.length !== 'number' || o.names.length !== 2) return null;
      var names = [cleanName(o.names[0], 'NGƯỜI CHƠI 1'), cleanName(o.names[1], 'NGƯỜI CHƠI 2')];
      var round = typeof o.round === 'number' && o.round >= 1 && o.round < 1000 ? Math.floor(o.round) : 1;
      var st = {
        phase: o.phase, names: names, round: round,
        a: null, secret: null, secretEnc: null, peekUsed: false, override: false, remain: null, choice: null,
        ts: typeof o.ts === 'number' && isFinite(o.ts) ? o.ts : 0
      };
      if (o.phase === 'roles') return st;
      if (o.a !== 0 && o.a !== 1) return null;
      var secret = decodeSecret(o.s);
      if (!secret) return null;
      st.a = o.a; st.secret = secret; st.secretEnc = o.s;
      st.override = !!o.override;
      st.peekUsed = o.phase === 'peek' ? !!o.peekUsed : true;
      if (o.phase === 'talk') {
        var r = typeof o.remain === 'number' && isFinite(o.remain) ? o.remain : T.TALK_MS;
        st.remain = Math.max(0, Math.min(T.MAX_TALK_MS, r));
      }
      if (o.phase === 'reveal') {
        if (o.choice !== KEEP && o.choice !== SWAP) return null;
        st.choice = o.choice;
      }
      return st;
    } catch (e) { return null; }
  }

  return {
    SAFE: SAFE, OUT: OUT, KEEP: KEEP, SWAP: SWAP, T: T, PHASES: PHASES, SCHEMA: SCHEMA,
    randomInt: randomInt, drawResult: drawResult, opposite: opposite, resolve: resolve,
    timerCreate: timerCreate, timerStart: timerStart, timerPause: timerPause, timerAdd: timerAdd,
    timerRemaining: timerRemaining, timerRunning: timerRunning, displaySeconds: displaySeconds,
    encodeSecret: encodeSecret, decodeSecret: decodeSecret, cleanName: cleanName,
    serialize: serialize, parse: parse
  };
});
