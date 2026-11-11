/* Ink: a tiny hand-drawing engine, after the Looseleaf foundations.
   - Lines are ribbons with pressure (a filled shape whose width changes), never a uniform stroke.
   - Straight lines are ruled: edges stay level, loops close with a soft overlap, ends ease off.
   - Everything is seeded: the same seed always draws the same thing; two elements never match.
   - Fills are a separate layer, laid slightly out of register with the outline.
   - States (hover, press, focus, invalid) are pre-drawn layers that CSS shows; nothing redraws.
   - Every drawing is aria-hidden, unfocusable and ignores the pointer. */
(function (root) {
  "use strict";

  /* ---------- Seeded randomness ---------- */
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    let a = hash(String(seed));
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  // Smooth 1-D value noise in [-1, 1] over t in [0, 1]
  function noise1(r, knots) {
    const v = Array.from({ length: knots + 2 }, () => r() * 2 - 1);
    return function (t) {
      t = Math.max(0, Math.min(1, t)) * knots;
      const i = Math.floor(t), f = t - i, u = (1 - Math.cos(f * Math.PI)) / 2;
      return v[i] * (1 - u) + v[i + 1] * u;
    };
  }

  /* ---------- Pens ---------- */
  const PENS = {
    ink:          { w: 1.7,  c: "--ll-ink", o: 0.92 },
    "ink.fine":   { w: 1.25, c: "--ll-ink", o: 0.92 },
    "ink.brush":  { w: 2.5,  c: "--ll-ink", o: 0.92 },
    blue:         { w: 1.85, c: "--ll-ink-you", o: 0.9 },
    focus:        { w: 2.2,  c: "--ll-focus", o: 0.95, keep: true },
    pencil:       { w: 1.5,  c: "--ll-pencil-mark", o: 0.95 },
    red:          { w: 1.75, c: "--ll-red", o: 0.9, keep: true },
    green:        { w: 1.6,  c: "--ll-green", o: 0.9 },
    orange:       { w: 1.9,  c: "--ll-orange-text", o: 0.9 },
    bluepencil:   { w: 1.4,  c: "--ll-ink-you", o: 0.88, keep: true }, // chart series: data keeps its color
    marker:       { w: 3.2,  c: "--ll-marker", o: 0.95, keep: true },
  };

  function density() {
    return document.documentElement.getAttribute("data-density") || "comfortable";
  }
  // Calm swaps every outline for a hairline pencil and steadies the hand.
  // The focus ring and the red correction pen are never toned down.
  function pen(name) {
    const p = PENS[name] || PENS.ink;
    const d = density();
    if (d === "calm" && !p.keep) return { w: 1, c: "--ll-pencil", o: 0.95, wobble: 0.3, press: 0 };
    if (d === "compact") return { ...p, w: p.w * 0.94, wobble: 1, press: 0.2 };
    return { ...p, wobble: 1, press: 0.22 };
  }

  /* ---------- Geometry ---------- */
  // Points around a rounded rectangle, clockwise, starting at the top-left of the top edge
  function rrPoints(x, y, w, h, radii, step) {
    step = step || 2.5;
    const R = radii.map((r) => Math.max(0, Math.min(r, w / 2, h / 2)));
    const pts = [];
    const line = (ax, ay, bx, by) => {
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
      for (let i = 0; i < n; i++) pts.push([ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n]);
    };
    const arc = (cx, cy, r, a0, a1) => {
      const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * r) / step));
      for (let i = 0; i < n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    };
    const P = Math.PI;
    line(x + R[0], y, x + w - R[1], y);
    arc(x + w - R[1], y + R[1], R[1], -P / 2, 0);
    line(x + w, y + R[1], x + w, y + h - R[2]);
    arc(x + w - R[2], y + h - R[2], R[2], 0, P / 2);
    line(x + w - R[2], y + h, x + R[3], y + h);
    arc(x + R[3], y + h - R[3], R[3], P / 2, P);
    line(x, y + h - R[3], x, y + R[0]);
    arc(x + R[0], y + R[0], R[0], P, 1.5 * P);
    return pts;
  }

  function normalAt(pts, i) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    return [-dy / L, dx / L];
  }

  // Nudge points along their normals by a slow, small wander: a careful hand, not a shaky one
  function wander(pts, r, amp, closed) {
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    const nz = noise1(r, Math.max(3, Math.round(len / 70)));
    const n = pts.length;
    return pts.map((p, i) => {
      const t = i / (n - 1);
      // On a closed loop, fade the wander to zero at the seam so the ends meet
      const fade = closed ? Math.min(1, Math.min(t, 1 - t) * 8) : 1;
      const nm = normalAt(pts, i), d = nz(t) * amp * fade;
      return [p[0] + nm[0] * d, p[1] + nm[1] * d];
    });
  }

  // Densify a polyline so ribbons bend smoothly
  function densify(pts, step) {
    step = step || 3;
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
      for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n]);
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  /* A ribbon: the polyline becomes a filled shape whose width follows the hand's pressure.
     start/end: "pool" (a small blot), "flick" (tapers off), "soft" (eases a little). */
  function ribbon(pts, width, r, opts) {
    opts = opts || {};
    const press = opts.press == null ? 0.22 : opts.press;
    const start = opts.start || "pool", end = opts.end || "flick";
    const L = [0];
    for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const total = L[L.length - 1] || 1;
    const nz = noise1(r, Math.max(3, Math.round(total / 45)));
    const ease = (kind, d) =>
      kind === "pool" ? 1 + 0.28 * Math.exp(-d / 2.5)
      : kind === "flick" ? 0.22 + 0.78 * Math.pow(Math.min(1, d / 10), 0.7)
      : 0.55 + 0.45 * Math.min(1, d / 4);
    const left = [], right = [];
    for (let i = 0; i < pts.length; i++) {
      const s = L[i] / total;
      let w = width * (1 + press * nz(s));
      w *= ease(start, L[i]) * ease(end, total - L[i]);
      const nm = normalAt(pts, i), hw = Math.max(0.2, w / 2);
      left.push([pts[i][0] + nm[0] * hw, pts[i][1] + nm[1] * hw]);
      right.push([pts[i][0] - nm[0] * hw, pts[i][1] - nm[1] * hw]);
    }
    const f = (p) => p[0].toFixed(1) + " " + p[1].toFixed(1);
    return "M" + left.map(f).join("L") + "L" + right.reverse().map(f).join("L") + "Z";
  }

  function polygon(pts) {
    return "M" + pts.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L") + "Z";
  }

  // Corners that each bend a little differently
  function handRadii(r, base) {
    return [0, 1, 2, 3].map(() => base * (0.75 + r() * 0.5));
  }

  /* A closed box: one ribbon that goes all the way round and runs a few px past its start,
     the way a pen closes a loop. */
  function boxPath(x, y, w, h, radius, r, p) {
    let pts = rrPoints(x, y, w, h, handRadii(r, radius));
    const n = pts.length;
    const k = Math.floor(r() * Math.max(1, n * 0.12)); // start somewhere along the top edge
    pts = pts.slice(k).concat(pts.slice(0, k));
    pts = wander(pts, r, 0.45 * p.wobble, true);
    const over = Math.max(2, Math.round(6 / 2.5));
    const tail = pts.slice(0, over + 1).map((q, i) => {
      const nm = normalAt(pts, i), d = (i / over) * 0.9; // the overlap drifts a hair outward
      return [q[0] - nm[0] * d, q[1] - nm[1] * d];
    });
    return ribbon(pts.concat(tail), p.w, r, { press: p.press, start: "pool", end: "flick" });
  }

  function fillPath(x, y, w, h, radius, r) {
    const pts = wander(rrPoints(x, y, w, h, handRadii(r, radius), 4), r, 0.5, true);
    return polygon(pts);
  }

  function ellipsePts(cx, cy, rx, ry, a0, turns, r, drift) {
    const pts = [];
    const n = Math.max(24, Math.ceil(((rx + ry) * Math.PI * turns) / 2.5));
    for (let i = 0; i <= n; i++) {
      const t = i / n, a = a0 + t * turns * 2 * Math.PI, g = 1 + drift * t;
      pts.push([cx + rx * g * Math.cos(a), cy + ry * g * Math.sin(a)]);
    }
    return pts;
  }

  /* ---------- SVG helpers ---------- */
  const NS = "http://www.w3.org/2000/svg";
  const fillStyle = (token, opacity) => `fill:var(${token});fill-opacity:${opacity == null ? 1 : opacity}`;
  const path = (d, token, opacity, cls) =>
    `<path${cls ? ` class="${cls}"` : ""} d="${d}" style="${fillStyle(token, opacity)}"/>`;

  function focusRing(w, h, radius, r) {
    const off = 4, fp = pen("focus");
    const x = -off, y = -off, W = w + off * 2, H = h + off * 2;
    let s = path(boxPath(x, y, W, H, radius + off, r, fp), fp.c, fp.o);
    // A tick at each corner, pointing out
    [[x, y, -1, -1], [x + W, y, 1, -1], [x + W, y + H, 1, 1], [x, y + H, -1, 1]].forEach(([cx, cy, sx, sy]) => {
      const a = [cx + sx * 1.5, cy + sy * 1.5], b = [cx + sx * 5, cy + sy * 5];
      s += path(ribbon(densify([a, b], 1), fp.w, r, { press: 0, start: "soft", end: "soft" }), fp.c, fp.o);
    });
    return `<g class="ll-focus">${s}</g>`;
  }

  /* ---------- Recipes: one per kind of drawn thing ---------- */
  const RECIPES = {
    // An outlined control. data-pen, data-fill (a color token name), data-r (corner radius)
    box(el, w, h, r) {
      const p = pen(el.dataset.pen || "ink");
      const rad = Number(el.dataset.r || 7);
      const inset = p.w / 2;
      let s = "";
      if (el.dataset.fill) {
        // Fills sit in register: tucked just under the outline, and the small offset
        // (even doubled on hover) is less than the tuck, so color never crosses the line.
        const tuck = p.w * 0.5 + 1.4;
        const dx = (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.6), dy = 0.3 + r() * 0.5;
        s += `<g class="ll-fill" style="--dx:${dx.toFixed(2)};--dy:${dy.toFixed(2)}">` +
          path(fillPath(tuck, tuck, w - tuck * 2, h - tuck * 2, Math.max(1, rad - tuck / 2), r), "--ll-" + el.dataset.fill, el.dataset.fillOpacity || 1) + "</g>";
      }
      s += `<g class="ll-line">${path(boxPath(inset, inset, w - inset * 2, h - inset * 2, rad, r, p), p.c, p.o)}</g>`;
      if (el.hasAttribute("data-invalid")) {
        const rp = pen("red");
        s += `<g class="ll-invalid">${path(boxPath(rp.w / 2, rp.w / 2, w - rp.w, h - rp.w, rad, r, rp), rp.c, rp.o)}</g>`;
      }
      if (el.hasAttribute("data-focus")) s += focusRing(w, h, rad, r);
      return s;
    },

    // Fill only (a selected tab), plus an optional focus ring
    fill(el, w, h, r) {
      // A tab's fill stays inside the strip's outline and its dividers
      const tuck = 2.4;
      const dx = (r() < 0.5 ? -1 : 1) * (0.4 + r() * 0.5), dy = 0.3 + r() * 0.4;
      let s = `<g class="ll-fill" style="--dx:${dx.toFixed(2)};--dy:${dy.toFixed(2)}">` +
        path(fillPath(tuck, tuck, w - tuck * 2, h - tuck * 2, 3, r), "--ll-" + (el.dataset.fill || "hi"), el.dataset.fillOpacity || 1) + "</g>";
      if (el.hasAttribute("data-focus")) s += focusRing(w, h, 6, r);
      return s;
    },

    // A tab strip: one outline and a ruled divider between each pair of tabs
    tabs(el, w, h, r) {
      const p = pen(el.dataset.pen || "ink");
      const inset = p.w / 2;
      let s = path(boxPath(inset, inset, w - inset * 2, h - inset * 2, 7, r, p), p.c, p.o);
      [...el.children].slice(1).forEach((c) => {
        const x = c.offsetLeft;
        s += path(ribbon(densify([[x, 2], [x + (r() - 0.5) * 0.8, h - 2]], 2.5), p.w, r, { press: p.press, start: "soft", end: "soft" }), p.c, p.o);
      });
      return `<g class="ll-line">${s}</g>`;
    },

    pill(el, w, h, r) {
      el.dataset.r = String(h / 2);
      return RECIPES.box(el, w, h, r);
    },

    circle(el, w, h, r) {
      const p = pen(el.dataset.pen || "ink");
      let s = "";
      if (el.dataset.fill) s += path(polygon(ellipsePts(w / 2, h / 2, w / 2 - 1, h / 2 - 1, 0, 1, r, 0)), "--ll-" + el.dataset.fill);
      const a0 = -Math.PI / 2 - 0.4 + r() * 0.8;
      s += path(ribbon(ellipsePts(w / 2, h / 2, w / 2 - p.w / 2, h / 2 - p.w / 2, a0, 1.06, r, 0.02), p.w, r, { press: p.press, start: "pool", end: "flick" }), p.c, p.o);
      return s;
    },

    // A hand-drawn rule under a title or a select
    rule(el, w, h, r) {
      const p = pen(el.dataset.pen || "ink");
      const y = h - p.w;
      const pts = densify([[0, y + (r() - 0.5)], [w * 0.55, y + (r() - 0.5) * 1.2], [w, y + (r() - 0.5)]], 2.5);
      const line = path(ribbon(wander(pts, r, 0.5 * p.wobble, false), p.w, r, { press: p.press, start: "soft", end: "flick" }), p.c, p.o);
      return el.hasAttribute("data-focus") ? line + focusRing(w, h, 6, r) : line;
    },

    // A swipe of yellow highlighter behind words
    hi(el, w, h, r) {
      const y0 = h * 0.56 + (r() - 0.5) * 2, slope = (r() - 0.5) * 2.5;
      const pts = densify([[-4, y0 + slope], [w + 4, y0 - slope]], 3);
      return `<g class="ll-hi">${path(ribbon(wander(pts, r, 1.2, false), h * 0.8, r, { press: 0.06, start: "soft", end: "soft" }), "--ll-hi", 0.75)}</g>`;
    },

    // A loop around a word: a note, so it runs past where it started
    loop(el, w, h, r) {
      const p = pen(el.dataset.pen || "green");
      const a0 = Math.PI * (0.9 + r() * 0.3);
      const pts = ellipsePts(w / 2, h / 2 + 0.5, w / 2 + 6, h / 2 + 4, a0, 1.12, r, 0.06);
      return path(ribbon(wander(pts, r, 1, false), p.w, r, { press: p.press, start: "pool", end: "flick" }), p.c, p.o);
    },

    // A rubber stamp: a double ring in warm orange
    stamp(el, w, h, r) {
      const p = pen("orange");
      const a = path(boxPath(1, 1, w - 2, h - 2, h / 2, r, p), p.c, 0.85);
      const b = path(boxPath(4, 4, w - 8, h - 8, h / 2 - 3, r, { ...p, w: p.w * 0.6 }), p.c, 0.6);
      return a + b;
    },

    // Icons and doodles, drawn at their size, never scaled
    cross(el, w, h, r) {
      const p = pen("red"), m = w * 0.18;
      const s1 = densify([[m, m], [w - m, h - m]], 1.5), s2 = densify([[w - m, m + 0.5], [m + 0.5, h - m]], 1.5);
      return path(ribbon(s1, p.w * 1.2, r, { start: "pool", end: "flick" }), p.c) + path(ribbon(s2, p.w * 1.2, r, { start: "pool", end: "flick" }), p.c);
    },

    // A tick: a short down-stroke and a long flick up, in green pencil
    check(el, w, h, r) {
      const p = pen("green");
      const pts = densify([[w * 0.12, h * 0.52], [w * 0.4, h * 0.8], [w * 0.9, h * 0.16]], 1.2);
      return path(ribbon(pts, p.w * 1.3, r, { press: 0.15, start: "pool", end: "flick" }), p.c, 0.95);
    },

    chevron(el, w, h, r) {
      const p = pen("ink");
      const pts = densify([[w * 0.15, h * 0.32], [w * 0.5, h * 0.7], [w * 0.85, h * 0.3]], 1.2);
      return path(ribbon(pts, p.w * 1.1, r, { start: "pool", end: "flick", press: 0.1 }), p.c, p.o);
    },

    arrow(el, w, h, r) {
      const p = pen("ink");
      const pts = [];
      const A = [w - 4, 6], C = [w * 0.35, h * 0.05], B = [8, h - 8];
      for (let i = 0; i <= 30; i++) {
        const t = i / 30, u = 1 - t;
        pts.push([u * u * A[0] + 2 * u * t * C[0] + t * t * B[0], u * u * A[1] + 2 * u * t * C[1] + t * t * B[1]]);
      }
      const head1 = densify([[B[0] - 1, B[1] - 13], [B[0], B[1]]], 1.5);
      const head2 = densify([[B[0] + 13, B[1] - 3], [B[0], B[1]]], 1.5);
      return path(ribbon(densify(pts, 2), p.w * 1.2, r, { start: "pool", end: "soft" }), p.c, p.o) +
        path(ribbon(head1, p.w * 1.2, r, { start: "soft", end: "pool" }), p.c, p.o) +
        path(ribbon(head2, p.w * 1.2, r, { start: "soft", end: "pool" }), p.c, p.o);
    },

    notebook(el, w, h, r) {
      const p = pen("ink.brush");
      let s = path(fillPath(7, 3, w - 10, h - 6, 3, r), "--ll-photo");
      s += path(boxPath(7, 3, w - 10, h - 6, 3, r, p), p.c, p.o);
      const bp = pen("bluepencil");
      [0.3, 0.5, 0.7].forEach((f, i) => {
        const y = 3 + (h - 6) * f, x1 = 13, x2 = i === 2 ? w * 0.6 : w - 9;
        s += path(ribbon(densify([[x1, y], [x2, y + (r() - 0.5)]], 2), bp.w, r, { start: "soft", end: "flick" }), bp.c, bp.o);
      });
      const y = 3 + (h - 6) * 0.5;
      s += path(ribbon(densify([[12, y], [w * 0.62, y - 0.5]], 2), 4.2, r, { press: 0.08, start: "soft", end: "soft" }), "--ll-marker", 0.85);
      [0.25, 0.5, 0.75].forEach((f) => { s += path(polygon(ellipsePts(7, 3 + (h - 6) * f, 2.4, 2.4, 0, 1, r, 0)), "--ll-ink"); });
      return s;
    },
  };

  /* ---------- Mounting ---------- */
  const PAD = 12;
  let counter = 0;

  function draw(el) {
    const recipe = RECIPES[el.dataset.ink];
    if (!recipe) return;
    const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
    const key = w + "x" + h + ":" + density();
    if (!w || !h || el.__inkKey === key) return;
    el.__inkKey = key;
    if (!el.dataset.seed) el.dataset.seed = el.dataset.ink + "-" + ++counter;
    const r = rng(el.dataset.seed);
    let svg = el.__inkSvg;
    if (!svg) {
      svg = document.createElementNS(NS, "svg");
      svg.setAttribute("class", "ll-ink");
      svg.setAttribute("aria-hidden", "true");
      svg.setAttribute("focusable", "false");
      el.__inkSvg = svg;
    }
    if (svg.parentNode !== el) el.appendChild(svg); // re-attach if a script replaced the contents
    svg.setAttribute("width", w + PAD * 2);
    svg.setAttribute("height", h + PAD * 2);
    svg.setAttribute("viewBox", `${-PAD} ${-PAD} ${w + PAD * 2} ${h + PAD * 2}`);
    svg.innerHTML = recipe(el, w, h, r);
  }

  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver((entries) => entries.forEach((e) => draw(e.target))) : null;

  function mount(scope) {
    (scope || document).querySelectorAll("[data-ink]").forEach((el) => {
      if (!el.__inkMounted) { el.__inkMounted = true; if (ro) ro.observe(el); }
      draw(el);
    });
  }
  function redrawAll() {
    document.querySelectorAll("[data-ink]").forEach((el) => { el.__inkKey = ""; draw(el); });
  }

  /* ---------- Paper ---------- */
  // Seeded tilt for a sheet: never under a quarter of the stock's maximum, so nothing lies square
  function tilt(el) {
    const max = Number(el.dataset.tilt || 0.6), r = rng("tilt-" + (el.dataset.seed || el.id || el.className));
    const mag = max * (0.25 + r() * 0.75);
    el.style.setProperty("--tilt", (r() < 0.5 ? -mag : mag).toFixed(2) + "deg");
  }

  /* Paper tooth: one baked, seamless tile lit from the upper left, made once at load and laid over
     any stock color. No runtime filters. */
  function tooth() {
    try {
      const N = 128, c = document.createElement("canvas");
      c.width = c.height = N;
      const ctx = c.getContext("2d"), img = ctx.createImageData(N, N), r = rng("tooth");
      const raw = new Float32Array(N * N).map(() => r());
      const h = new Float32Array(N * N);
      const at = (a, x, y) => a[((y + N) % N) * N + ((x + N) % N)];
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        let s = 0;
        for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += at(raw, x + i, y + j);
        h[y * N + x] = s / 9;
      }
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const relief = (at(h, x - 1, y - 1) - at(h, x + 1, y + 1)) * 2.2; // light from the upper left
        const grain = (r() - 0.5) * 0.6;
        const v = relief + grain, k = (y * N + x) * 4;
        if (v > 0) { img.data[k] = 255; img.data[k + 1] = 253; img.data[k + 2] = 246; img.data[k + 3] = Math.min(255, v * 30); }
        else { img.data[k] = 58; img.data[k + 1] = 44; img.data[k + 2] = 30; img.data[k + 3] = Math.min(255, -v * 15); }
      }
      ctx.putImageData(img, 0, 0);
      document.documentElement.style.setProperty("--ll-tooth", `url(${c.toDataURL("image/png")})`);
    } catch (e) { /* paper still looks like paper without tooth */ }
  }

  /* Handwritten: every word of a title sits a hair off the baseline, by a seeded amount.
     Words stay ordinary text, so they wrap, select and read aloud as usual. */
  function handwrite(el) {
    const r = rng("hand-" + (el.dataset.seed || el.textContent));
    const walk = (node) => {
      [...node.childNodes].forEach((n) => {
        if (n.nodeType === 3) {
          const frag = document.createDocumentFragment();
          n.textContent.split(/(\s+)/).forEach((part) => {
            if (!part) return;
            if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(part)); return; }
            const s = document.createElement("span");
            s.className = "ll-word";
            s.style.setProperty("--jy", ((r() - 0.5) * 0.09).toFixed(3) + "em");
            s.style.setProperty("--jr", ((r() - 0.5) * 1.6).toFixed(2) + "deg");
            s.textContent = part;
            frag.appendChild(s);
          });
          n.replaceWith(frag);
        } else if (n.nodeType === 1 && !n.hasAttribute("data-ink")) walk(n);
        else if (n.nodeType === 1) walk(n);
      });
    };
    walk(el);
  }

  function init() {
    tooth();
    document.querySelectorAll("[data-tilt]").forEach(tilt);
    document.querySelectorAll("[data-handwritten]").forEach(handwrite);
    mount();
    // Fonts change text widths: redraw once they have arrived
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(redrawAll);
  }

  root.Ink = { init, mount, redrawAll, ribbon, densify, rng, pen };
})(window);
