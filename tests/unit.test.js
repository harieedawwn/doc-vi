/* Node unit tests for js/rules.js — no framework. Run: node tests/unit.test.js */
'use strict';
var R = require('../js/rules.js');
var webcrypto = require('crypto').webcrypto;

var passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.stack || e)); }
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'expected equal') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }

console.log('rules');

test('keep + device SAFE -> A wins', function () {
  var r = R.resolve(R.SAFE, R.KEEP);
  eq(r.holder, 'A'); eq(r.a, R.SAFE); eq(r.b, R.OUT); eq(r.winner, 'A'); eq(r.loser, 'B');
});
test('keep + device OUT -> B wins', function () {
  var r = R.resolve(R.OUT, R.KEEP);
  eq(r.holder, 'A'); eq(r.a, R.OUT); eq(r.b, R.SAFE); eq(r.winner, 'B'); eq(r.loser, 'A');
});
test('swap + device SAFE -> B wins', function () {
  var r = R.resolve(R.SAFE, R.SWAP);
  eq(r.holder, 'B'); eq(r.b, R.SAFE); eq(r.a, R.OUT); eq(r.winner, 'B');
});
test('swap + device OUT -> A wins', function () {
  var r = R.resolve(R.OUT, R.SWAP);
  eq(r.holder, 'B'); eq(r.b, R.OUT); eq(r.a, R.SAFE); eq(r.winner, 'A');
});
test('every combination has exactly one winner', function () {
  [R.SAFE, R.OUT].forEach(function (d) {
    [R.KEEP, R.SWAP].forEach(function (c) {
      var r = R.resolve(d, c);
      eq([r.a, r.b].filter(function (x) { return x === R.SAFE; }).length, 1);
      ok(r.winner !== r.loser);
    });
  });
});
test('bad inputs throw', function () {
  var threw = 0;
  try { R.resolve('maybe', R.KEEP); } catch (e) { threw++; }
  try { R.resolve(R.SAFE, 'flip'); } catch (e) { threw++; }
  eq(threw, 2);
});

test('100,000 draws are 50/50 within 1%', function () {
  var n = 100000, safe = 0;
  for (var i = 0; i < n; i++) if (R.drawResult(webcrypto) === R.SAFE) safe++;
  var p = safe / n;
  console.log('       safe ratio = ' + p.toFixed(4));
  ok(Math.abs(p - 0.5) < 0.01, 'ratio ' + p);
});
test('draw uses crypto.getRandomValues (never Math.random)', function () {
  var orig = Math.random, calls = 0;
  Math.random = function () { throw new Error('Math.random used'); };
  try {
    var fake = { getRandomValues: function (a) { calls++; a[0] = 7; return a; } };
    eq(R.drawResult(fake), R.OUT); // 7 % 2 = 1 -> OUT
    ok(calls >= 1);
  } finally { Math.random = orig; }
});
test('randomInt(2) is unbiased at boundaries', function () {
  var vals = [0, 1, 0xfffffffe, 0xffffffff], i = 0;
  var fake = { getRandomValues: function (a) { a[0] = vals[i++]; return a; } };
  eq(R.randomInt(2, fake), 0); eq(R.randomInt(2, fake), 1); eq(R.randomInt(2, fake), 0); eq(R.randomInt(2, fake), 1);
});

test('timer counts from timestamps and pauses', function () {
  var t = R.timerStart(R.timerCreate(45000), 1000);
  eq(R.displaySeconds(R.timerRemaining(t, 1000)), 45);
  eq(R.displaySeconds(R.timerRemaining(t, 1001)), 45);
  eq(R.displaySeconds(R.timerRemaining(t, 2000)), 44);
  t = R.timerPause(t, 11000);
  eq(R.timerRemaining(t, 99999), 35000);
  t = R.timerAdd(t, 15000, 99999);
  eq(R.timerRemaining(t, 0), 50000);
  t = R.timerStart(t, 200000);
  eq(R.timerRemaining(t, 260000), 0);
  eq(R.displaySeconds(0), 0);
});

console.log('storage');

function sample(phase, extra) {
  var st = { phase: phase, names: ['LAN', 'MINH'], round: 3, a: 1, secret: R.SAFE, peekUsed: true, override: false, remain: 21000, choice: R.SWAP };
  for (var k in extra) st[k] = extra[k];
  return st;
}
test('round-trips every phase', function () {
  R.PHASES.forEach(function (p) {
    var back = R.parse(R.serialize(sample(p), webcrypto));
    ok(back, p); eq(back.phase, p); eq(back.names[1], 'MINH'); eq(back.round, 3);
    if (p !== 'roles') { eq(back.secret, R.SAFE); eq(back.a, 1); }
  });
  eq(R.parse(R.serialize(sample('talk'), webcrypto)).remain, 21000);
  eq(R.parse(R.serialize(sample('reveal'), webcrypto)).choice, R.SWAP);
});
test('secret is not stored in plain text and is salted', function () {
  var s1 = R.serialize(sample('talk', { secret: R.OUT }), webcrypto);
  var s2 = R.serialize(sample('talk', { secret: R.OUT }), webcrypto);
  ok(!/"(safe|out)"/.test(s1.replace(/"choice":"swap"/, '')), 'plain secret visible: ' + s1);
  ok(s1.indexOf('safe') < 0 && s1.indexOf('"out"') < 0);
  ok(JSON.parse(s1).s !== JSON.parse(s2).s, 'salt');
  eq(R.decodeSecret(JSON.parse(s1).s), R.OUT);
});
test('peek phase keeps peekUsed so reload never re-reveals', function () {
  var back = R.parse(R.serialize(sample('peek', { peekUsed: true }), webcrypto));
  eq(back.peekUsed, true);
});
test('corrupted storage recovers to null without throwing', function () {
  var good = R.serialize(sample('talk'), webcrypto);
  var bad = [
    undefined, null, '', '{', 'null', '[]', '42', '"str"', '{"v":2}', '{"v":1,"phase":"hack"}',
    '{"v":1,"phase":"talk","names":["a"]}',
    '{"v":1,"phase":"talk","names":["a","b"],"a":5,"s":"x"}',
    good.replace(/"s":"[^"]*"/, '"s":"!!!notbase64"'),
    good.replace(/"s":"[^"]*"/, '"s":"' + Buffer.from('zzzz').toString('base64') + '"'),
    good.replace(/"s":"[^"]*"/, '"s":12'),
    good.replace(/"choice":"swap"/, '"choice":"x"').replace('"phase":"talk"', '"phase":"reveal"'),
    good.slice(0, good.length / 2),
    '\u0000￿ garbage'
  ];
  bad.forEach(function (s) { eq(R.parse(s), null, 'input ' + JSON.stringify(s)); });
});
test('corrupted fields are sanitized', function () {
  var raw = JSON.parse(R.serialize(sample('talk'), webcrypto));
  raw.remain = 'abc'; raw.round = -4; raw.names = ['<b>x</b>', 7];
  var back = R.parse(JSON.stringify(raw));
  eq(back.remain, R.T.TALK_MS); eq(back.round, 1); eq(back.names[0], 'bx/b'); eq(back.names[1], 'NGƯỜI CHƠI 2');
});
test('cleanName trims, caps length and falls back', function () {
  eq(R.cleanName('   ', 'X'), 'X');
  eq(R.cleanName('  Ngọc   Ánh ', 'X'), 'Ngọc Ánh');
  eq(R.cleanName('abcdefghijklmnopqrstuvwxyz', 'X').length, 16);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
