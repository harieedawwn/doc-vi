/* app.js — ĐỌC VỊ screens, flow, persistence and choreography.
 * Secret phases (peek lock, timer, decision) never branch on the hidden result:
 * same DOM, same motion, same sound, same vibration. */
(function (w, d) {
  'use strict';
  var R = w.Rules, Fx = w.Fx, Snd = w.Sound, B = w.Boot, E = Fx.E;
  var KEY = 'docvi.round.v1', KEY_NAMES = 'docvi.names.v1', KEY_MUTE = 'docvi.mute.v1';
  var STALE_MS = 6 * 3600 * 1000;
  var DEF = ['NGƯỜI CHƠI 1', 'NGƯỜI CHƠI 2'];

  function $(s, r) { return (r || d).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || d).querySelectorAll(s)); }
  var app = $('#app'), stage = $('#stage'), peekLayer = $('#peekLayer'), wipeEl = $('#wipe'), flashEl = $('#flash');
  var edges = $$('#edges i'), hudRound = $('#roundLabel'), steps = $$('#steps i');

  var S = null;            // current round (null on home)
  var cur = null;          // current screen controller {name, el, layout, destroy}
  var busy = false;        // a transition or sequence owns input
  var seq = 0;             // increments to cancel async sequences

  /* ---------- utils ---------- */
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function up(s) { return String(s).toLocaleUpperCase('vi-VN'); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function corners() { return '<i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i>'; }
  function el(html) { var t = d.createElement('div'); t.innerHTML = html.trim(); return t.firstChild; }
  function ticksSvg(n, h) {
    var s = '<svg class="ticks" viewBox="0 0 ' + (n * 10) + ' 12" preserveAspectRatio="none" aria-hidden="true">';
    for (var i = 0; i <= n; i++) {
      var x = Math.min(i * 10, n * 10 - 1) + 0.5, tall = i % 5 === 0;
      s += '<line x1="' + x + '" y1="' + (tall ? 0 : 6) + '" x2="' + x + '" y2="12" stroke="currentColor" stroke-width="' + (tall ? 2 : 1) + '"/>';
    }
    return s + '</svg>';
  }
  function nameA() { return S.names[S.a]; }
  function nameB() { return S.names[1 - S.a]; }
  function tok() { return ++seq; }
  function alive(t) { return t === seq; }

  /* ---------- persistence ---------- */
  function save() {
    if (!S) { B.store.del(KEY); return; }
    S.ts = Date.now();
    if (S.phase === 'talk' && S.timer) S.remain = R.timerRemaining(S.timer, performance.now());
    try { B.store.set(KEY, R.serialize(S)); } catch (e) {}
  }
  function loadRound() { return R.parse(B.store.get(KEY)); }
  function loadNames() {
    try { var n = JSON.parse(B.store.get(KEY_NAMES) || 'null'); if (n && typeof n[0] === 'string' && typeof n[1] === 'string') return [n[0].slice(0, 16), n[1].slice(0, 16)]; } catch (e) {}
    return ['', ''];
  }
  function newRound(names, round) {
    return { phase: 'roles', names: names, round: round || 1, a: null, secret: null, secretEnc: null, peekUsed: false, override: false, remain: null, choice: null, ts: Date.now() };
  }

  /* ---------- chrome ---------- */
  var STEP = { roles: 0, peek: 1, talk: 2, decide: 3, reveal: 4 };
  function chrome(name) {
    app.classList.toggle('is-home', name === 'home');
    app.classList.toggle('on-light', name === 'result');
    hudRound.textContent = 'VÁN ' + pad2(S ? S.round : 1);
    var k = S && STEP[S.phase] != null ? STEP[S.phase] : -1;
    steps.forEach(function (s, i) { s.className = i < k ? 'on' : i === k ? 'now' : ''; });
  }

  function mount(ctrl) {
    if (cur && cur.destroy) { try { cur.destroy(); } catch (e) {} }
    stage.innerHTML = '';
    cur = ctrl;
    stage.appendChild(ctrl.el);
    chrome(ctrl.name);
    if (ctrl.layout) ctrl.layout();
    if (ctrl.enter) ctrl.enter();
  }

  /* Shutter-blind wipe: cover, swap, uncover. */
  function wipe(swap) {
    var bl = $$('i', wipeEl);
    busy = true;
    Snd.play('wipe');
    var p1 = Fx.reduce
      ? Fx.anim(wipeEl, [{ opacity: 0 }, { opacity: 1 }], { duration: 120, hold: true }).then(function () { bl.forEach(function (b) { b.style.transform = 'scaleY(1)'; }); })
      : Promise.all(bl.map(function (b, i) {
        b.style.transformOrigin = '50% 0';
        return Fx.anim(b, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: 170, delay: i * 22, easing: E.io, hold: true });
      }));
    return p1.then(function () {
      swap();
      if (Fx.reduce) return Fx.anim(wipeEl, [{ opacity: 1 }, { opacity: 0 }], { duration: 160 }).then(function () { bl.forEach(function (b) { b.style.transform = ''; }); wipeEl.style.opacity = ''; Fx.stopAll(wipeEl); });
      return Promise.all(bl.map(function (b, i) {
        Fx.stopAll(b); b.style.transform = 'scaleY(1)'; b.style.transformOrigin = '50% 100%';
        return Fx.anim(b, [{ transform: 'scaleY(1)' }, { transform: 'scaleY(0)' }], { duration: 190, delay: 40 + i * 22, easing: E.io, hold: true });
      })).then(function () { bl.forEach(function (b) { Fx.stopAll(b); b.style.transform = ''; }); });
    }).then(function () { busy = false; }, function () { busy = false; });
  }
  function flash(color, dur) {
    flashEl.style.background = color || '';
    return Fx.anim(flashEl, [{ opacity: 1 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], { duration: dur || 260, easing: 'linear', keep: true })
      .then(function () { Fx.stopAll(flashEl); });
  }

  /* ---------- hold-to-confirm ---------- */
  function hold(btn, ms, o) {
    var fill = $('.fill', btn), timer = 0, an = null, charge = null, active = false, done = false, pid = null;
    function reset() {
      if (timer) { clearTimeout(timer); timer = 0; }
      if (charge) { charge.stop(); charge = null; }
      if (an) { try { an.cancel(); } catch (e) {} an = null; }
      if (fill) fill.style.transform = '';
      btn.classList.remove('press');
      active = false;
    }
    var start = B.guard(function (e) {
      if (active || btn.disabled || busy || (o.enabled && !o.enabled())) return;
      if (e.button != null && e.button > 0) return;
      e.preventDefault();
      active = true; done = false; pid = e.pointerId;
      try { btn.setPointerCapture(pid); } catch (er) {}
      btn.classList.add('press');
      if (o.charge) charge = Snd.play('charge', { ms: ms }); else Snd.play('tap');
      if (fill && fill.animate) an = fill.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: ms, easing: 'linear', fill: 'forwards' });
      if (o.onStart) o.onStart();
      var t0 = performance.now();
      timer = setTimeout(function () {
        timer = 0; done = true;
        if (charge) { charge.stop(); charge = null; }
        if (o.onDone) o.onDone(performance.now() - t0);
      }, ms);
    });
    var end = B.guard(function (e) {
      if (!active || (pid != null && e.pointerId != null && e.pointerId !== pid)) return;
      var wasDone = done;
      active = false; pid = null;
      btn.classList.remove('press');
      if (!wasDone) {
        if (timer) { clearTimeout(timer); timer = 0; }
        if (charge) { charge.stop(); charge = null; }
        if (an) { try { an.cancel(); } catch (er) {} an = null; }
        if (o.onCancel) o.onCancel();
      } else if (o.onRelease) o.onRelease();
    });
    btn.addEventListener('pointerdown', start);
    btn.addEventListener('pointerup', end);
    btn.addEventListener('pointercancel', end);
    btn.addEventListener('lostpointercapture', end);
    btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    return { reset: reset, get active() { return active; } };
  }
  function tapBtn(btn, fn) {
    btn.addEventListener('pointerdown', function () { if (!btn.disabled) Snd.play('tap'); });
    btn.addEventListener('click', B.guard(function (e) { if (busy || btn.disabled) return; fn(e); }));
  }

  /* ---------- fitting ---------- */
  /* Fit a name across up to `maxLines` lines (split at spaces), choosing the largest size that fits box. */
  function fitName(box, text, frac, maxPx, maxH, maxLines) {
    var t = up(text), words = t.split(' '), best = null;
    var cands = [[t]];
    if ((maxLines || 1) > 1 && words.length > 1) {
      for (var i = 1; i < words.length; i++) cands.push([words.slice(0, i).join(' '), words.slice(i).join(' ')]);
    }
    var bw = box.clientWidth * frac;
    box.innerHTML = '';
    var probe = d.createElement('span'); probe.className = 'big'; probe.style.fontSize = '100px'; probe.style.position = 'absolute'; probe.style.visibility = 'hidden';
    box.appendChild(probe);
    cands.forEach(function (lines) {
      var wmax = 0;
      lines.forEach(function (l) { probe.textContent = l; wmax = Math.max(wmax, probe.scrollWidth || 1); });
      var size = 100 * bw / wmax;
      size = Math.min(size, maxPx || 9999, (maxH || 9999) / (lines.length * (lines.length > 1 ? 1.24 : 1.12)));
      if (!best || size > best.size * 1.08) best = { size: size, lines: lines };
    });
    box.innerHTML = '';
    best.lines.forEach(function (l) {
      var s = d.createElement('span'); s.className = 'big ln'; s.style.display = 'block'; s.textContent = l;
      if (best.lines.length > 1) s.style.lineHeight = '1.24';
      s.style.fontSize = Math.max(14, Math.floor(best.size)) + 'px';
      box.appendChild(s);
    });
    return $$('.ln', box);
  }

  /* ======================================================================
   * HOME
   * ==================================================================== */
  function radarSvg() {
    var s = '<svg viewBox="0 0 200 200" aria-hidden="true"><g fill="none" stroke="currentColor">';
    s += '<circle cx="100" cy="100" r="98" stroke-width="1.5"/><circle cx="100" cy="100" r="66" stroke-width="1"/><circle cx="100" cy="100" r="34" stroke-width="1"/>';
    for (var i = 0; i < 72; i++) {
      var a = i * Math.PI / 36, r1 = i % 6 === 0 ? 86 : 92;
      s += '<line x1="' + (100 + Math.cos(a) * r1).toFixed(2) + '" y1="' + (100 + Math.sin(a) * r1).toFixed(2) + '" x2="' + (100 + Math.cos(a) * 98).toFixed(2) + '" y2="' + (100 + Math.sin(a) * 98).toFixed(2) + '" stroke-width="' + (i % 6 === 0 ? 2 : 1) + '"/>';
    }
    s += '<line x1="100" y1="100" x2="100" y2="2" stroke-width="2"/><line x1="0" y1="100" x2="200" y2="100" stroke-width="1"/>';
    return s + '</g></svg>';
  }

  function screenHome() {
    var saved = loadRound();
    var nm = loadNames();
    var root = el('<section class="scr home">' +
      '<div class="logo-wrap">' +
        '<div class="radar">' + radarSvg() + '</div>' +
        '<div class="logo bx">' + corners() +
          '<span class="ln ln1"><span class="big">ĐỌC</span></span>' +
          '<span class="ln ln2"><span class="big">VỊ</span></span>' +
        '</div>' +
        '<div class="logo-meta"><span class="lbl cursor">SẴN SÀNG</span></div>' +
        ticksSvg(40) +
      '</div>' +
      '<div class="side">' +
        '<div class="form">' +
          '<label class="field"><span class="num">01</span><input id="n1" type="text" maxlength="16" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="next" placeholder="' + DEF[0] + '" aria-label="' + DEF[0] + '"></label>' +
          '<label class="field"><span class="num">02</span><input id="n2" type="text" maxlength="16" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="done" placeholder="' + DEF[1] + '" aria-label="' + DEF[1] + '"></label>' +
        '</div>' +
        '<div class="home-actions">' +
          (saved ? '<button class="btn btn-primary btn-xl" id="bResume" type="button">' + Fx.icon('replay') + '<span>TIẾP TỤC VÁN</span></button>' : '') +
          '<button class="btn ' + (saved ? '' : 'btn-primary btn-xl') + '" id="bStart" type="button">' + (saved ? '' : Fx.icon('play')) + '<span>BẮT ĐẦU</span></button>' +
        '</div>' +
      '</div>' +
    '</section>');
    var i1 = $('#n1', root), i2 = $('#n2', root);
    i1.value = nm[0]; i2.value = nm[1];
    function storeNames() { B.store.set(KEY_NAMES, JSON.stringify([i1.value, i2.value])); }
    i1.addEventListener('input', storeNames); i2.addEventListener('input', storeNames);
    i1.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); i2.focus(); } });
    i2.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); i2.blur(); } });
    // Let inputs receive touches even though the app blocks gestures.
    [i1, i2].forEach(function (i) { i.addEventListener('pointerdown', function (e) { e.stopPropagation(); }); });

    tapBtn($('#bStart', root), function () {
      storeNames();
      var names = [R.cleanName(i1.value, DEF[0]), R.cleanName(i2.value, DEF[1])];
      if (d.activeElement && d.activeElement.blur) d.activeElement.blur();
      S = newRound(names, 1); save();
      wipe(function () { show('roles'); });
    });
    if (saved) tapBtn($('#bResume', root), function () {
      S = saved; resume();
    });

    var spin = null;
    return {
      name: 'home', el: root,
      layout: function () {
        var wrap = $('.logo-wrap', root), logo = $('.logo', root);
        var h1 = $('.ln1 .big', root), h2 = $('.ln2 .big', root);
        var avail = wrap.clientHeight - 60;
        Fx.fit(h1, 0.94, 9999, Math.max(40, avail / 2.5));
        h2.style.fontSize = h1.style.fontSize;
        logo.style.paddingLeft = '14px';
        var rad = $('.radar', root), sz = Math.min(wrap.clientWidth * 0.95, wrap.clientHeight * 1.1);
        rad.style.width = sz + 'px'; rad.style.height = sz + 'px';
      },
      enter: function () {
        var lines = $$('.ln > span', root);
        lines.forEach(function (s, i) {
          Fx.anim(s, [{ transform: 'translateY(110%)' }, { transform: 'translateY(0)' }], { duration: 520, delay: 120 + i * 110, easing: E.punch });
        });
        $$('.c', root).forEach(function (c, i) { Fx.anim(c, [{ opacity: 0, transform: 'scale(1.8)' }, { opacity: 1, transform: 'scale(1)' }], { duration: 260, delay: 380 + i * 50, easing: E.snap }); });
        Fx.anim($('.radar', root), [{ opacity: 0 }, { opacity: 1 }], { duration: 900, delay: 300, easing: 'linear' });
        $$('.side > *', root).concat($$('.logo-meta, .ticks', root)).forEach(function (x, i) {
          Fx.anim(x, [{ opacity: 0, transform: 'translateY(16px)' }, { opacity: 1, transform: 'none' }], { duration: 320, delay: 380 + i * 70, easing: E.out });
        });
        if (!Fx.reduce) Fx.anim($('.radar svg', root), [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 48000, iterations: Infinity, easing: 'linear', keep: true }).then(function (a) { spin = a; });
      },
      destroy: function () { if (spin) try { spin.cancel(); } catch (e) {} }
    };
  }

  /* ======================================================================
   * ROLES
   * ==================================================================== */
  function screenRoles() {
    var n = S.names;
    var root = el('<section class="scr roles">' +
      '<div class="reel-box bx">' + corners() +
        '<div class="rolerow"><span class="lbl"><b>A</b> · NHÌN TRỘM</span><span class="stampmk" hidden>ĐÃ CHỐT</span></div>' +
        '<div class="slot"><div class="strip"></div><i class="mark l"></i><i class="mark r"></i></div>' +
        '<div class="b-line"><span class="lbl"><b>B</b> · ĐOÁN</span><span class="bname">—</span></div>' +
      '</div>' +
      '<div class="side">' +
        '<div class="lbl">CHẠM TÊN ĐỂ CHỌN A</div>' +
        '<div class="chips">' +
          '<button class="chip" type="button" data-i="0"><span class="cr">01</span><span class="cn">' + esc(up(n[0])) + '</span></button>' +
          '<button class="chip" type="button" data-i="1"><span class="cr">02</span><span class="cn">' + esc(up(n[1])) + '</span></button>' +
        '</div>' +
        '<button class="btn" id="bSpin" type="button">' + Fx.icon('dice') + '<span>QUAY NGẪU NHIÊN</span></button>' +
        '<button class="btn btn-primary btn-xl" id="bGive" type="button" disabled>' + Fx.icon('lock') + '<span>TRAO MÁY CHO A</span></button>' +
      '</div>' +
    '</section>');
    var slot = $('.slot', root), strip = $('.strip', root), stamp = $('.stampmk', root), bname = $('.bname', root);
    var bSpin = $('#bSpin', root), bGive = $('#bGive', root), chips = $$('.chip', root);
    var cellH = 120, fontPx = 40, shown = -1, spinning = false, raf = 0;

    function cellHtml(i) {
      if (i < 0) return '<div class="cell"><span class="big q" style="font-size:' + fontPx + 'px">? ? ?</span></div>';
      return '<div class="cell"><span class="big" style="font-size:' + fontPx + 'px">' + esc(up(n[i])) + '</span></div>';
    }
    function setStatic(i) {
      strip.innerHTML = cellHtml(i);
      strip.style.transform = 'translateY(0)';
    }
    function markChips() {
      chips.forEach(function (c, i) {
        var isA = S.a === i;
        c.classList.toggle('is-a', isA);
        $('.cr', c).textContent = S.a == null ? pad2(i + 1) : isA ? 'A · NHÌN TRỘM' : 'B · ĐOÁN';
      });
    }
    function lockIn(i, t) {
      if (!alive(t)) return;
      S.a = i;
      S.secret = R.drawResult();   // drawn here; nothing on screen depends on it
      S.secretEnc = null; S.peekUsed = false; S.override = false;
      save();
      Snd.play('lock'); Fx.vibrate(45);
      Fx.anim(slot, [{ transform: 'scale(1.07)' }, { transform: 'scale(1)' }], { duration: 300, easing: E.punch });
      flashMarks();
      stamp.hidden = false;
      Fx.anim(stamp, [{ opacity: 0, transform: 'rotate(-4deg) scale(2.4)' }, { opacity: 1, transform: 'rotate(-4deg) scale(1)' }], { duration: 220, delay: 120, easing: E.slam, keep: true })
        .then(function () { if (alive(t)) { Snd.play('stamp'); Fx.vibrate(15); } });
      bname.textContent = up(n[1 - i]); Fx.shrink(bname, 12);
      Fx.anim(bname, [{ opacity: 0, transform: 'translateX(-24px)' }, { opacity: 1, transform: 'none' }], { duration: 260, delay: 160, easing: E.out });
      markChips();
      bGive.disabled = false;
      Fx.anim(bGive, [{ transform: 'scale(.92)' }, { transform: 'scale(1)' }], { duration: 260, delay: 240, easing: E.punch });
      spinning = false; bSpin.disabled = false;
    }
    function flashMarks() {
      $$('.mark', slot).forEach(function (m) { Fx.anim(m, [{ transform: 'scaleX(3)' }, { transform: 'scaleX(1)' }], { duration: 260, easing: E.out }); });
    }
    /* Slot reel: a strip of alternating names decelerating onto `target`. */
    function spinTo(target, cells, dur) {
      if (spinning) return;
      var t = tok();
      spinning = true; bSpin.disabled = true; bGive.disabled = true; stamp.hidden = true;
      S.a = null; S.secret = null; markChips(); bname.textContent = '—';
      var start = shown < 0 ? 0 : shown;
      var list = [shown];
      var k = start;
      for (var c = 1; c < cells; c++) { k = 1 - k; list.push(k); }
      if (list[list.length - 1] !== target) list.push(target);
      strip.innerHTML = list.map(cellHtml).join('');
      var dist = (list.length - 1) * cellH;
      shown = target;
      if (Fx.reduce) {
        setStatic(target); lockIn(target, t); return;
      }
      var an = strip.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(' + (-dist) + 'px)' }],
        { duration: dur, easing: 'cubic-bezier(.1,.55,.18,1)', fill: 'forwards' });
      var last = 0, t0 = performance.now();
      function frame() {
        if (!alive(t)) return;
        var m = 0;
        try { var tr = getComputedStyle(strip).transform; if (tr && tr !== 'none') m = -parseFloat(tr.split(',')[5]); } catch (e) {}
        var idx = Math.floor((m + cellH * 0.5) / cellH);
        if (idx !== last) {
          last = idx;
          var prog = (performance.now() - t0) / dur;
          Snd.play('tick', { p: 1.15 - prog * 0.35, g: 0.7 + prog * 0.5 });
          if (prog > 0.6) Fx.vibrate(6);
        }
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);
      an.onfinish = B.guard(function () {
        cancelAnimationFrame(raf);
        if (!alive(t)) return;
        setStatic(target); try { an.cancel(); } catch (e) {}
        lockIn(target, t);
      });
    }
    chips.forEach(function (c) {
      c.addEventListener('pointerdown', function () { Snd.play('tap'); });
      c.addEventListener('click', B.guard(function () {
        if (busy || spinning) return;
        var i = +c.getAttribute('data-i');
        if (S.a === i) return;
        spinTo(i, 3, 520);
      }));
    });
    tapBtn(bSpin, function () {
      var target = R.randomInt(2);
      spinTo(target, 16 + R.randomInt(4), 2100);
    });
    tapBtn(bGive, function () {
      if (S.a == null || !S.secret) return;
      S.phase = 'peek'; S.peekUsed = false; save();
      wipe(function () { show('peek'); });
    });

    return {
      name: 'roles', el: root,
      layout: function () {
        var box = $('.reel-box', root);
        cellH = Math.max(64, Math.min(box.clientHeight - 130, box.clientWidth * 0.5, 220));
        root.style.setProperty('--slot-h', cellH + 'px');
        // Common size: the longer name fits the slot width.
        var probe = d.createElement('span'); probe.className = 'big'; probe.style.cssText = 'position:absolute;visibility:hidden;font-size:100px';
        root.appendChild(probe);
        var wmax = 0;
        n.forEach(function (x) { probe.textContent = up(x); wmax = Math.max(wmax, probe.scrollWidth); });
        root.removeChild(probe);
        fontPx = Math.floor(Math.min(100 * (slot.clientWidth * 0.86) / wmax, cellH * 0.6));
        $$('.cn', root).forEach(function (c) { Fx.shrink(c, 12); });
        Fx.shrink(bname, 12);
        if (!spinning) setStatic(shown);
      },
      enter: function () {
        S.a = null; S.secret = null; markChips();
        Fx.anim(slot, [{ transform: 'scaleY(0)' }, { transform: 'scaleY(1)' }], { duration: 300, delay: 80, easing: E.punch });
        $$('.side > *', root).forEach(function (x, i) {
          Fx.anim(x, [{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }], { duration: 300, delay: 140 + i * 60, easing: E.out });
        });
      },
      destroy: function () { cancelAnimationFrame(raf); tok(); }
    };
  }

  /* ======================================================================
   * PEEK
   * ==================================================================== */
  function screenPeek() {
    var used = !!S.peekUsed;
    var root = el('<section class="scr peekscr">' +
      '<div class="who"><span class="lbl"><b>A</b> · NHÌN TRỘM</span><div class="nmbox"></div></div>' +
      '<div class="vault"><div class="vault-in bx">' + corners() + Fx.icon('lock') + (used ? '<span class="stampmk">ĐÃ XEM</span>' : '') + '</div></div>' +
      '<div class="act">' + (used
        ? '<button class="btn btn-primary btn-xl" id="bTalk" type="button">' + Fx.icon('timer') + '<span>BẮT ĐẦU 45 GIÂY</span></button>'
        : '<button class="btn btn-xl pad hold" id="bPeek" type="button"><span class="fill"></span><span class="hl">' + Fx.icon('eye') + '<span>GIỮ ĐỂ XEM</span></span></button>') +
      '</div>' +
    '</section>');
    var h = null;
    if (used) {
      tapBtn($('#bTalk', root), function () {
        S.phase = 'talk'; S.remain = R.T.TALK_MS; S.timer = null; save();
        wipe(function () { show('talk', { autostart: true }); });
      });
    } else {
      h = hold($('#bPeek', root), R.T.HOLD_PEEK_MS, {
        onDone: function () { openPeek(false); },
        onRelease: function () { closePeek(); }
      });
    }
    return {
      name: 'peek', el: root,
      layout: function () {
        var box = $('.nmbox', root);
        fitName(box, nameA(), 1, 9999, Math.max(48, root.clientHeight * 0.16), 1);
        var v = Math.min(root.clientWidth * 0.5, root.clientHeight * 0.3, 260);
        if (d.documentElement.classList.contains('is-land')) v = Math.min(root.clientWidth * 0.26, root.clientHeight * 0.48);
        var vi = $('.vault-in', root); vi.style.width = v + 'px'; vi.style.height = v + 'px';
      },
      enter: function () {
        var vi = $('.vault-in', root);
        // Same entrance for both results; post-lock state lands on an identical static frame.
        Fx.anim(vi, [{ transform: 'scale(.6)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 300, easing: E.punch });
        var st = $('.stampmk', root);
        if (st) Fx.anim(st, [{ opacity: 0, transform: 'translateX(-50%) rotate(-4deg) scale(2.6)' }, { opacity: 1, transform: 'translateX(-50%) rotate(-4deg) scale(1)' }], { duration: 200, delay: 180, easing: E.slam, keep: true })
          .then(function () { Snd.play('stamp'); });
        $$('.who > *, .act > *', root).forEach(function (x, i) {
          Fx.anim(x, [{ opacity: 0, transform: 'translateY(14px)' }, { opacity: 1, transform: 'none' }], { duration: 280, delay: 60 + i * 60, easing: E.out });
        });
      },
      destroy: function () { if (h) h.reset(); }
    };
  }

  var peek = null; // active peek {t0, timer, closed, override, after}
  function openPeek(override, after) {
    if (peek) return;
    var t = tok();
    if (!override) S.peekUsed = true; else S.override = true;
    save(); // persisted before anything is shown: a reload now lands on the locked screen
    var res = S.secret;
    var word = res === R.SAFE ? 'AN TOÀN' : 'BỊ LOẠI';
    peekLayer.innerHTML =
      '<div class="res ' + (res === R.SAFE ? 'safe' : 'out') + '">' +
        '<span class="tag lbl">TRONG MÁY</span><span class="secs mono">3</span>' +
        Fx.icon(res === R.SAFE ? 'safe' : 'out') +
        '<div class="wordbox"><span class="big w">' + word + '</span></div>' +
        '<i class="drain"></i>' +
      '</div>' +
      '<div class="shut t"><i class="bolt l"></i><i class="bolt r"></i></div>' +
      '<div class="shut b"><i class="bolt l"></i><i class="bolt r"></i></div>';
    peekLayer.hidden = false;
    Fx.fit($('.w', peekLayer), 0.78, 9999, w.innerHeight * (w.innerWidth > w.innerHeight ? 0.42 : 0.2));
    var st = $('.shut.t', peekLayer), sb = $('.shut.b', peekLayer), secs = $('.secs', peekLayer), drain = $('.drain', peekLayer);
    Snd.play('vaultOpen'); Fx.vibrate(30);
    Fx.anim(st, [{ transform: 'translateY(0)' }, { transform: 'translateY(-101%)' }], { duration: 210, delay: 110, easing: E.snap, keep: true, hold: true });
    Fx.anim(sb, [{ transform: 'translateY(0)' }, { transform: 'translateY(101%)' }], { duration: 210, delay: 110, easing: E.snap, keep: true, hold: true });
    var t0 = performance.now() + 110;
    drain.animate([{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }], { duration: R.T.PEEK_MS, delay: 110, easing: 'linear', fill: 'both' });
    peek = { t: t, closed: false, after: after, iv: 0, timer: 0 };
    peek.iv = setInterval(function () {
      var left = Math.max(0, R.T.PEEK_MS - (performance.now() - t0));
      secs.textContent = String(Math.ceil(left / 1000));
    }, 50);
    peek.timer = setTimeout(B.guard(closePeek), R.T.PEEK_MS + 110);
  }
  /* Identical for both results: same timing, sound, vibration and end frame. */
  function closePeek(instant) {
    if (!peek || peek.closed) return;
    var p = peek; p.closed = true;
    clearInterval(p.iv); clearTimeout(p.timer);
    function finish() {
      peekLayer.hidden = true; peekLayer.innerHTML = '';
      peek = null;
      if (p.after) p.after(); else show('peek');
    }
    if (instant === true) { finish(); return; }
    busy = true;
    var st = $('.shut.t', peekLayer), sb = $('.shut.b', peekLayer);
    Fx.stopAll(st); Fx.stopAll(sb);
    Snd.play('vaultClose'); Fx.vibrate([40, 30, 20]);
    var a1 = Fx.anim(st, [{ transform: 'translateY(-101%)' }, { transform: 'translateY(0)' }], { duration: 140, delay: 40, easing: E.slam, keep: true, hold: true });
    var a2 = Fx.anim(sb, [{ transform: 'translateY(101%)' }, { transform: 'translateY(0)' }], { duration: 140, delay: 40, easing: E.slam, keep: true, hold: true });
    Promise.all([a1, a2]).then(function () {
      var res = $('.res', peekLayer); if (res) res.parentNode.removeChild(res);
      Fx.anim(peekLayer, [{ transform: 'translateY(0)' }, { transform: 'translateY(6px)' }, { transform: 'translateY(-3px)' }, { transform: 'translateY(0)' }], { duration: 160, easing: 'linear', keep: true });
      return Fx.wait(300);
    }).then(function () { Fx.stopAll(peekLayer); busy = false; finish(); }, function () { busy = false; finish(); });
  }

  /* Host override: 2 s hold on the round label grants one extra peek. No visual feedback. */
  (function () {
    var tm = 0, pid = null, armed = false;
    function allowed() {
      return S && !S.override && !peek && !busy && cur &&
        ((cur.name === 'peek' && S.peekUsed) || cur.name === 'talk' || cur.name === 'decide');
    }
    hudRound.addEventListener('pointerdown', function (e) {
      if (!allowed()) return;
      pid = e.pointerId; armed = false;
      try { hudRound.setPointerCapture(pid); } catch (er) {}
      tm = setTimeout(B.guard(function () {
        tm = 0; if (!allowed()) return;
        armed = true;
        var wasRunning = cur.name === 'talk' && cur.isRunning && cur.isRunning();
        if (cur.name === 'talk' && cur.pause) cur.pause(true);
        var back = cur.name;
        openPeek(true, function () {
          show(back === 'peek' ? 'peek' : back, { autostart: wasRunning, silent: true });
        });
      }), R.T.HOLD_OVERRIDE_MS);
    });
    function release(e) {
      if (pid != null && e.pointerId !== pid) return;
      pid = null;
      if (tm) { clearTimeout(tm); tm = 0; }
      if (armed) { armed = false; closePeek(); }
    }
    hudRound.addEventListener('pointerup', release);
    hudRound.addEventListener('pointercancel', release);
    hudRound.addEventListener('lostpointercapture', release);
    hudRound.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  })();

  /* ======================================================================
   * TALK (45 s)
   * ==================================================================== */
  function screenTalk(opts) {
    var NT = 45;
    var ticks = '';
    for (var i = 0; i < NT; i++) {
      var a = (i / NT) * Math.PI * 2 - Math.PI / 2, big = i % 5 === 0;
      var r1 = big ? 86 : 90, r2 = 99;
      ticks += '<line class="tk" data-i="' + i + '" x1="' + (100 + Math.cos(a) * r1).toFixed(2) + '" y1="' + (100 + Math.sin(a) * r1).toFixed(2) + '" x2="' + (100 + Math.cos(a) * r2).toFixed(2) + '" y2="' + (100 + Math.sin(a) * r2).toFixed(2) + '"' + (big ? ' style="stroke-width:4"' : '') + '/>';
    }
    var CIRC = 2 * Math.PI * 78;
    var root = el('<section class="scr talk">' +
      '<div class="duo"><div><span class="lbl"><b>A</b> · NHÌN TRỘM</span><div class="nm">' + esc(up(nameA())) + '</div></div>' +
        '<div class="r"><span class="lbl"><b>B</b> · ĐOÁN</span><div class="nm">' + esc(up(nameB())) + '</div></div></div>' +
      '<div class="clock"><div class="ring"><svg viewBox="0 0 200 200" aria-hidden="true">' + ticks +
        '<circle class="arc-bg" cx="100" cy="100" r="78"/>' +
        '<circle class="arc" cx="100" cy="100" r="78" transform="rotate(-90 100 100)" stroke-dasharray="' + CIRC.toFixed(2) + '" stroke-dashoffset="0"/>' +
        '</svg><span class="digits">45</span><span class="clock-sub lbl">GIÂY</span></div></div>' +
      '<div class="ctrl">' +
        '<button class="btn btn-sm" id="bPause" type="button"></button>' +
        '<button class="btn btn-sm" id="bAdd" type="button">' + Fx.icon('plus') + '<span>15S</span></button>' +
        '<button class="btn btn-sm hold" id="bEnd" type="button"><span class="fill"></span><span class="hl">' + Fx.icon('flag') + '<span>CHỐT SỚM</span></span></button>' +
      '</div>' +
    '</section>');
    var digits = $('.digits', root), sub = $('.clock-sub', root), arc = $('.arc', root), tks = $$('.tk', root);
    var bPause = $('#bPause', root), bAdd = $('#bAdd', root), bEnd = $('#bEnd', root);
    var timer = R.timerCreate(S.remain == null ? R.T.TALK_MS : S.remain);
    var raf = 0, lastSec = null, ringPx = 300, ended = false, digitCount = 2, alt = false;
    S.timer = timer;

    function running() { return R.timerRunning(timer); }
    function setPauseBtn() {
      bPause.innerHTML = running() ? Fx.icon('pause') + '<span>TẠM DỪNG</span>' : Fx.icon('play') + '<span>TIẾP</span>';
      root.classList.toggle('paused', !running());
      sub.textContent = running() ? 'GIÂY' : 'TẠM DỪNG';
    }
    function sizeDigits(sec) {
      var c = String(sec).length;
      if (c !== digitCount || !digits.style.fontSize) {
        digitCount = c;
        digits.style.fontSize = Math.floor(ringPx * (c >= 3 ? 0.36 : 0.5)) + 'px';
      }
    }
    function onSecond(sec, prev) {
      digits.textContent = String(sec);
      sizeDigits(sec);
      var frac = timer.dur ? R.timerRemaining(timer, performance.now()) / timer.dur : 0;
      var lit = Math.ceil(frac * NT - 1e-6);
      for (var i = 0; i < NT; i++) tks[i].classList.toggle('off', i >= lit);
      var alert = sec <= 10 && sec > 0;
      root.classList.toggle('alert', alert);
      if (prev == null || !running()) return;
      if (sec < prev && sec > 0) {
        alt = !alt;
        var inten = alert ? (11 - sec) / 10 : 0;
        Snd.play('clock', { i: inten, alt: alt });
        if (alert) heartbeat(inten);
      }
      save();
    }
    function heartbeat(i) {
      Fx.vibrate(Math.round(18 + i * 40));
      Fx.anim(digits, [{ transform: 'scale(' + (1.1 + i * 0.12) + ')' }, { transform: 'scale(1)' }], { duration: 260, easing: E.out });
      Fx.anim($('.ring', root), [{ transform: 'scale(1.025)' }, { transform: 'scale(1)' }], { duration: 200, easing: E.out });
      edges.forEach(function (e) {
        Fx.anim(e, [{ opacity: 0.35 + i * 0.65 }, { opacity: 0 }], { duration: 160 + i * 140, easing: 'linear', keep: true });
      });
    }
    function frame() {
      raf = 0;
      if (ended) return;
      var now = performance.now();
      var rem = R.timerRemaining(timer, now);
      var sec = R.displaySeconds(rem);
      if (sec !== lastSec) { var prev = lastSec; lastSec = sec; onSecond(sec, prev); }
      arc.setAttribute('stroke-dashoffset', (CIRC * (1 - rem / timer.dur)).toFixed(1));
      if (rem <= 0 && running()) { timeUp(false); return; }
      if (running()) raf = requestAnimationFrame(frame);
    }
    function kick() { if (!raf) raf = requestAnimationFrame(frame); }
    function start() { timer = R.timerStart(timer, performance.now()); S.timer = timer; setPauseBtn(); save(); kick(); }
    function pause(silent) {
      timer = R.timerPause(timer, performance.now()); S.timer = timer; setPauseBtn(); save();
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      frame();
    }
    function timeUp(early) {
      if (ended) return;
      ended = true;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      timer = R.timerPause(timer, performance.now());
      S.phase = 'decide'; S.remain = null; S.timer = null; save();
      digits.textContent = '0'; root.classList.remove('alert');
      if (early) { Snd.play('confirm'); Fx.vibrate(60); } else { Snd.play('buzzer'); Fx.vibrate([260]); }
      busy = true;
      // Hard flash; the cut to the decision screen happens under the opaque frame.
      flash('#FFC21A', 340).then(function () { busy = false; });
      Fx.wait(90).then(function () { if (cur && cur.el === root) show('decide'); });
    }

    tapBtn(bPause, function () { if (running()) pause(); else start(); });
    tapBtn(bAdd, function () {
      timer = R.timerAdd(timer, R.T.BONUS_MS, performance.now()); S.timer = timer;
      lastSec = null; save(); frame(); if (running()) kick();
      Fx.anim(digits, [{ transform: 'translateY(-8%)' }, { transform: 'none' }], { duration: 220, easing: E.punch });
    });
    hold(bEnd, R.T.HOLD_FINISH_MS, { charge: true, onDone: function () { timeUp(true); } });

    return {
      name: 'talk', el: root,
      isRunning: running, pause: pause,
      layout: function () {
        var c = $('.clock', root);
        $$('.duo .nm', root).forEach(function (x) { Fx.shrink(x, 12); });
        ringPx = Math.floor(Math.max(160, Math.min(c.clientWidth - 8, c.clientHeight - 8, 640)));
        root.style.setProperty('--ring', ringPx + 'px');
        digits.style.fontSize = '';
        sizeDigits(R.displaySeconds(R.timerRemaining(timer, performance.now())));
      },
      enter: function () {
        setPauseBtn();
        frame();
        Fx.anim($('.ring', root), [{ transform: 'scale(.4) rotate(-90deg)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 420, easing: E.punch });
        Fx.anim(digits, [{ transform: 'scale(1.6)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 300, delay: 160, easing: E.snap });
        $$('.duo > *, .ctrl > *', root).forEach(function (x, i) {
          Fx.anim(x, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 260, delay: 100 + i * 50, easing: E.out });
        });
        if (opts && opts.autostart) start();
      },
      destroy: function () { ended = true; if (raf) cancelAnimationFrame(raf); edges.forEach(function (e) { Fx.stopAll(e); }); },
      hide: function () { if (running()) save(); },
      wake: function () { kick(); }
    };
  }

  /* ======================================================================
   * DECIDE
   * ==================================================================== */
  function screenDecide() {
    var root = el('<section class="scr decide">' +
      '<div class="q"><span class="lbl"><b>B</b> · ĐOÁN</span><div class="nmbox"></div><div class="q2">GIỮ HAY ĐỔI?</div></div>' +
      '<div class="choices">' +
        '<button class="btn choice hold" type="button" data-c="keep"><span class="fill"></span><span class="hl">' + Fx.icon('hold') + '<span>GIỮ NGUYÊN MÁY</span><span class="sub">GIỮ ĐỂ CHỐT</span></span></button>' +
        '<button class="btn choice hold" type="button" data-c="swap"><span class="fill"></span><span class="hl">' + Fx.icon('swap') + '<span>ĐỔI MÁY</span><span class="sub">GIỮ ĐỂ CHỐT</span></span></button>' +
      '</div>' +
    '</section>');
    var btns = $$('.choice', root), holding = null, committed = false;
    btns.forEach(function (b) {
      hold(b, R.T.HOLD_DECIDE_MS, {
        charge: true,
        enabled: function () { return !committed && (!holding || holding === b); },
        onStart: function () { holding = b; },
        onCancel: function () { holding = null; },
        onDone: function () { committed = true; commit(b.getAttribute('data-c'), b, btns[0] === b ? btns[1] : btns[0]); }
      });
    });
    return {
      name: 'decide', el: root,
      layout: function () {
        fitName($('.nmbox', root), nameB(), 1, 9999, Math.max(44, root.clientHeight * 0.14), 1);
      },
      enter: function () {
        $$('.q > *', root).forEach(function (x, i) {
          Fx.anim(x, [{ opacity: 0, transform: 'translateX(-30px)' }, { opacity: 1, transform: 'none' }], { duration: 280, delay: i * 70, easing: E.out });
        });
        btns.forEach(function (b, i) {
          Fx.anim(b, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: 300, delay: 150 + i * 90, easing: E.punch });
        });
      }
    };
  }

  function commit(choice, btn, other) {
    S.choice = choice; S.phase = 'reveal'; save();
    busy = true;
    var t = tok();
    Snd.play('confirm'); Fx.vibrate(70);
    var r = btn.getBoundingClientRect(), W = w.innerWidth, H = w.innerHeight;
    var holder = choice === R.KEEP ? nameA() : nameB();
    var cf = el('<div class="confirm layer">' +
      '<span class="lbl">' + esc(up(nameB())) + '</span>' +
      '<div class="cbox"></div>' +
      '<span class="lbl cline">' + esc(up(holder)) + ' CẦM MÁY NÀY</span>' +
    '</div>');
    app.appendChild(cf);
    fitName($('.cbox', cf), choice === R.KEEP ? 'GIỮ NGUYÊN MÁY' : 'ĐỔI MÁY', 0.92, 9999, H * 0.3, 2);
    var cl = $('.cline', cf);
    cl.style.fontSize = 'clamp(16px, 5vw, 28px)'; cl.style.fontFamily = 'var(--f-d)'; cl.style.fontWeight = '900'; cl.style.opacity = '1';
    var kids = $$('.cbox .ln, .lbl', cf);
    kids.forEach(function (k) { k.style.opacity = '0'; });
    Fx.anim(other, [{ transform: 'scaleX(1)', opacity: 1 }, { transform: 'scaleX(0)', opacity: 0 }], { duration: 200, easing: E.io, keep: true, hold: true });
    Fx.anim(cf, [
      { transform: 'translate(' + r.left + 'px,' + r.top + 'px) scale(' + (r.width / W) + ',' + (r.height / H) + ')', transformOrigin: '0 0' },
      { transform: 'translate(0,0) scale(1,1)', transformOrigin: '0 0' }
    ], { duration: 300, easing: E.snap, keep: true, hold: true }).then(function () {
      if (!alive(t)) return;
      kids.forEach(function (k, i) {
        Fx.anim(k, [{ opacity: 0, transform: 'translateY(40%)' }, { opacity: 1, transform: 'none' }], { duration: 240, delay: i * 90, easing: E.punch, hold: true })
          .then(function () { k.style.opacity = '1'; });
      });
      return Fx.wait(1250);
    }).then(function () {
      if (!alive(t)) return;
      runReveal(function () { if (cf.parentNode) cf.parentNode.removeChild(cf); });
    });
  }

  /* ======================================================================
   * REVEAL
   * ==================================================================== */
  function runReveal(onBlack) {
    var t = tok();
    busy = true;
    var res = S.secret, safe = res === R.SAFE;
    var rv = el('<div class="layer reveal"><span class="cd"></span></div>');
    app.appendChild(rv);
    if (onBlack) onBlack();
    var cd = $('.cd', rv);
    var nums = [3, 2, 1];
    var step = Fx.reduce ? 600 : 640;
    function count(i) {
      if (!alive(t)) return Promise.resolve();
      if (i >= nums.length) return Promise.resolve();
      cd.textContent = String(nums[i]);
      Snd.play('count', { n: i }); Fx.vibrate(35 + i * 15);
      Fx.anim(cd, [
        { transform: 'scale(2.4)', opacity: 0 },
        { transform: 'scale(.92)', opacity: 1, offset: 0.35 },
        { transform: 'scale(1)', opacity: 1, offset: 0.55 },
        { transform: 'scale(1.04)', opacity: 1, offset: 0.85 },
        { transform: 'scale(.6)', opacity: 0 }
      ], { duration: step, easing: 'cubic-bezier(.2,.8,.2,1)', hold: true });
      return Fx.wait(step).then(function () { return count(i + 1); });
    }
    count(0).then(function () {
      if (!alive(t)) return;
      cd.textContent = '';
      Snd.play('riser', { ms: 420 });
      var scan = el('<i class="scan"></i>'); rv.appendChild(scan);
      Fx.anim(scan, [{ transform: 'translateY(0)' }, { transform: 'translateY(' + w.innerHeight + 'px)' }], { duration: 420, easing: E.io, keep: true, hold: true });
      return Fx.wait(420).then(function () { if (scan.parentNode) scan.parentNode.removeChild(scan); });
    }).then(function () {
      if (!alive(t)) return;
      // hit-frame
      Snd.play('hitframe'); Fx.vibrate([80, 40, 120]);
      flash('#F2EFE6', 140);
      var diag = Math.sqrt(w.innerWidth * w.innerWidth + w.innerHeight * w.innerHeight);
      var k = diag / 10 * 1.05;
      var rim = el('<i class="burst rim"></i>'), burst = el('<i class="burst ' + (safe ? 'safe' : 'out') + '"></i>');
      rv.appendChild(burst); rv.appendChild(rim);
      Fx.anim(burst, [{ transform: 'rotate(45deg) scale(0)' }, { transform: 'rotate(45deg) scale(' + k + ')' }], { duration: 340, delay: 50, easing: E.out, keep: true, hold: true });
      Fx.anim(rim, [{ transform: 'rotate(45deg) scale(0)', opacity: 1 }, { transform: 'rotate(45deg) scale(' + (k * 1.2) + ')', opacity: 0 }], { duration: 520, delay: 90, easing: E.out, keep: true, hold: true });
      Snd.play(safe ? 'revealSafe' : 'revealOut', { delay: 0.05 });
      var holder = S.choice === R.KEEP ? nameA() : nameB();
      var panel = el('<div class="rv ' + (safe ? 'safe' : 'out') + '">' +
        '<span class="lbl">TRONG MÁY · ' + esc(up(holder)) + ' CẦM</span>' +
        Fx.icon(safe ? 'safe' : 'out') +
        '<div class="wordbox"><span class="big w"></span></div>' +
      '</div>');
      rv.appendChild(panel);
      var wEl = $('.w', panel);
      wEl.textContent = safe ? 'AN TOÀN' : 'BỊ LOẠI';
      Fx.fit(wEl, 0.78, 9999, w.innerHeight * (w.innerWidth > w.innerHeight ? 0.42 : 0.22));
      var chs = Fx.letters(wEl, safe ? 'AN TOÀN' : 'BỊ LOẠI');
      var svg = $('svg', panel);
      Fx.drawable(svg);
      chs.forEach(function (c) { c.style.opacity = '0'; });
      $('.lbl', panel).style.opacity = '0';
      return Fx.wait(260).then(function () {
        if (!alive(t)) return;
        chs.forEach(function (c, i) {
          Fx.anim(c, [{ opacity: 0, transform: 'translateY(-40%) scale(1.5)' }, { opacity: 1, transform: 'none' }], { duration: 230, delay: i * 55, easing: E.punch, hold: true })
            .then(function () { c.style.opacity = '1'; });
        });
        Fx.drawOn(svg, 420, 80);
        Fx.anim($('.lbl', panel), [{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 0.85, transform: 'none' }], { duration: 260, delay: 420, easing: E.out, hold: true })
          .then(function () { $('.lbl', panel).style.opacity = '.85'; });
        if (!safe) Fx.anim(panel, [{ transform: 'translateX(0)' }, { transform: 'translateX(-10px)' }, { transform: 'translateX(8px)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(0)' }], { duration: 260, delay: 60, easing: 'linear' });
        return Fx.wait(2000);
      });
    }).then(function () {
      if (!alive(t)) return;
      // hard cut to the winner card
      show('result', { fanfare: true });
      if (rv.parentNode) rv.parentNode.removeChild(rv);
      busy = false;
    });
  }

  /* ======================================================================
   * RESULT
   * ==================================================================== */
  function screenResult(opts) {
    var r = R.resolve(S.secret, S.choice);
    var win = r.winner === 'A' ? nameA() : nameB(), lose = r.winner === 'A' ? nameB() : nameA();
    var holder = r.holder === 'A' ? nameA() : nameB();
    var safeIn = S.secret === R.SAFE;
    var root = el('<section class="scr result">' +
      '<div class="win"><div class="crown">' + Fx.icon('safe') + '<span class="lbl">THẮNG · AN TOÀN</span></div><div class="nmbox"></div></div>' +
      '<div class="meta">' +
        '<div class="loser"><span class="ln">' + esc(up(lose)) + '</span><span class="tag">· BỊ LOẠI</span></div>' +
        '<div class="facts"><div><span class="lbl">TRONG MÁY</span><span class="v">' + Fx.icon(safeIn ? 'safe' : 'out') + (safeIn ? 'AN TOÀN' : 'BỊ LOẠI') + '</span></div>' +
          '<div><span class="lbl">CẦM MÁY</span><span class="v">' + esc(up(holder)) + '</span></div></div>' +
      '</div>' +
      '<div class="acts row">' +
        '<button class="btn btn-primary" id="bAgain" type="button">' + Fx.icon('replay') + '<span>VÁN MỚI</span></button>' +
        '<button class="btn" id="bPeople" type="button">' + Fx.icon('people') + '<span>ĐỔI NGƯỜI</span></button>' +
      '</div>' +
    '</section>');
    tapBtn($('#bAgain', root), function () {
      var nm = S.names, rd = S.round + 1;
      S = newRound(nm, rd); save();
      wipe(function () { show('roles'); });
    });
    tapBtn($('#bPeople', root), function () {
      S = null; save();
      wipe(function () { show('home'); });
    });
    return {
      name: 'result', el: root,
      layout: function () {
        var wb = $('.win', root);
        fitName($('.nmbox', root), win, 0.98, 9999, Math.max(60, wb.clientHeight - 56), 2);
        $$('.loser .ln, .facts .v', root).forEach(function (x) { Fx.shrink(x, 12); });
      },
      enter: function () {
        var lines = $$('.nmbox .ln', root);
        if (opts && opts.fanfare) { Snd.play('fanfare'); Fx.vibrate([60, 60, 140]); }
        lines.forEach(function (l, i) {
          Fx.anim(l, [{ transform: 'translateX(-110%)' }, { transform: 'translateX(4%)', offset: 0.7 }, { transform: 'none' }], { duration: 420, delay: 60 + i * 90, easing: E.out });
        });
        Fx.anim($('.crown', root), [{ opacity: 0, transform: 'translateY(-10px)' }, { opacity: 1, transform: 'none' }], { duration: 240, delay: 260, easing: E.out });
        $$('.meta > *, .acts > *', root).forEach(function (x, i) {
          Fx.anim(x, [{ opacity: 0, transform: 'translateY(20px)' }, { opacity: 1, transform: 'none' }], { duration: 280, delay: 380 + i * 70, easing: E.out });
        });
      }
    };
  }

  /* ---------- routing ---------- */
  var SCREENS = { home: screenHome, roles: screenRoles, peek: screenPeek, talk: screenTalk, decide: screenDecide, result: screenResult };
  function show(name, opts) {
    mount(SCREENS[name](opts || {}));
    keepAwake();
  }
  function resume() {
    if (!S) { show('home'); return; }
    var ph = S.phase;
    if (ph === 'talk' && S.remain != null && S.remain <= 0) { S.phase = ph = 'decide'; save(); }
    if (ph === 'reveal') show('result');
    else show(ph);
  }

  /* ---------- HUD controls ---------- */
  var bMute = $('#btnMute'), bFull = $('#btnFull'), bHome = $('#btnHome');
  bHome.innerHTML = Fx.icon('home');
  function setMuteIcon() { bMute.innerHTML = Fx.icon(Snd.muted ? 'mute' : 'sound'); bMute.setAttribute('aria-label', Snd.muted ? 'Bật tiếng' : 'Tắt tiếng'); bMute.setAttribute('aria-pressed', Snd.muted ? 'true' : 'false'); }
  Snd.setMuted(B.store.get(KEY_MUTE) === '1');
  setMuteIcon();
  bMute.addEventListener('click', B.guard(function () {
    Snd.unlock();
    Snd.setMuted(!Snd.muted); B.store.set(KEY_MUTE, Snd.muted ? '1' : '0'); setMuteIcon();
    Snd.play('tap');
  }));
  var fsOk = !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
  var rootEl = d.documentElement;
  if (fsOk && (rootEl.requestFullscreen || rootEl.webkitRequestFullscreen)) {
    bFull.hidden = false; bFull.innerHTML = Fx.icon('full');
    bFull.addEventListener('click', B.guard(function () {
      Snd.play('tap');
      var fe = d.fullscreenElement || d.webkitFullscreenElement;
      try {
        if (fe) { (d.exitFullscreen || d.webkitExitFullscreen).call(d); }
        else { var p = (rootEl.requestFullscreen || rootEl.webkitRequestFullscreen).call(rootEl); if (p && p.catch) p.catch(function () {}); }
      } catch (e) {}
    }));
  }
  bHome.addEventListener('click', B.guard(function () {
    if (busy || peek || !cur || cur.name === 'home') return;
    Snd.play('tap');
    if (cur.name === 'talk' && cur.isRunning && cur.isRunning()) cur.pause();
    if (cur.name === 'result') { S = null; save(); }
    wipe(function () { show('home'); });
  }));

  /* ---------- wake lock ---------- */
  var wl = null;
  function keepAwake() {
    if (!('wakeLock' in navigator) || d.hidden || wl) return;
    try {
      navigator.wakeLock.request('screen').then(function (l) {
        wl = l; l.addEventListener('release', function () { wl = null; });
      }, function () {});
    } catch (e) {}
  }

  /* ---------- global gestures & lifecycle ---------- */
  function firstGesture() { Snd.unlock(); keepAwake(); }
  d.addEventListener('pointerdown', firstGesture, true);
  d.addEventListener('touchend', firstGesture, true);
  d.addEventListener('keydown', firstGesture, true);
  // iOS: block pinch and double-tap zoom on the app surface (inputs excluded).
  d.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  d.addEventListener('dblclick', function (e) { e.preventDefault(); });
  d.addEventListener('touchmove', function (e) { if (e.touches && e.touches.length > 1) e.preventDefault(); }, { passive: false });
  d.addEventListener('contextmenu', function (e) { if (!(e.target && e.target.tagName === 'INPUT')) e.preventDefault(); });

  d.addEventListener('visibilitychange', B.guard(function () {
    if (d.hidden) {
      if (peek) closePeek(true);           // lock immediately, no animation
      if (cur && cur.hide) cur.hide();
      save();
    } else {
      keepAwake();
      Snd.unlock();
      if (cur && cur.wake) cur.wake();
    }
  }));
  w.addEventListener('pagehide', function () { if (peek) closePeek(true); save(); });

  var rt = 0;
  function relayout() {
    clearTimeout(rt);
    rt = setTimeout(B.guard(function () { B.measure(); if (cur && cur.layout) cur.layout(); }), 120);
  }
  w.addEventListener('resize', relayout);
  w.addEventListener('orientationchange', relayout);

  /* ---------- recovery ---------- */
  var rec = $('#recover');
  B.onFatal(function () {
    try {
      tok(); busy = false;
      if (peek) { clearInterval(peek.iv); clearTimeout(peek.timer); peek = null; }
      peekLayer.hidden = true; peekLayer.innerHTML = '';
      $$('.reveal, .confirm', app).forEach(function (x) { x.parentNode.removeChild(x); });
      rec.hidden = false;
    } catch (e) {}
  });
  $('#recResume').addEventListener('click', function () {
    rec.hidden = true;
    try { S = loadRound(); resume(); } catch (e) { S = null; show('home'); }
  });
  $('#recNew').addEventListener('click', function () {
    rec.hidden = true;
    try {
      var old = loadRound();
      if (old) { S = newRound(old.names, old.round + 1); save(); show('roles'); }
      else { S = null; save(); show('home'); }
    } catch (e) { S = null; show('home'); }
  });

  /* ---------- boot ---------- */
  function boot() {
    var saved = loadRound();
    if (saved && Date.now() - saved.ts < STALE_MS) { S = saved; resume(); }
    else show('home');
    // Refit once webfonts are in (metrics change); never blocks first paint.
    if (d.fonts && d.fonts.ready) d.fonts.ready.then(function () { if (cur && cur.layout) cur.layout(); });
  }
  B.guard(boot)();

  /* ---------- service worker (https only) ---------- */
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    w.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }

  // Test hook (read-only; does not expose the secret).
  w.__docvi = { phase: function () { return cur && cur.name; }, busy: function () { return busy; } };
})(window, document);
