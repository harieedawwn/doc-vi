/* boot.js — first script in <head>. Viewport height, in-app browser stubs, safe storage,
 * and the error safety net (recovery screen only for errors from our own code). */
(function (w, d) {
  'use strict';
  var root = d.documentElement;

  // Zalo's in-app browser calls this bridge on pages that never loaded its SDK.
  try { if (!w.zaloJSV2) w.zaloJSV2 = { zalo_h5_event_handler: function () {}, getCookieFallback: function () { return ''; } }; } catch (e) {}

  /* --app-h: the real visible height (Zalo/iOS toolbars change it; 100dvh is not enough everywhere). */
  function measure() {
    var h = w.innerHeight, wd = w.innerWidth;
    root.style.setProperty('--app-h', h + 'px');
    root.style.setProperty('--app-w', wd + 'px');
    root.classList.toggle('is-land', wd > h);
    root.classList.toggle('is-short', h < 500);
  }
  measure();
  w.addEventListener('resize', measure);
  w.addEventListener('orientationchange', function () { measure(); setTimeout(measure, 300); });

  // Preload the display font over http(s) only (file:// blocks crossorigin font preloads).
  if (/^https?:$/.test(location.protocol)) {
    ['latin', 'vietnamese'].forEach(function (sub) {
      var l = d.createElement('link');
      l.rel = 'preload'; l.as = 'font'; l.type = 'font/woff2'; l.crossOrigin = 'anonymous';
      l.href = 'fonts/be-vietnam-pro-' + sub + '-900-normal.woff2';
      d.head.appendChild(l);
    });
  }

  // iOS 14.0–14.4 lacks flexbox gap: detect and let CSS fall back to margins.
  function flexGap() {
    try {
      var f = d.createElement('div');
      f.style.cssText = 'display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden';
      f.appendChild(d.createElement('div')); f.appendChild(d.createElement('div'));
      root.appendChild(f);
      var okGap = f.scrollHeight === 1;
      root.removeChild(f);
      return okGap;
    } catch (e) { return true; }
  }
  if (!flexGap()) root.classList.add('no-fg');

  var ua = navigator.userAgent || '';
  root.classList.toggle('is-ios', /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
  try { if (w.matchMedia('(prefers-reduced-motion: reduce)').matches) root.classList.add('reduce'); } catch (e) {}

  /* Storage that never throws; falls back to memory (private mode, blocked cookies, file://). */
  var mem = {};
  var store = {
    get: function (k) { try { var v = w.localStorage.getItem(k); return v == null ? (k in mem ? mem[k] : null) : v; } catch (e) { return k in mem ? mem[k] : null; } },
    set: function (k, v) { mem[k] = String(v); try { w.localStorage.setItem(k, String(v)); } catch (e) {} },
    del: function (k) { delete mem[k]; try { w.localStorage.removeItem(k); } catch (e) {} }
  };

  /* Errors: ignore foreign noise (in-app bridges, extensions); show recovery for ours. */
  var FOREIGN = /zaloJSV2|zalo_h5|ZaloJavaScriptInterface|WeixinJSBridge|FB_IAB|fbq|__gCrWeb|webkit\.messageHandlers|_AutofillCallbackHandler|ResizeObserver loop|^Script error\.?$|-extension:\/\/|AbortError|NotAllowedError/i;
  var OURS = /\/js\/(boot|rules|audio|fx|app)\.js/;
  var handler = null, pending = null;
  function report(msg, src, stack) {
    var s = String(msg || '') + ' ' + String(src || '') + ' ' + String(stack || '');
    if (FOREIGN.test(String(msg || '')) || FOREIGN.test(s) && !OURS.test(s)) return;
    if (!OURS.test(s)) return;
    try { console.warn('[đọc vị] recovered from error:', msg); } catch (e) {}
    if (handler) handler(msg); else pending = msg;
  }
  w.onerror = function (msg, src, line, col, err) { report(msg, src, err && err.stack); return false; };
  w.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason; report(r && r.message || String(r), '', r && r.stack);
  });

  w.Boot = {
    store: store,
    measure: measure,
    onFatal: function (fn) { handler = fn; if (pending) { var p = pending; pending = null; fn(p); } },
    report: report,
    /* Wrap a handler: errors inside become a recovery screen instead of a dead app. */
    guard: function (fn) {
      return function () {
        try { return fn.apply(this, arguments); }
        catch (err) { report(err && err.message, '/js/app.js', (err && err.stack || '') + ' /js/app.js'); }
      };
    }
  };
})(window, document);
