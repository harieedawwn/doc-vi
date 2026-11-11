/* fx.js — motion helpers (Web Animations API only), icons, text fitting. */
(function (w, d) {
  'use strict';
  var reduce = d.documentElement.classList.contains('reduce');
  var canAnimate = !!(d.body ? d.body.animate : Element.prototype.animate);

  var E = {
    snap: 'cubic-bezier(.2,.9,.1,1)',
    out: 'cubic-bezier(.16,1,.3,1)',
    punch: 'cubic-bezier(.3,1.7,.45,1)',
    slam: 'cubic-bezier(.75,0,.95,.35)',
    io: 'cubic-bezier(.7,0,.2,1)',
    lin: 'linear'
  };

  /* Animate and resolve when done. Under reduced motion, transforms become a short crossfade. */
  function anim(el, frames, o) {
    o = o || {};
    return new Promise(function (resolve) {
      if (!el || !canAnimate) { resolve(); return; }
      // Default fill 'backwards': the end state is the element's own CSS, so nothing lingers on a
      // composited layer once finished (keeps static frames pixel-stable). hold:true keeps the end frame.
      var f = frames, opts = { duration: o.duration || 240, easing: o.easing || E.snap, delay: o.delay || 0, fill: o.hold ? 'both' : 'backwards', iterations: o.iterations || 1 };
      if (reduce && !o.keep) {
        var a = frames[0].opacity, b = frames[frames.length - 1].opacity;
        f = [{ opacity: a == null ? 1 : a }, { opacity: b == null ? 1 : b }];
        opts.duration = Math.min(opts.duration, 180); opts.easing = 'linear';
        if (opts.iterations === Infinity) opts.iterations = 1;
      }
      var an;
      try { an = el.animate(f, opts); } catch (e) { resolve(); return; }
      if (opts.iterations === Infinity) { resolve(an); return; }
      var done = false;
      function fin() { if (!done) { done = true; resolve(an); } }
      an.onfinish = fin; an.oncancel = fin;
    });
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function stopAll(el) {
    if (!el || !el.getAnimations) return;
    try { el.getAnimations().forEach(function (a) { a.cancel(); }); } catch (e) {}
  }

  /* Fit a single-line element's font-size so it spans `frac` of its container width,
   * capped by maxPx (and by maxH, the element's allowed height in px). */
  function fit(el, frac, maxPx, maxH) {
    if (!el || !el.parentNode) return;
    var box = el.parentNode.clientWidth;
    if (!box) return;
    el.style.fontSize = '100px';
    el.style.whiteSpace = 'nowrap';
    el.style.display = 'inline-block';
    var wd = el.scrollWidth || 1;
    var size = 100 * (box * frac) / wd;
    if (maxPx) size = Math.min(size, maxPx);
    if (maxH) size = Math.min(size, maxH);
    el.style.fontSize = Math.max(12, Math.floor(size)) + 'px';
  }

  /* Shrink a single-line element's font until its text fits its own box (never grows). */
  function shrink(el, minPx) {
    if (!el) return;
    el.style.fontSize = '';
    var cw = el.clientWidth, sw = el.scrollWidth;
    if (!cw || sw <= cw + 1) return;
    var cur = parseFloat(getComputedStyle(el).fontSize) || 16;
    el.style.fontSize = Math.max(minPx || 11, Math.floor(cur * cw / sw * 0.98)) + 'px';
  }

  /* Split text into per-letter spans for staggered builds (NFC keeps Vietnamese letters whole). */
  function letters(el, text) {
    var t = text.normalize ? text.normalize('NFC') : text;
    el.textContent = '';
    var out = [];
    for (var i = 0; i < t.length; i++) {
      var s = d.createElement('span');
      s.className = t[i] === ' ' ? 'ch sp' : 'ch';
      s.textContent = t[i] === ' ' ? ' ' : t[i];
      el.appendChild(s); out.push(s);
    }
    return out;
  }

  /* Prepare an SVG's strokes for a draw-on animation; returns the paths. */
  function drawable(svg) {
    var ps = svg.querySelectorAll('path,polyline,polygon,line,rect,circle');
    var list = [];
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i], len = 200;
      try { len = Math.ceil(p.getTotalLength()) + 2; } catch (e) {}
      p.style.strokeDasharray = len + ' ' + len;
      p.style.strokeDashoffset = String(len);
      list.push({ el: p, len: len });
    }
    return list;
  }
  function drawOn(svg, dur, delay) {
    var list = drawable(svg);
    return Promise.all(list.map(function (o, i) {
      return anim(o.el, [{ strokeDashoffset: o.len }, { strokeDashoffset: 0 }], { duration: dur, delay: (delay || 0) + i * 90, easing: E.out, keep: true, hold: true })
        .then(function () { o.el.style.strokeDashoffset = '0'; });
    }));
  }

  /* ---------- icons: 48 grid, 4px stroke, miter joins, square caps ---------- */
  var P = {
    safe: '<path d="M24 4 L41 10 V25 L24 44 L7 25 V10 Z"/><path d="M15 24 L22 31 L34 18"/>',
    out: '<path d="M17 4 H31 L44 17 V31 L31 44 H17 L4 31 V17 Z"/><path d="M16 16 L32 32 M32 16 L16 32"/>',
    lock: '<path d="M15 21 V11 H33 V21"/><path d="M8 21 H40 V44 H8 Z"/><path d="M24 29 V36"/>',
    eye: '<path d="M3 24 L14 13 H34 L45 24 L34 35 H14 Z"/><path d="M20 20 H28 V28 H20 Z" fill="currentColor"/>',
    timer: '<path d="M19 4 H29 M24 4 V10"/><path d="M15 12 L9 18 V32 L15 38 H33 L39 32 V18 L33 12 Z"/><path d="M24 17 V26 L30 30"/>',
    swap: '<path d="M6 16 H40 M32 8 L40 16 L32 24"/><path d="M42 32 H8 M16 24 L8 32 L16 40"/>',
    hold: '<path d="M10 25 V20 H15 V27 M15 22 V8 H20 V22 M20 20 V5 H25 V22 M25 20 V7 H30 V22 M30 21 V11 H35 V30 L30 42 H16 L10 33 Z"/>',
    sound: '<path d="M5 18 H13 L23 9 V39 L13 30 H5 Z"/><path d="M30 17 L34 24 L30 31"/><path d="M36 11 L42 24 L36 37"/>',
    mute: '<path d="M5 18 H13 L23 9 V39 L13 30 H5 Z"/><path d="M31 18 L43 30 M43 18 L31 30"/>',
    full: '<path d="M5 16 V5 H16 M32 5 H43 V16 M43 32 V43 H32 M16 43 H5 V32"/>',
    dice: '<path d="M6 6 H42 V42 H6 Z"/><path d="M14 14 H19 V19 H14 Z M29 14 H34 V19 H29 Z M21.5 21.5 H26.5 V26.5 H21.5 Z M14 29 H19 V34 H14 Z M29 29 H34 V34 H29 Z" fill="currentColor" stroke-width="0"/>',
    replay: '<path d="M9 24 V39 H39 V9 H20"/><path d="M26 3 L20 9 L26 15"/>',
    pause: '<path d="M15 9 V39 M33 9 V39"/>',
    play: '<path d="M13 7 L39 24 L13 41 Z"/>',
    plus: '<path d="M24 9 V39 M9 24 H39"/>',
    flag: '<path d="M10 44 V5 M10 7 H38 L32 16 L38 25 H10"/>',
    people: '<path d="M8 6 H22 V20 H8 Z M26 6 H40 V20 H26 Z"/><path d="M4 42 V30 L9 25 H21 L26 30 M22 30 L27 25 H39 L44 30 V42"/>',
    home: '<path d="M6 22 L24 6 L42 22 V42 H6 Z"/><path d="M19 42 V29 H29 V42"/>'
  };
  function icon(name, cls) {
    return '<svg class="ico ' + (cls || '') + '" viewBox="0 0 48 48" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="miter" stroke-linecap="square">' + P[name] + '</svg>';
  }

  function vibrate(p) { if (w.Sound) w.Sound.buzz(p); }

  w.Fx = { E: E, anim: anim, shrink: shrink, wait: wait, stopAll: stopAll, fit: fit, letters: letters, drawOn: drawOn, drawable: drawable, icon: icon, vibrate: vibrate, get reduce() { return reduce; } };
})(window, document);
