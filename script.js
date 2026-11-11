(() => {
  const $ = (id) => document.getElementById(id);
  const form = $("calc");
  const fields = ["lump", "sip", "years", "stay", "rate", "stepup", "stepAmt"].reduce((o, id) => ((o[id] = $(id)), o), {});
  const stepupOn = $("stepupOn");
  const freq = $("freq");

  const CURRENCIES = {
    INR: { symbol: "₹", locale: "en-IN", rate: 1 },
    USD: { symbol: "$", locale: "en-US", rate: 1 },
  };
  const submitLabel = $("submitLabel");
  let currency = "INR";
  let calculated = false;

  /* ---------- Number helpers ---------- */
  const parseNum = (v) => {
    const n = parseFloat(String(v).replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };
  const fmt = (n) => {
    const c = CURRENCIES[currency];
    return c.symbol + Math.round(n).toLocaleString(c.locale);
  };
  const groupDigits = (n) => Math.round(n).toLocaleString(CURRENCIES[currency].locale);

  const toWords = (num) => window.CompoundCalc.toWords(num, currency);

  /* A quick read of a big total: "About ₹407.25 crore" or "About $3.42 million".
     Empty below a lakh / a million, where the figure is easy to read as it is. */
  const shortForm = (n) => {
    const c = CURRENCIES[currency];
    const units = currency === "INR"
      ? [[1e7, "crore"], [1e5, "lakh"]]
      : [[1e12, "trillion"], [1e9, "billion"], [1e6, "million"]];
    const hit = units.find(([v]) => n >= v);
    if (!hit) return "";
    const amount = (n / hit[0]).toLocaleString(c.locale, { maximumFractionDigits: 2 });
    return `About ${c.symbol}${amount} ${hit[1]}`;
  };

  /* ---------- Input formatting ---------- */
  const formatMoneyInput = (input) => {
    const raw = input.value.replace(/[^0-9]/g, "").slice(0, 13);
    const caretFromEnd = input.value.length - (input.selectionStart ?? input.value.length);
    input.value = raw ? groupDigits(Number(raw)) : "";
    const pos = Math.max(0, input.value.length - caretFromEnd);
    if (document.activeElement === input) input.setSelectionRange(pos, pos);
    updateWords(input.id);
  };

  const updateWords = (id) => {
    const el = document.querySelector(`.words[data-for="${id}"]`);
    const n = parseNum(fields[id].value);
    el.textContent = fields[id].value ? toWords(n) : "";
  };

  const sanitizeNumeric = (input, allowDecimal) => {
    let v = input.value.replace(allowDecimal ? /[^0-9.]/g : /[^0-9]/g, "");
    if (allowDecimal) v = v.replace(/(\..*)\./g, "$1");
    input.value = v.slice(0, 6);
  };

  /* ---------- Core calculation (calc.js) ---------- */
  const { calculate, summarize } = window.CompoundCalc;

  /* ---------- Rendering ---------- */
  const setButton = (done) => {
    calculated = done;
    submitLabel.textContent = done ? "Calculated!" : "Submit";
  };

  const drawChart = (points) => {
    const svg = $("chart");
    lastPoints = points;
    // Draw at the real pixel size so marks keep their shape
    const W = Math.round(svg.clientWidth) || 320, H = Math.round(svg.clientHeight) || 150, padT = 12, padB = 4, padR = 6;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    const maxV = Math.max(...points.map((p) => p.value)) || 1;
    const n = points.length - 1 || 1;
    const x = (i) => (i / n) * (W - padR);
    const y = (v) => padT + (H - padT - padB) * (1 - v / maxV);
    const pts = (key) => points.map((p, i) => [x(i), y(p[key])]);
    const poly = (key) => `M${pts(key).map((q) => q[0].toFixed(1) + " " + q[1].toFixed(1)).join("L")}L${W - padR} ${H}L0 ${H}Z`;
    const last = points[points.length - 1];

    // Lines are ribbons with pressure, seeded so a redraw is the same hand
    const r = Ink.rng("chart");
    const valuePen = Ink.pen("marker"), invPen = Ink.pen("bluepencil");
    const ribbon = (key, p, w) => Ink.ribbon(Ink.densify(pts(key), 3), w, r, { press: p.press, start: "pool", end: "soft" });
    const dot = (cx, cy, rad, fill) =>
      `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${rad}" style="fill:var(${fill});stroke:var(--ll-ink);stroke-width:1.6"/>`;

    // Pencil hairlines for the grid
    const grid = [0.25, 0.5, 0.75].map((f) => {
      const gy = padT + (H - padT - padB) * f;
      return `<path d="${Ink.ribbon(Ink.densify([[0, gy], [W - padR, gy + (r() - 0.5)]], 4), 0.8, r, { press: 0.1, start: "soft", end: "soft" })}" style="fill:var(--ll-pencil-mark);fill-opacity:.45"/>`;
    }).join("");

    svg.innerHTML = `
      <defs>
        <pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="1.4" height="5" style="fill:var(--ll-ink-you);fill-opacity:.5"/>
        </pattern>
      </defs>
      ${grid}
      <g class="series">
        <path d="${poly("value")}" style="fill:var(--ll-marker);fill-opacity:.2;mix-blend-mode:var(--ll-blend)"/>
        <path d="${poly("invested")}" fill="url(#hatch)"/>
        <path d="${ribbon("invested", invPen, invPen.w * 1.2)}" style="fill:var(${invPen.c})"/>
        <path d="${ribbon("value", valuePen, valuePen.w)}" style="fill:var(${valuePen.c})"/>
        ${dot(x(n), y(last.invested), 3.4, "--ll-photo")}
        ${dot(x(n), y(last.value), 4.4, "--ll-marker")}
      </g>`;

    $("xEnd").textContent = `Year ${last.year} (Maturity)`;
    const midYear = Math.round(last.year / 2);
    $("xMid").textContent = `Year ${midYear}`;
    $("xMid").style.left = `${(midYear / (last.year || 1)) * 100}%`;
    $("xMid").hidden = midYear === 0 || midYear === last.year;
    // On narrow screens the middle label can run into the end label; drop it if so
    if (!$("xMid").hidden && $("xMid").getBoundingClientRect().right + 8 > $("xEnd").getBoundingClientRect().left) {
      $("xMid").hidden = true;
    }
  };

  const replay = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };

  const render = (res, animate) => {
    const s = summarize(res);

    $("total").textContent = fmt(s.total);
    $("totalShort").textContent = shortForm(s.total);
    $("totalShort").hidden = !$("totalShort").textContent;
    $("totalWords").textContent = toWords(s.total);
    $("invested").textContent = fmt(s.invested);
    $("returns").textContent = (s.returns >= 0 ? "+" : "−") + fmt(Math.abs(s.returns));
    // A real share that rounds to 0% or 100% reads as "<1%" / ">99%", never a false 0%
    const share = (pct, amount) => (amount > 0 && pct === 0 ? "<1%" : amount > 0 && pct === 100 && s.total > amount ? ">99%" : pct + "%");
    $("invPct").textContent = share(s.invPct, s.invested);
    $("retPct").textContent = share(s.retPct, s.returns);
    // Group big figures the same way as the money (en-IN lakh/crore commas, or en-US)
    const loc = CURRENCIES[currency].locale;
    $("pctGain").textContent = (s.gainPct >= 0 ? "+" : "") +
      s.gainPct.toLocaleString(loc, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
    $("multiple").textContent = (s.multiple >= 100
      ? Math.round(s.multiple).toLocaleString(loc)
      : s.multiple.toFixed(2)) + "x";
    // The bar uses the exact share, but each part that exists keeps at least a visible sliver
    const invShare = s.total ? (s.invested / s.total) * 100 : 0;
    const barPct = s.invested > 0 && s.returns > 0 ? Math.min(98, Math.max(2, invShare)) : invShare;
    $("barInv").style.width = barPct + "%";
    // When invested is too small to see on the chart, say so in a margin note
    $("chartNote").hidden = !(s.invested > 0 && invShare < 5);
    $("chartNote").textContent = `Invested (${fmt(s.invested)}) is ${invShare < 1 ? "less than 1%" : "only about " + Math.round(invShare) + "%"} of the total, so its line sits near the bottom.`;
    $("empty").hidden = true;
    $("results").hidden = false;
    Ink.mount($("results")); // draw the sheet's marks now that it has a size
    drawChart(res.points); // after unhiding, so the chart can measure its width
    fitNumbers();
    if (animate) replay($("results"), "is-new");
  };

  let lastPoints = null;
  /* Numbers never wrap mid-figure: if one is wider than its box, step its size down
     (to no less than 55% of the designed size) until it fits on one line. */
  const fit = (el) => {
    el.style.fontSize = "";
    const base = parseFloat(getComputedStyle(el).fontSize), min = base * 0.55;
    // Measure the number itself, not the highlighter drawn a little past its ends
    const hl = el.querySelector(".hl");
    const tooWide = () => (hl ? hl.offsetWidth : el.scrollWidth) > el.clientWidth + 0.5;
    let size = base;
    while (tooWide() && size > min) {
      size -= 1;
      el.style.fontSize = size + "px";
    }
  };
  const fitNumbers = () => {
    if ($("results").hidden) return;
    document.querySelectorAll(".maturity-value, .tile-value").forEach(fit);
  };

  window.addEventListener("resize", () => { if (lastPoints) { drawChart(lastPoints); fitNumbers(); } });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitNumbers);

  const readInputs = () => ({
    lump: parseNum(fields.lump.value),
    sip: parseNum(fields.sip.value),
    every: Number(freq.value),
    years: Math.floor(parseNum(fields.years.value)),
    stay: Math.floor(parseNum(fields.stay.value)),
    rate: parseNum(fields.rate.value),
    stepup: stepupOn.checked && stepMode === "pct" ? parseNum(fields.stepup.value) : 0,
    stepupAmt: stepupOn.checked && stepMode === "amt" ? parseNum(fields.stepAmt.value) : 0,
  });

  const validate = (v) => {
    document.querySelectorAll(".input.invalid").forEach((el) => el.classList.remove("invalid"));
    const fail = (id, msg) => { fields[id].closest(".input").classList.add("invalid"); return msg; };
    if (v.lump <= 0 && v.sip <= 0) return fail("lump", "Enter a lump sum or a periodic investment amount.");
    if (v.sip > 0 && v.years < 1) return fail("years", "Years you add money must be at least 1.");
    if (v.stay < 1 || v.stay > 100) return fail("stay", "Total years invested must be between 1 and 100.");
    if (v.stay < v.years) return fail("stay", "Total years invested can't be less than the years you add money.");
    if (v.rate > 50) return fail("rate", "Expected return must be 50% or lower.");
    if (v.stepup > 100) return fail("stepup", "Annual increase must be 100% or lower.");
    return "";
  };

  const showError = (msg) => {
    $("error").textContent = msg;
    $("error").hidden = !msg;
  };

  const run = (animate) => {
    const v = readInputs();
    const err = validate(v);
    showError(err);
    if (err) return;
    const res = calculate(v);
    // Beyond 2^53 rupees, JavaScript numbers can't hold every digit exactly
    if (res.total > Number.MAX_SAFE_INTEGER) {
      showError("Result is too large to show accurately. Try a lower amount, rate or period.");
      return;
    }
    render(res, animate);
    setButton(true);
  };

  /* ---------- Events ---------- */
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    run(true);
  });

  const markDirty = () => { if (calculated) setButton(false); };

  ["lump", "sip", "stepAmt"].forEach((id) =>
    fields[id].addEventListener("input", () => { formatMoneyInput(fields[id]); markDirty(); }));
  ["years", "stay"].forEach((id) =>
    fields[id].addEventListener("input", () => { sanitizeNumeric(fields[id], false); markDirty(); }));
  fields.rate.addEventListener("input", () => { sanitizeNumeric(fields.rate, true); markDirty(); });

  const press = (b, on) => { b.classList.toggle("active", on); b.setAttribute("aria-pressed", String(on)); };

  /* ---------- Drawn dropdown (listbox) over the native select ---------- */
  const dropdown = (wrap) => {
    const native = wrap.querySelector("select");
    const trigger = wrap.querySelector(".select-trigger");
    const list = wrap.querySelector('[role="listbox"]');
    const valueEl = wrap.querySelector(".select-value");
    const opts = [...list.querySelectorAll('[role="option"]')];
    let active = 0;

    const selectedIndex = () => opts.findIndex((o) => o.dataset.value === native.value);
    const setActive = (i) => {
      active = (i + opts.length) % opts.length;
      opts.forEach((o, k) => o.classList.toggle("is-active", k === active));
      list.setAttribute("aria-activedescendant", opts[active].id);
    };
    const open = () => {
      list.hidden = false;
      // Open toward whichever side has room, so the slip never runs off the screen
      list.classList.remove("align-start");
      if (list.getBoundingClientRect().left < 8) list.classList.add("align-start");
      trigger.setAttribute("aria-expanded", "true");
      setActive(Math.max(0, selectedIndex()));
      Ink.mount(list); // the slip has a size now: draw its outline and the highlighter fills
      list.focus();
    };
    const close = (refocus) => {
      if (list.hidden) return;
      list.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      if (refocus) trigger.focus();
    };
    const choose = (i) => {
      const o = opts[i];
      opts.forEach((x) => x.setAttribute("aria-selected", String(x === o)));
      valueEl.textContent = o.querySelector(".opt-label").textContent;
      if (native.value !== o.dataset.value) {
        native.value = o.dataset.value;
        native.dispatchEvent(new Event("change", { bubbles: true }));
      }
      close(true);
    };

    trigger.addEventListener("click", () => (list.hidden ? open() : close(true)));
    trigger.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); open(); }
    });
    opts.forEach((o, i) => {
      o.addEventListener("pointermove", () => setActive(i));
      o.addEventListener("click", () => choose(i));
    });
    list.addEventListener("keydown", (e) => {
      const k = e.key;
      if (k === "ArrowDown") setActive(active + 1);
      else if (k === "ArrowUp") setActive(active - 1);
      else if (k === "Home") setActive(0);
      else if (k === "End") setActive(opts.length - 1);
      else if (k === "Enter" || k === " ") choose(active);
      else if (k === "Escape") close(true);
      else if (k === "Tab") { close(false); return; }
      else if (k.length === 1 && /\S/.test(k)) {
        // Type a letter to jump to the next option starting with it
        const start = active + 1;
        const hit = opts.map((_, n) => (start + n) % opts.length)
          .find((n) => opts[n].textContent.trim().toLowerCase().startsWith(k.toLowerCase()));
        if (hit != null) setActive(hit);
      } else return;
      e.preventDefault();
    });
    list.addEventListener("focusout", (e) => { if (!wrap.contains(e.relatedTarget)) close(false); });
    document.addEventListener("pointerdown", (e) => { if (!wrap.contains(e.target)) close(false); });
  };
  dropdown($("freqSelect"));

  /* ---------- Step-up: by % or by fixed amount ---------- */
  let stepMode = "pct";

  document.querySelectorAll(".seg-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      stepMode = btn.dataset.mode;
      document.querySelectorAll(".seg-btn").forEach((b) => press(b, b === btn));
      $("stepPct").hidden = stepMode !== "pct";
      $("stepAmtBox").hidden = stepMode !== "amt";
      markDirty();
    }));

  fields.stepup.addEventListener("input", () => { sanitizeNumeric(fields.stepup, true); markDirty(); });
  freq.addEventListener("change", markDirty);

  stepupOn.addEventListener("change", () => {
    document.querySelector(".stepup-extra").hidden = !stepupOn.checked;
    Ink.mount(document.querySelector(".stepup"));
    markDirty();
  });

  document.querySelectorAll(".cur").forEach((btn) =>
    btn.addEventListener("click", () => {
      currency = btn.dataset.cur;
      document.querySelectorAll(".cur").forEach((b) => press(b, b === btn));
      document.querySelectorAll(".sym").forEach((s) => (s.textContent = CURRENCIES[currency].symbol));
      ["lump", "sip", "stepAmt"].forEach((id) => formatMoneyInput(fields[id]));
      if (calculated) run();
    }));

  // Init
  Ink.init();
  ["lump", "sip", "stepAmt"].forEach((id) => formatMoneyInput(fields[id]));
})();
