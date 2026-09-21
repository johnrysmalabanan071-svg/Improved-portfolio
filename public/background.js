/*!
 * Rys Automate: "Routes" background
 *
 * A sparse map of thin routes, like a transit diagram for your automations.
 * Lines run left to right with 45° turns; small stations sit at some of the turns;
 * a few short packets travel along each route, slowly.
 *
 *   Cursor       lights the nearest route around the cursor and wakes nearby stations.
 *   Click / tap  sends a packet down the nearest route, lighting each station it passes.
 *   Scroll       the map drifts upward at a fraction of page speed.
 *   "Run the workflow"  a bright packet crosses one route and lights four stage nodes.
 *
 * Plain script, no dependencies, no inline styles, no network. Works under
 * `script-src 'self'; style-src 'self'` (see vercel.json).
 *
 * Optional hooks (all automatic):
 *   #bg-routes                  host element; created if missing
 *   [data-bg-calm]              areas dimmed so text stays readable
 *   [data-bg-pulse]             element that triggers the pulse on click
 *                               (a button whose text contains "run the workflow" is detected)
 *   window.RysRoutes.pulse(y)   trigger the pulse by hand at viewport y
 *   --route-rgb                 CSS variable on the host, e.g. "94, 234, 212"
 */
(function () {
  'use strict';

  var win = window, doc = document;
  if (win.__rysRoutes) return;
  win.__rysRoutes = true;

  /* ---- Tuning ---------------------------------------------------------- */
  var CONFIG = {
    rgb: [94, 234, 212],     // fallback if --route-rgb is not set
    lineAlpha: 0.09,         // resting route line
    lineLens: 0.45,          // extra brightness near the cursor
    packetAlpha: 0.32,
    packetLens: 0.5, 
    stationAlpha: 0.22,
    stationLens: 0.8, 
    calmDim: 0.6,            // dimming inside [data-bg-calm] (0-1)
    calmFeather: 90,
    lensRadius: 170,         // how far from a route the cursor still lights it
    lensAlong: 300,          // how far along the route the light spreads
    parallax: 0.18,          // map scroll speed relative to the page
    pulseSeconds: 2.6
  };

  /* ---- Helpers --------------------------------------------------------- */
  var TAU = Math.PI * 2;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  /* ---- Host + canvas --------------------------------------------------- */
  var host = doc.getElementById('bg-routes');
  if (!host) {
    host = doc.createElement('div');
    host.id = 'bg-routes';
    host.className = 'bg-routes';
    host.setAttribute('aria-hidden', 'true');
    doc.body.insertBefore(host, doc.body.firstChild);
  }
  var canvas = doc.createElement('canvas');
  host.appendChild(canvas);
  var ctx = canvas.getContext('2d');
  if (!ctx) return;

  var root = doc.documentElement;
  var reduceMq = win.matchMedia ? win.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var reduced = !!(reduceMq && reduceMq.matches);

  function readRgb() {
    var v = '';
    try { v = String(win.getComputedStyle(host).getPropertyValue('--route-rgb') || '').trim(); } catch (e) {}
    var m = v.match(/(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
    return m ? [+m[1], +m[2], +m[3]] : CONFIG.rgb;
  }
  var rgb = readRgb();
  var rgbPrefix = 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',';
  function rgba(a) { return rgbPrefix + a.toFixed(3) + ')'; }

  /* ---- State ----------------------------------------------------------- */
  var W = 0, H = 0, FH = 0, dpr = 1, small = false, docH = 0;
  var routes = [], calm = [];
  var bursts = [], rings = [], pulse = null;
  var time = 0, last = 0, raf = 0, live = false;
  var px = 0, py = 0, tx = 0, ty = 0, presence = 0, ptarget = 0, hasPointer = false, touchT = 0;
  var stillQueued = false;

  /* ---- Geometry -------------------------------------------------------- */
  function makeRoute(r, y0, unit) {
    var pts = [{ x: -30, y: y0 }], bendAt = [];
    var x = -30, y = y0, dir = r() < 0.5 ? -1 : 1, guard = 0;
    while (x < W + 30 && guard++ < 80) {
      x += (small ? 90 : 140) + r() * (small ? 160 : 300);
      var shift = (1 + Math.floor(r() * 3)) * unit;
      if (r() < 0.5) dir = -dir;
      if (y + dir * shift < 30 || y + dir * shift > FH - 30) dir = -dir;
      pts.push({ x: x, y: y });
      if (r() < 0.65) bendAt.push(pts.length - 1);
      x += shift; y += dir * shift;
      pts.push({ x: x, y: y });
    }
    pts.push({ x: x + 40, y: y });

    var cum = [0];
    for (var i = 1; i < pts.length; i++) {
      var dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
      cum.push(cum[i - 1] + Math.sqrt(dx * dx + dy * dy));
    }
    var route = { pts: pts, cum: cum, total: cum[cum.length - 1], stations: [], packets: [], force: 0 };
    for (var b = 0; b < bendAt.length; b++) {
      var pi = bendAt[b];
      route.stations.push({ x: pts[pi].x, y: pts[pi].y, s: cum[pi], lit: 0 });
    }
    var n = 2 + Math.floor(r() * 2);
    for (var k = 0; k < n; k++) {
      route.packets.push({ s: r() * route.total, v: 20 + r() * 26, L: 24 + r() * 34 });
    }
    return route;
  }

  function size() {
    W = host.clientWidth || win.innerWidth;
    H = host.clientHeight || win.innerHeight;
    small = W < 640;
    dpr = Math.min(win.devicePixelRatio || 1, small ? 1.5 : 2);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }

  function fieldHeight() {
    var maxScroll = Math.max(0, docH - H);
    return H + Math.min(maxScroll * CONFIG.parallax, H * 2) + 120;
  }

  function layout() {
    FH = fieldHeight();
    var count = clamp(Math.round(FH / (small ? 150 : 128)), 4, 12);
    var r = rng(20260921);
    routes = [];
    for (var i = 0; i < count; i++) {
      routes.push(makeRoute(r, FH * (i + 0.5) / count + (r() - 0.5) * 36, small ? 24 : 32));
    }
  }

  function posAt(route, s) {
    var pts = route.pts, cum = route.cum;
    s = clamp(s, 0, route.total);
    var i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    var seg = cum[i] - cum[i - 1] || 1;
    var t = (s - cum[i - 1]) / seg;
    return { x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * t, y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t, i: i };
  }

  // x only ever increases along a route, so y can be read straight from x.
  function yAtX(route, x) {
    var pts = route.pts;
    if (x <= pts[0].x) return pts[0].y;
    var i = 1;
    while (i < pts.length - 1 && pts[i].x < x) i++;
    var dx = pts[i].x - pts[i - 1].x || 1;
    var t = clamp((x - pts[i - 1].x) / dx, 0, 1);
    return pts[i - 1].y + (pts[i].y - pts[i - 1].y) * t;
  }

  function nearestOn(route, x, y) {
    var pts = route.pts, best = 1e12, bs = 0;
    for (var i = 1; i < pts.length; i++) {
      var ax = pts[i - 1].x, ay = pts[i - 1].y, bx = pts[i].x, by = pts[i].y;
      var dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
      var t = clamp(((x - ax) * dx + (y - ay) * dy) / len2, 0, 1);
      var cx = ax + dx * t, cy = ay + dy * t;
      var d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d2 < best) { best = d2; bs = route.cum[i - 1] + t * Math.sqrt(len2); }
    }
    return { d: Math.sqrt(best), s: bs };
  }

  function measure() {
    docH = Math.max(root.scrollHeight || 0, doc.body ? doc.body.scrollHeight || 0 : 0);
    calm = [];
    var sx = win.pageXOffset || 0, sy = win.pageYOffset || 0;
    var els = doc.querySelectorAll('[data-bg-calm]');
    for (var i = 0; i < els.length; i++) {
      var b = els[i].getBoundingClientRect();
      calm.push({ x: b.left + sx, y: b.top + sy, w: b.width, h: b.height });
    }
    var want = fieldHeight();
    if (routes.length && Math.abs(want - FH) > FH * 0.2) layout();
  }

  function calmAt(x, y, sx, sy) {
    var v = 0;
    for (var i = 0; i < calm.length; i++) {
      var c = calm[i], cx = c.x - sx, cy = c.y - sy;
      var dx = Math.max(cx - x, 0, x - (cx + c.w));
      var dy = Math.max(cy - y, 0, y - (cy + c.h));
      var t = 1 - clamp(Math.sqrt(dx * dx + dy * dy) / CONFIG.calmFeather, 0, 1);
      if (t > v) v = t;
    }
    return v;
  }

  /* ---- Rendering ------------------------------------------------------- */
  var LINE_STEP = 48;
  var NODES = [0.125, 0.375, 0.625, 0.875];

  function strokeSpan(route, s0, s1) {
    var a = posAt(route, s0), b = posAt(route, s1);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    for (var i = a.i; i < route.pts.length && route.cum[i] < s1; i++) {
      if (route.cum[i] > s0) ctx.lineTo(route.pts[i].x, route.pts[i].y);
    }
    ctx.lineTo(b.x, b.y);
    return [a, b];
  }

  function render(dt, still) {
    var sx = win.pageXOffset || 0, sy = win.pageYOffset || 0;
    var off = clamp(sy * CONFIG.parallax, 0, Math.max(0, FH - H));
    var hasCalm = calm.length > 0;
    var R = CONFIG.lensRadius, A = CONFIG.lensAlong;

    if (!still) {
      var kp = 1 - Math.exp(-dt * 12);
      px += (tx - px) * kp;
      py += (ty - py) * kp;
      presence += (ptarget - presence) * (1 - Math.exp(-dt * 4));
    } else {
      presence = 0;
    }
    var fy = py + off;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.translate(0, -off);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    var pulseRoute = -1, pulseAge = 0;
    if (pulse) { pulseRoute = pulse.i; pulseAge = (time - pulse.t0) / pulse.dur; }

    var i, j, k, route, st, pk, x, y, a;

    for (i = 0; i < routes.length; i++) {
      route = routes[i];
      if (i === pulseRoute && pulseAge < 1) route.force = 1;
      else if (route.force > 0) route.force = Math.max(0, route.force - dt * 0.7);

      var er = 0;
      if (presence > 0.004) {
        var nn = nearestOn(route, px, fy);
        er = Math.exp(-(nn.d * nn.d) / (R * R)) * presence;
      }
      route.er = er;

      // Route line: one stroke, brightness carried by a horizontal gradient (x only increases along a route).
      var x0 = route.pts[0].x, x1 = route.pts[route.pts.length - 1].x, span = x1 - x0;
      var grad = ctx.createLinearGradient(x0, 0, x1, 0);
      for (x = x0; x < x1; x += LINE_STEP) {
        var bump = er > 0.002 ? Math.exp(-((x - px) * (x - px)) / (A * A)) : 0;
        a = CONFIG.lineAlpha + CONFIG.lineLens * er * bump + 0.22 * route.force;
        if (hasCalm) a *= 1 - CONFIG.calmDim * calmAt(x, yAtX(route, x) - off, sx, sy);
        grad.addColorStop((x - x0) / span, rgba(a));
      }
      grad.addColorStop(1, rgba(CONFIG.lineAlpha));
      ctx.beginPath();
      ctx.moveTo(route.pts[0].x, route.pts[0].y);
      for (j = 1; j < route.pts.length; j++) ctx.lineTo(route.pts[j].x, route.pts[j].y);
      ctx.lineWidth = 1;
      ctx.strokeStyle = grad;
      ctx.stroke();
    }

    // Stations
    for (i = 0; i < routes.length; i++) {
      route = routes[i];
      for (j = 0; j < route.stations.length; j++) {
        st = route.stations[j];
        if (!still && st.lit > 0) st.lit = Math.max(0, st.lit - dt * 0.9);
        var dxs = st.x - px, dys = st.y - fy;
        var e = presence > 0.004 ? presence * Math.exp(-(dxs * dxs + dys * dys) / 22500) : 0;
        a = CONFIG.stationAlpha + CONFIG.stationLens * e + 0.6 * st.lit;
        var dim = hasCalm ? 1 - CONFIG.calmDim * calmAt(st.x, st.y - off, sx, sy) : 1;
        a = clamp(a * dim, 0, 0.9);
        ctx.beginPath();
        ctx.arc(st.x, st.y, 3.4, 0, TAU);
        ctx.lineWidth = 1;
        ctx.strokeStyle = rgba(a);
        ctx.stroke();
        var fill = clamp(e * 0.9 + st.lit, 0, 1);
        if (fill > 0.03) {
          ctx.beginPath();
          ctx.arc(st.x, st.y, 1.7, 0, TAU);
          ctx.fillStyle = rgba(0.85 * fill * dim);
          ctx.fill();
        }
      }
    }

    // Ambient packets
    for (i = 0; i < routes.length; i++) {
      route = routes[i];
      for (k = 0; k < route.packets.length; k++) {
        pk = route.packets[k];
        if (!still) {
          var prev = pk.s;
          pk.s += pk.v * dt;
          for (j = 0; j < route.stations.length; j++) {
            st = route.stations[j];
            if (prev < st.s && pk.s >= st.s && st.lit < 0.5) st.lit = 0.5;
          }
          if (pk.s - pk.L > route.total) pk.s = -pk.L - Math.random() * 400;
        }
        if (pk.s < 0) continue;
        drawPacket(route, pk.s, pk.L, 1.4,
          CONFIG.packetAlpha + CONFIG.packetLens * route.er * Math.exp(-Math.pow(posAt(route, pk.s).x - px, 2) / (A * A)),
          hasCalm, sx, sy, off);
      }
    }

    // Click packets
    for (k = bursts.length - 1; k >= 0; k--) {
      var bu = bursts[k];
      var pv = bu.s;
      bu.s += 360 * dt;
      for (j = 0; j < bu.route.stations.length; j++) {
        st = bu.route.stations[j];
        if (pv < st.s && bu.s >= st.s) st.lit = 1;
      }
      if (bu.s - 70 > bu.route.total) { bursts.splice(k, 1); continue; }
      drawPacket(bu.route, bu.s, 70, 2, 0.9, false, sx, sy, off);
    }

    // Click rings
    for (k = rings.length - 1; k >= 0; k--) {
      var ra = (time - rings[k].t0) / 0.7;
      if (ra >= 1) { rings.splice(k, 1); continue; }
      ctx.beginPath();
      ctx.arc(rings[k].x, rings[k].y, 6 + ra * 44, 0, TAU);
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(0.32 * (1 - ra) * (1 - ra));
      ctx.stroke();
    }

    if (pulse) {
      if (pulseAge >= 1.25) pulse = null;
      else drawPulse(routes[pulseRoute], pulseAge);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function drawPacket(route, s, L, width, alpha, dimCalm, sx, sy, off) {
    var s0 = Math.max(0, s - L), s1 = Math.min(route.total, s);
    if (s1 <= s0) return;
    var head = posAt(route, s1);
    if (dimCalm && calm.length) alpha *= 1 - CONFIG.calmDim * calmAt(head.x, head.y - off, sx, sy);
    var ends = strokeSpan(route, s0, s1);
    var g = ctx.createLinearGradient(ends[0].x, ends[0].y, ends[1].x, ends[1].y);
    g.addColorStop(0, rgba(0));
    g.addColorStop(1, rgba(alpha));
    ctx.lineWidth = width;
    ctx.strokeStyle = g;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(head.x, head.y, width * 0.9 + 0.4, 0, TAU);
    ctx.fillStyle = rgba(Math.min(1, alpha * 1.1));
    ctx.fill();
  }

  // Workflow pulse: a bright packet crosses one route and lights four stage nodes.
  function drawPulse(route, age) {
    var u = clamp(age, 0, 1);
    var e = 0.5 - 0.5 * Math.cos(Math.PI * u);
    var hx = -30 + e * (W + 60);
    var fade = age > 1 ? 1 - (age - 1) / 0.25 : 1;
    var k, nx, ny, lit;

    for (k = 0; k < NODES.length; k++) {
      nx = NODES[k] * W; ny = yAtX(route, nx);
      lit = clamp((hx - nx) / 120, 0, 1);
      ctx.beginPath();
      ctx.arc(nx, ny, 6, 0, TAU);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = rgba((0.22 + 0.68 * lit) * fade);
      ctx.stroke();
      if (lit > 0.02) {
        ctx.beginPath();
        ctx.arc(nx, ny, 2.8 * lit, 0, TAU);
        ctx.fillStyle = rgba(0.9 * lit * fade);
        ctx.fill();
      }
      if (k === NODES.length - 1 && lit > 0.5) {
        ctx.beginPath();
        ctx.moveTo(nx - 3, ny + 0.2); ctx.lineTo(nx - 0.6, ny + 2.8); ctx.lineTo(nx + 3.4, ny - 2.6);
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = rgba(0.95 * fade);
        ctx.stroke();
      }
    }

    var TR = 26, prevX = hx, prevY = yAtX(route, hx);
    for (var t = 1; t <= TR; t++) {
      var cx = hx - t * 7, cy = yAtX(route, cx);
      ctx.beginPath();
      ctx.moveTo(prevX, prevY); ctx.lineTo(cx, cy);
      ctx.lineWidth = 2.2 - t * 0.05;
      ctx.strokeStyle = rgba((1 - t / TR) * 0.75 * fade);
      ctx.stroke();
      prevX = cx; prevY = cy;
    }

    var flare = 0;
    for (k = 0; k < NODES.length; k++) {
      var dd = (hx - NODES[k] * W) / 42;
      flare = Math.max(flare, Math.exp(-dd * dd));
    }
    var hy = yAtX(route, hx), hr = 9 + 12 * flare;
    var g = ctx.createRadialGradient(hx, hy, 0, hx, hy, hr);
    g.addColorStop(0, rgba(0.95 * fade));
    g.addColorStop(1, rgba(0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(hx, hy, hr, 0, TAU);
    ctx.fill();
  }

  /* ---- Actions --------------------------------------------------------- */
  function offsetNow() {
    return clamp((win.pageYOffset || 0) * CONFIG.parallax, 0, Math.max(0, FH - H));
  }

  function clickAt(x, y) {
    if (reduced || !routes.length) return;
    var fy = y + offsetNow(), best = null, bd = 1e12;
    for (var i = 0; i < routes.length; i++) {
      var nn = nearestOn(routes[i], x, fy);
      if (nn.d < bd) { bd = nn.d; best = { route: routes[i], s: nn.s }; }
    }
    rings.push({ x: x, y: fy, t0: time });
    if (rings.length > 4) rings.shift();
    if (best) {
      bursts.push({ route: best.route, s: best.s });
      if (bursts.length > 6) bursts.shift();
    }
  }

  function pulseAt(clientY) {
    if (reduced || !routes.length) return;
    var y = typeof clientY === 'number' ? clientY : H * 0.45;
    var off = offsetNow(), best = 0, bd = 1e12;
    for (var i = 0; i < routes.length; i++) {
      var d = Math.abs(yAtX(routes[i], W * 0.5) - off - y);
      if (d < bd) { bd = d; best = i; }
    }
    pulse = { i: best, t0: time, dur: CONFIG.pulseSeconds };
  }

  /* ---- Loop ------------------------------------------------------------ */
  function goLive() {
    if (live) return;
    live = true;
    host.classList.add('is-live');
    win.setTimeout(function () { host.classList.add('is-settled'); }, 900);
  }
  function tick(now) {
    raf = win.requestAnimationFrame(tick);
    var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;
    time += dt;
    render(dt, false);
    goLive();
  }
  function start() {
    if (raf || reduced || doc.hidden) return;
    last = 0;
    raf = win.requestAnimationFrame(tick);
  }
  function stop() {
    if (raf) { win.cancelAnimationFrame(raf); raf = 0; }
  }
  function renderStill() {
    render(0, true);
    goLive();
  }

  /* ---- Events ---------------------------------------------------------- */
  win.addEventListener('pointermove', function (e) {
    tx = e.clientX; ty = e.clientY;
    if (!hasPointer) { px = tx; py = ty; hasPointer = true; }
    ptarget = 1;
    if (e.pointerType === 'touch') {
      win.clearTimeout(touchT);
      touchT = win.setTimeout(function () { ptarget = 0; }, 900);
    }
  }, { passive: true });

  win.addEventListener('pointerdown', function (e) {
    tx = e.clientX; ty = e.clientY;
    if (!hasPointer) { px = tx; py = ty; hasPointer = true; }
    ptarget = 1;
    if (e.pointerType === 'touch') {
      win.clearTimeout(touchT);
      touchT = win.setTimeout(function () { ptarget = 0; }, 1200);
    }
    var t = e.target;
    if (t && t.closest && t.closest('input,textarea,select,label')) return;   // keep the form calm
    clickAt(e.clientX, e.clientY);
  }, { passive: true });

  root.addEventListener('mouseleave', function () { ptarget = 0; });
  win.addEventListener('blur', function () { ptarget = 0; });

  // Pulse on "Run the workflow" without touching app.js.
  doc.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var el = t.closest('[data-bg-pulse],[data-run-workflow],button,a');
    if (!el) return;
    var hit = el.hasAttribute('data-bg-pulse') || el.hasAttribute('data-run-workflow') ||
              /run the workflow/i.test(el.textContent || '');
    if (!hit) return;
    var b = el.getBoundingClientRect();
    pulseAt(b.top + b.height / 2);
  }, true);
  win.addEventListener('rys:pulse', function (e) { pulseAt(e && e.detail && e.detail.y); });

  var resizeT = 0;
  function onResize() {
    var nw = host.clientWidth || win.innerWidth, nh = host.clientHeight || win.innerHeight;
    if (nw === W && Math.abs(nh - H) < 120) { measure(); return; }   // ignore mobile URL-bar height changes
    size(); measure(); layout();
    if (reduced) renderStill();
  }
  win.addEventListener('resize', function () {
    win.clearTimeout(resizeT);
    resizeT = win.setTimeout(onResize, 120);
  });
  win.addEventListener('load', function () { measure(); if (reduced) renderStill(); });
  if (win.ResizeObserver && doc.body) new win.ResizeObserver(function () { measure(); }).observe(doc.body);
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function () { measure(); if (reduced) renderStill(); });

  win.addEventListener('scroll', function () {
    if (!reduced || stillQueued) return;
    stillQueued = true;
    win.requestAnimationFrame(function () { stillQueued = false; renderStill(); });
  }, { passive: true });

  doc.addEventListener('visibilitychange', function () { if (doc.hidden) stop(); else start(); });

  function onMotionChange(e) {
    reduced = !!e.matches;
    if (reduced) { stop(); bursts = []; rings = []; pulse = null; renderStill(); }
    else start();
  }
  if (reduceMq) {
    if (reduceMq.addEventListener) reduceMq.addEventListener('change', onMotionChange);
    else if (reduceMq.addListener) reduceMq.addListener(onMotionChange);
  }

  /* ---- Go -------------------------------------------------------------- */
  size();
  measure();
  layout();
  win.RysRoutes = { pulse: pulseAt };
  if (reduced) renderStill(); else start();
})();
