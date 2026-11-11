/* audio.js — synthesized sound design for ĐỌC VỊ (Web Audio, no files).
 * Master bus: voices -> dry/reverb -> glue compressor -> brickwall limiter -> destination.
 * Every sound is layered: a transient, a low-end body, and an optional tail.
 * Sounds used during secret phases take no result-dependent parameters, so they are identical.
 */
(function (w) {
  'use strict';
  var AC = w.AudioContext || w.webkitAudioContext;

  var ctx = null, bus = null, muted = false, unlocked = false;
  var noiseBuf = null, pinkBuf = null, curveSoft = null, curveHard = null;

  function makeNoise(c, pink) {
    var len = Math.floor(c.sampleRate * 2), buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    // Deterministic LCG so noise is identical every session (and never touches Math.random).
    var seed = 22222;
    for (var i = 0; i < len; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      var white = seed / 2147483648 - 1;
      if (pink) {
        b0 = 0.99886 * b0 + white * 0.0555179; b1 = 0.99332 * b1 + white * 0.0750759; b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856; b4 = 0.55 * b4 + white * 0.5329522; b5 = -0.7616 * b5 - white * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11; b6 = white * 0.115926;
      } else d[i] = white;
    }
    return buf;
  }
  /* Generated impulse response: short, dark studio room with a few early reflections. */
  function makeIR(c, seconds, decay) {
    var len = Math.floor(c.sampleRate * seconds), buf = c.createBuffer(2, len, c.sampleRate);
    var seed = 777;
    for (var ch = 0; ch < 2; ch++) {
      var d = buf.getChannelData(ch), lp = 0;
      for (var i = 0; i < len; i++) {
        seed = (seed * 1103515245 + 12345) >>> 0;
        var n = seed / 2147483648 - 1, t = i / c.sampleRate;
        lp += (n - lp) * (0.6 - 0.45 * Math.min(1, t / seconds));
        d[i] = lp * Math.exp(-t / decay) * (t < 0.003 ? t / 0.003 : 1);
      }
      [0.009, 0.017, 0.026, 0.038].forEach(function (er, k) {
        var j = Math.floor((er + ch * 0.0025) * c.sampleRate); if (j < len) d[j] += 0.45 / (k + 1);
      });
    }
    return buf;
  }
  function curve(k) {
    var n = 2048, a = new Float32Array(n), norm = Math.tanh(k);
    for (var i = 0; i < n; i++) { var x = i / (n - 1) * 2 - 1; a[i] = Math.tanh(k * x) / norm; }
    return a;
  }

  function init() {
    if (ctx || !AC) return;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { try { ctx = new AC(); } catch (e2) { ctx = null; return; } }
    var limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -2; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.001; limiter.release.value = 0.06;
    var comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.knee.value = 10; comp.ratio.value = 3.5; comp.attack.value = 0.003; comp.release.value = 0.18;
    var master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9;
    // Phone speakers can't reproduce < ~90 Hz; a gentle low shelf cut keeps the limiter from pumping on sub energy.
    var hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 38; hp.Q.value = 0.7;
    var dry = ctx.createGain();
    var verb = ctx.createConvolver(); verb.buffer = makeIR(ctx, 1.4, 0.28);
    var verbIn = ctx.createGain(); verbIn.gain.value = 0.5;
    dry.connect(hp); verbIn.connect(verb); verb.connect(hp);
    hp.connect(comp); comp.connect(master); master.connect(limiter); limiter.connect(ctx.destination);
    noiseBuf = makeNoise(ctx, false); pinkBuf = makeNoise(ctx, true);
    curveSoft = curve(1.8); curveHard = curve(4);
    bus = { dry: dry, verb: verbIn, master: master };
  }

  function unlock() {
    if (!AC) return;
    init();
    if (!ctx) return;
    try {
      if (ctx.state !== 'running') ctx.resume();
      if (!unlocked) {
        // iOS needs a real buffer to start inside a gesture.
        var s = ctx.createBufferSource(); s.buffer = ctx.createBuffer(1, 1, 22050); s.connect(ctx.destination); s.start(0);
        unlocked = true;
      }
    } catch (e) {}
  }

  function setMuted(m) {
    muted = !!m;
    if (bus) { var g = bus.master.gain; g.cancelScheduledValues(ctx.currentTime); g.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.015); }
  }

  /* ---------- voice toolkit ---------- */
  function out(gain, wet) {
    var g = ctx.createGain(); g.gain.value = gain == null ? 1 : gain;
    g.connect(bus.dry);
    if (wet) { var s = ctx.createGain(); s.gain.value = wet; g.connect(s); s.connect(bus.verb); }
    return g;
  }
  function filt(type, f, q) { var n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; if (q != null) n.Q.value = q; return n; }
  function shaper(hard) { var s = ctx.createWaveShaper(); s.curve = hard ? curveHard : curveSoft; s.oversample = '2x'; return s; }
  function chain(nodes) { for (var i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; }
  /* Exponential-ish envelope: attack, optional hold, decay time-constant. Returns {node, end}. */
  function env(t, a, peak, tau, hold) {
    var g = ctx.createGain(), p = g.gain; hold = hold || 0;
    p.setValueAtTime(0, t); p.linearRampToValueAtTime(peak, t + a);
    if (hold) p.setValueAtTime(peak, t + a + hold);
    p.setTargetAtTime(0, t + a + hold, tau);
    return { node: g, end: t + a + hold + tau * 7 };
  }
  /* Filtered noise burst. */
  function noise(t, o, dest) {
    var src = ctx.createBufferSource(); src.buffer = o.pink ? pinkBuf : noiseBuf; src.loop = true;
    if (o.rate) src.playbackRate.value = o.rate;
    var e = env(t, o.a || 0.0008, o.g == null ? 1 : o.g, o.tau || 0.03, o.hold);
    var nodes = [src].concat(o.f || []); if (o.drive) nodes.push(shaper(o.drive > 1)); nodes.push(e.node, dest);
    chain(nodes);
    src.start(t, (o.off || 0.37) % 1.9); src.stop(e.end + 0.02);
    return { src: src, env: e, filters: o.f || [] };
  }
  /* Oscillator with pitch glide. */
  function tone(t, o, dest) {
    var osc = ctx.createOscillator(); osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f1), t + (o.glide || 0.1));
    if (o.detune) osc.detune.value = o.detune;
    var e = env(t, o.a || 0.002, o.g == null ? 1 : o.g, o.tau || 0.1, o.hold);
    var nodes = [osc].concat(o.f || []); if (o.drive) nodes.push(shaper(o.drive > 1)); nodes.push(e.node, dest);
    chain(nodes);
    osc.start(t); osc.stop(e.end + 0.02);
    return osc;
  }
  /* Two-operator FM hit for metallic, damped clanks (modulator decays faster than the carrier). */
  function fm(t, o, dest) {
    var car = ctx.createOscillator(), mod = ctx.createOscillator(), mg = ctx.createGain();
    car.frequency.value = o.f; mod.frequency.value = o.f * (o.ratio || 1.41);
    mg.gain.setValueAtTime(o.f * (o.index || 3), t); mg.gain.setTargetAtTime(0, t, o.modTau || 0.02);
    mod.connect(mg); mg.connect(car.frequency);
    var e = env(t, 0.0006, o.g == null ? 1 : o.g, o.tau || 0.05);
    var nodes = [car].concat(o.fl || []); nodes.push(e.node, dest); chain(nodes);
    car.start(t); mod.start(t); car.stop(e.end + 0.02); mod.stop(e.end + 0.02);
  }
  /* Brass-like voice: detuned saws through an envelope-swept lowpass (filter opens on attack = "blat"). */
  function brass(t, freq, dur, g, dest, bright) {
    var lp = filt('lowpass', 400, 1.2), e = env(t, 0.012, g, dur * 0.35, dur * 0.4);
    lp.frequency.setValueAtTime(350, t);
    lp.frequency.linearRampToValueAtTime(bright || 3200, t + 0.035);
    lp.frequency.setTargetAtTime(900, t + 0.06, dur * 0.5);
    lp.connect(e.node); e.node.connect(dest);
    [-9, 0, 8].forEach(function (dt) {
      var o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq; o.detune.value = dt;
      // small upward scoop like a real horn attack
      o.frequency.setValueAtTime(freq * 0.97, t); o.frequency.exponentialRampToValueAtTime(freq, t + 0.03);
      var og = ctx.createGain(); og.gain.value = 0.33; o.connect(og); og.connect(lp);
      o.start(t); o.stop(e.end + 0.02);
    });
  }
  /* Deep punch: click transient + pitched body + noise thump. */
  function punch(t, o, dest) {
    noise(t, { g: 0.55 * (o.click || 1), tau: 0.004, f: [filt('highpass', 2400)] }, dest);
    tone(t, { f0: o.f0 || 150, f1: o.f1 || 45, glide: o.glide || 0.12, tau: o.tau || 0.12, g: o.g || 1, drive: 2 }, dest);
    noise(t, { pink: true, g: 0.5 * (o.g || 1), tau: (o.tau || 0.12) * 0.6, f: [filt('lowpass', o.lp || 700)] }, dest);
  }

  /* ---------- sound recipes ---------- */
  var S = {};
  S.tap = function (t) {
    var d = out(0.42);
    noise(t, { g: 0.7, tau: 0.0035, f: [filt('bandpass', 3200, 2.2)] }, d);
    tone(t, { f0: 210, f1: 120, glide: 0.03, tau: 0.018, g: 0.55, drive: 1 }, d);
  };
  S.tick = function (t, o) { // reel tick: tight wooden click
    var d = out(0.38 * ((o && o.g) || 1));
    noise(t, { g: 0.9, tau: 0.004, f: [filt('bandpass', 2600 * ((o && o.p) || 1), 5)] }, d);
    tone(t, { f0: 520 * ((o && o.p) || 1), f1: 300, glide: 0.02, tau: 0.01, g: 0.35 }, d);
  };
  S.lock = function (t) { // heavy lock-in slam
    var d = out(1, 0.5);
    punch(t, { f0: 120, f1: 38, tau: 0.16, g: 1.1, lp: 900 }, d);
    fm(t + 0.002, { f: 310, ratio: 2.76, index: 4, modTau: 0.015, tau: 0.06, g: 0.25, fl: [filt('highpass', 200)] }, d);
    noise(t + 0.01, { pink: true, g: 0.35, tau: 0.09, f: [filt('bandpass', 1200, 0.8)] }, d);
  };
  S.stamp = function (t) {
    var d = out(0.6, 0.25);
    noise(t, { g: 0.8, tau: 0.006, f: [filt('bandpass', 1800, 1.2)], drive: 1 }, d);
    tone(t, { f0: 180, f1: 70, glide: 0.05, tau: 0.04, g: 0.7, drive: 1 }, d);
  };
  S.vaultOpen = function (t) { // latch clack -> bolt slide -> heavy release
    var d = out(0.9, 0.45);
    fm(t, { f: 1450, ratio: 1.73, index: 2.5, modTau: 0.006, tau: 0.018, g: 0.35 }, d);
    noise(t, { g: 0.6, tau: 0.004, f: [filt('highpass', 3000)] }, d);
    var sl = noise(t + 0.02, { g: 0.22, a: 0.02, tau: 0.04, hold: 0.06, f: [filt('bandpass', 900, 3)] }, d);
    sl.filters[0].frequency.setValueAtTime(700, t + 0.02); sl.filters[0].frequency.exponentialRampToValueAtTime(2600, t + 0.12);
    punch(t + 0.13, { f0: 110, f1: 46, tau: 0.11, g: 0.8, click: 0.8 }, d);
    fm(t + 0.13, { f: 220, ratio: 2.4, index: 3, modTau: 0.02, tau: 0.08, g: 0.2 }, d);
  };
  S.vaultClose = function (t) { // shutter slam: whoosh into a heavy metal-on-metal hit
    var d = out(1, 0.5);
    var wh = noise(t, { pink: true, g: 0.35, a: 0.05, tau: 0.02, hold: 0.02, f: [filt('bandpass', 500, 1.2)] }, d);
    wh.filters[0].frequency.setValueAtTime(400, t); wh.filters[0].frequency.exponentialRampToValueAtTime(2200, t + 0.07);
    var h = t + 0.075;
    punch(h, { f0: 140, f1: 36, tau: 0.17, g: 1.15, lp: 1100 }, d);
    fm(h, { f: 180, ratio: 2.76, index: 5, modTau: 0.02, tau: 0.09, g: 0.32 }, d);
    fm(h + 0.004, { f: 620, ratio: 1.41, index: 2, modTau: 0.01, tau: 0.04, g: 0.15 }, d);
    noise(h, { g: 0.5, tau: 0.01, f: [filt('highpass', 2000)], drive: 1 }, d);
  };
  /* Clock tick. o.i: 0..1 tension (last 10 s), o.alt alternates tick/tock. */
  S.clock = function (t, o) {
    var i = (o && o.i) || 0, alt = o && o.alt;
    var d = out(0.5 + i * 0.35, 0.15);
    var base = (alt ? 1500 : 1900) * (1 + i * 0.5);
    noise(t, { g: 0.85, tau: 0.003 + 0.002 * (1 - i), f: [filt('bandpass', base, 7 - i * 3)] }, d);
    tone(t, { f0: alt ? 720 : 900, f1: alt ? 380 : 470, glide: 0.015, tau: 0.012, g: 0.3 + i * 0.2 }, d);
    noise(t + 0.001, { g: 0.25, tau: 0.02, f: [filt('lowpass', 600 + i * 2800)] }, d);
    if (i > 0) { // heartbeat sub-thump layer (lub-dub)
      var h = out(0.9);
      tone(t, { f0: 92, f1: 48, glide: 0.07, tau: 0.07, g: 0.65 + i * 0.4, drive: 1 }, h);
      tone(t + 0.17 - i * 0.04, { f0: 80, f1: 44, glide: 0.06, tau: 0.05, g: 0.4 + i * 0.3, drive: 1 }, h);
    }
  };
  S.buzzer = function (t) { // thick game-show buzzer
    var d = out(0.62, 0.2), dur = 0.75;
    var lp = filt('lowpass', 2400, 0.9), sh = shaper(true), e = env(t, 0.006, 0.5, 0.05, dur);
    lp.connect(sh); sh.connect(e.node); e.node.connect(d);
    [[110, 0], [110, 14], [165.6, -6], [55, 0]].forEach(function (p) {
      var o = ctx.createOscillator(); o.type = p[0] === 55 ? 'triangle' : 'sawtooth'; o.frequency.value = p[0]; o.detune.value = p[1];
      var g = ctx.createGain(); g.gain.value = p[0] === 55 ? 0.7 : 0.3; o.connect(g); g.connect(lp); o.start(t); o.stop(e.end);
    });
    punch(t, { f0: 130, f1: 45, tau: 0.14, g: 0.8 }, d);
  };
  /* Rising charge while holding. Returns a handle with stop(). */
  S.charge = function (t, o) {
    var dur = ((o && o.ms) || 700) / 1000, d = out(0.36);
    var g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.9, t + dur);
    var lp = filt('lowpass', 500, 4); lp.frequency.setValueAtTime(400, t); lp.frequency.exponentialRampToValueAtTime(4200, t + dur);
    lp.connect(g); g.connect(d);
    var oscs = [];
    [[1, 'sawtooth', 0.3], [1.5, 'triangle', 0.35], [0.5, 'sine', 0.6]].forEach(function (p) {
      var x = ctx.createOscillator(); x.type = p[1];
      x.frequency.setValueAtTime(110 * p[0], t); x.frequency.exponentialRampToValueAtTime(330 * p[0], t + dur);
      var xg = ctx.createGain(); xg.gain.value = p[2]; x.connect(xg); xg.connect(lp); x.start(t); oscs.push(x);
    });
    var n = ctx.createBufferSource(); n.buffer = noiseBuf; n.loop = true;
    var ng = ctx.createGain(); ng.gain.value = 0.12; var nb = filt('bandpass', 1500, 2);
    nb.frequency.setValueAtTime(800, t); nb.frequency.exponentialRampToValueAtTime(6000, t + dur);
    n.connect(nb); nb.connect(ng); ng.connect(g); n.start(t); oscs.push(n);
    var stopped = false;
    return {
      stop: function () {
        if (stopped || !ctx) return; stopped = true;
        var now = ctx.currentTime;
        g.gain.cancelScheduledValues(now); g.gain.setValueAtTime(g.gain.value, now); g.gain.setTargetAtTime(0, now, 0.02);
        oscs.forEach(function (x) { try { x.stop(now + 0.15); } catch (e) {} });
      }
    };
  };
  S.confirm = function (t) {
    var d = out(1, 0.5);
    punch(t, { f0: 160, f1: 40, tau: 0.16, g: 1.2, lp: 1200 }, d);
    fm(t, { f: 260, ratio: 3.5, index: 4, modTau: 0.02, tau: 0.08, g: 0.25 }, d);
    noise(t, { pink: true, g: 0.45, tau: 0.14, f: [filt('lowpass', 1800)] }, d);
  };
  S.count = function (t, o) { // 3-2-1 deep hits, rising
    var step = (o && o.n) || 0, p = Math.pow(1.19, step), d = out(1, 0.55);
    punch(t, { f0: 95 * p, f1: 38 * p, tau: 0.2, g: 1.2, lp: 600 + 300 * step }, d);
    fm(t, { f: 150 * p, ratio: 2, index: 2, modTau: 0.03, tau: 0.12, g: 0.22 }, d);
  };
  S.riser = function (t, o) {
    var dur = ((o && o.ms) || 520) / 1000, d = out(0.55, 0.4);
    var n = noise(t, { g: 0.6, a: dur * 0.9, tau: 0.01, f: [filt('bandpass', 400, 2.5)] }, d);
    n.filters[0].frequency.setValueAtTime(300, t); n.filters[0].frequency.exponentialRampToValueAtTime(7000, t + dur);
    var x = tone(t, { f0: 80, f1: 640, glide: dur, a: dur * 0.9, tau: 0.01, g: 0.35, type: 'triangle' }, d);
    return x;
  };
  S.hitframe = function (t) {
    var d = out(1, 0.6);
    punch(t, { f0: 180, f1: 34, tau: 0.25, g: 1.3, lp: 1400 }, d);
    noise(t, { g: 0.6, tau: 0.03, f: [filt('highpass', 1500)], drive: 1 }, d);
  };
  S.revealSafe = function (t) { // triumphant brass stab: Bb major chord with hit
    var d = out(0.8, 0.55);
    [233.1, 293.7, 349.2, 466.2].forEach(function (f, i) { brass(t + i * 0.004, f, 0.55, 0.32, d, 3600); });
    brass(t + 0.004, 116.5, 0.6, 0.35, d, 1600);
    punch(t, { f0: 150, f1: 42, tau: 0.18, g: 1, lp: 1000 }, d);
    noise(t, { g: 0.35, tau: 0.25, f: [filt('highpass', 5000)] }, d); // cymbal-ish air
  };
  S.revealOut = function (t) { // heavy dark impact + descending tone
    var d = out(1, 0.6);
    punch(t, { f0: 110, f1: 28, glide: 0.3, tau: 0.35, g: 1.4, lp: 600 }, d);
    noise(t, { pink: true, g: 0.6, tau: 0.4, f: [filt('lowpass', 500)] }, d);
    var lp = filt('lowpass', 1400, 2); lp.frequency.setValueAtTime(1600, t); lp.frequency.exponentialRampToValueAtTime(220, t + 1.1);
    lp.connect(d);
    [[220, 0], [233.1, 6], [110, 0]].forEach(function (p) { // minor-second cluster sliding down
      tone(t + 0.01, { type: 'sawtooth', f0: p[0], f1: p[0] * 0.42, glide: 1.1, a: 0.01, hold: 0.15, tau: 0.35, g: 0.22, detune: p[1] }, lp);
    });
    fm(t, { f: 90, ratio: 1.41, index: 6, modTau: 0.05, tau: 0.3, g: 0.3 }, d);
  };
  S.fanfare = function (t) { // short punchy tail: da-DAAA
    var d = out(0.75, 0.6);
    [349.2, 440, 523.3].forEach(function (f) { brass(t, f, 0.16, 0.24, d, 3000); });
    [466.2, 587.3, 698.5, 932.3].forEach(function (f) { brass(t + 0.14, f, 0.7, 0.24, d, 4200); });
    brass(t + 0.14, 116.5, 0.7, 0.3, d, 1400);
    punch(t + 0.14, { f0: 140, f1: 45, tau: 0.16, g: 0.9 }, d);
  };
  S.wipe = function (t) { // transition swish
    var d = out(0.3, 0.2);
    var n = noise(t, { pink: true, g: 0.7, a: 0.06, tau: 0.04, f: [filt('bandpass', 700, 1.4)] }, d);
    n.filters[0].frequency.setValueAtTime(500, t); n.filters[0].frequency.exponentialRampToValueAtTime(3000, t + 0.12);
  };

  function play(name, o) {
    if (!ctx || muted || !S[name]) return null;
    if (ctx.state !== 'running') { try { ctx.resume(); } catch (e) {} }
    try { return S[name](ctx.currentTime + 0.005 + ((o && o.delay) || 0), o) || null; } catch (e) { return null; }
  }

  /* Haptics (Android). Silent no-op where unsupported. */
  var canVibrate = !!(navigator.vibrate);
  function buzz(pattern) {
    if (!canVibrate || muted) return;
    try { navigator.vibrate(pattern); } catch (e) {}
  }

  w.Sound = {
    unlock: unlock, play: play, buzz: buzz, setMuted: setMuted,
    get muted() { return muted; }, get ready() { return !!ctx; }, names: Object.keys(S),
    _ctx: function () { return ctx; }
  };
})(window);
