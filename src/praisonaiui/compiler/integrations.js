/* aiui integrations loader (docs/features/analytics.md), written beside the pages by
 * `aiui build`. Settings: <script type="application/json" id="aiui-integrations-config">;
 * the build checked every id and URL in them. */
(function (w, d) {
  'use strict';
  var block = d.getElementById('aiui-integrations-config');
  if (!block || w.__aiuiIntegrations) return;
  w.__aiuiIntegrations = true;
  var cfg = JSON.parse(block.textContent || '{}');
  var providers = cfg.providers || {};
  var consent = cfg.consent;
  var KEY = 'aiui-consent';
  var started = false;
  var onPage = []; // called on each client-side page change
  var last = '';

  function load(src, attrs, onload) {
    var s = d.createElement('script');
    s.async = true;
    s.src = src;
    for (var k in attrs || {}) s.setAttribute(k, attrs[k]);
    if (onload) s.onload = onload;
    (d.head || d.documentElement).appendChild(s);
  }

  // The array a library replays once it loads: obj.method(...) pushes [method, ...].
  function stub(name, methods) {
    var q = (w[name] = w[name] || []);
    q.people = q.people || [];
    methods.forEach(function (m) {
      q[m] = q[m] || function () { q.push([m].concat([].slice.call(arguments))); return q; };
    });
    return q;
  }

  // A function that queues its calls until the library replaces it.
  function queueFn(name) {
    var f = w[name] || (w[name] = function () { (f.q = f.q || []).push(arguments); });
    return f;
  }

  // GA4, PostHog, Plausible, Fathom, Umami and Mixpanel count history
  // changes themselves; the others add to onPage.
  var RUN = {
    ga4: function (o) {
      w.dataLayer = w.dataLayer || [];
      w.gtag = w.gtag || function () { w.dataLayer.push(arguments); };
      w.gtag('js', new Date());
      w.gtag('config', o.id);
      load(o.src);
    },
    gtm: function (o) {
      w.dataLayer = w.dataLayer || [];
      w.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
      load(o.src);
      onPage.push(function () {
        w.dataLayer.push({ event: 'aiui.pageview', page_path: location.pathname, page_title: d.title });
      });
    },
    posthog: function (o) {
      var ph = stub('posthog', ['capture', 'identify']);
      ph.__SV = 1;
      ph._i = [[o.key, { api_host: o.host, capture_pageview: 'history_change',
        disable_session_recording: !o.replay }, 'posthog']];
      load(o.src, { crossorigin: 'anonymous' });
    },
    plausible: function (o) { load(o.src, { 'data-domain': o.domain }); },
    fathom: function (o) { load(o.src, { 'data-site': o.site, 'data-spa': 'auto' }); },
    umami: function (o) { load(o.src, { 'data-website-id': o.website }); },
    segment: function (o) {
      var a = stub('analytics', ['page', 'track', 'identify']);
      a._writeKey = o.key;
      a.page();
      load(o.src);
      onPage.push(function () { w.analytics.page(); });
    },
    mixpanel: function (o) {
      var mp = stub('mixpanel', ['track', 'identify']);
      mp.__SV = 1.2;
      mp._i = [[o.token, { api_host: o.host, track_pageview: 'url-with-path' }, 'mixpanel']];
      load(o.src);
    },
    scripts: function (o) { o.urls.forEach(function (u) { load(u); }); },
    intercom: function (o) {
      w.intercomSettings = { app_id: o.app };
      queueFn('Intercom')('boot', { app_id: o.app });
      load(o.src);
      onPage.push(function () { w.Intercom('update'); });
    },
    crisp: function (o) { w.$crisp = w.$crisp || []; w.CRISP_WEBSITE_ID = o.website; load(o.src); },
    front: function (o) {
      load(o.src, null, function () { w.FrontChat('init', { chatId: o.chat, useDefaultLauncher: true }); });
    },
  };

  function start() {
    if (started) return;
    started = true;
    last = location.pathname + location.search;
    var n = w.navigator || {};
    var optedOut = n.globalPrivacyControl === true || n.doNotTrack === '1' || w.doNotTrack === '1';
    Object.keys(providers).forEach(function (name) {
      var support = (cfg.support || []).indexOf(name) >= 0;
      if (!RUN[name] || (!support && optedOut && cfg.respectDoNotTrack)) return;
      var go = function () {
        try { RUN[name](providers[name]); } catch (e) { console.warn('[aiui] ' + name, e); }
      };
      if (!support) go();
      else if (w.requestIdleCallback) w.requestIdleCallback(go, { timeout: 4000 });
      else setTimeout(go, 1500);
    });
  }

  // One page view per new URL: at once on aiui:content-loaded (the title is set by
  // then), else a second after a navigation or back/forward.
  var timer;
  function pageView() {
    clearTimeout(timer);
    var here = location.pathname + location.search;
    if (!started || here === last) return;
    last = here;
    onPage.forEach(function (f) { try { f(); } catch (e) { /* not loaded yet */ } });
  }
  w.addEventListener('aiui:content-loaded', pageView);
  ['aiui:navigate', 'popstate'].forEach(function (type) {
    w.addEventListener(type, function () { clearTimeout(timer); timer = setTimeout(pageView, 1000); });
  });

  if (!consent) return start();

  var banner = null;
  function choose(granted) {
    try { w.localStorage.setItem(KEY, granted ? 'granted' : 'denied'); } catch (e) { /* private mode */ }
    if (banner) banner.remove();
    banner = null;
    if (granted) start();
    else if (started) location.reload(); // stop what already runs
  }

  function el(tag, text, cls) {
    var e = d.createElement(tag);
    if (text) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }

  function show() {
    if (banner || !consent.banner) return;
    if (!d.body) return d.addEventListener('DOMContentLoaded', show);
    banner = el('div', '', 'aiui-consent');
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Cookie consent');
    var text = banner.appendChild(el('p', consent.text));
    if (consent.policy) {
      text.appendChild(d.createTextNode(' '));
      text.appendChild(el('a', consent.policyLabel)).href = consent.policy;
    }
    var row = banner.appendChild(el('div', '', 'aiui-consent-actions'));
    [[consent.decline, false], [consent.accept, true]].forEach(function (b) {
      var btn = row.appendChild(el('button', b[0]));
      btn.type = 'button';
      btn.addEventListener('click', function () { choose(b[1]); });
    });
    d.body.appendChild(banner);
  }

  // Your own consent tool: dispatch aiui:consent with { detail: { granted } }.
  w.addEventListener('aiui:consent', function (e) { choose(!!(e.detail && e.detail.granted)); });
  // A link to #cookie-settings (say in the footer) opens the banner again.
  d.addEventListener('click', function (e) {
    var link = e.target && e.target.closest && e.target.closest('a[href$="#cookie-settings"]');
    if (link) { e.preventDefault(); show(); }
  }, true);

  var choice = null;
  try { choice = w.localStorage.getItem(KEY); } catch (e) { /* private mode */ }
  if (choice === 'granted') start();
  else if (choice !== 'denied') show();
})(window, document);
