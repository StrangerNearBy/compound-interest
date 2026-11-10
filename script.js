(() => {
  const $ = (id) => document.getElementById(id);
  const form = $("calc");
  const fields = ["lump", "sip", "years", "stay", "rate", "stepup"].reduce((o, id) => ((o[id] = $(id)), o), {});
  const stepupOn = $("stepupOn");
  const freq = $("freq");

  const CURRENCIES = {
    INR: { symbol: "₹", locale: "en-IN", rate: 1 },
    USD: { symbol: "$", locale: "en-US", rate: 1 },
  };
  const submitBtn = $("submit");
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
    submitBtn.textContent = done ? "Calculated!" : "Submit";
  };

  const drawChart = (points) => {
    const svg = $("chart");
    const W = 320, H = 120, padT = 8, padB = 4;
    const maxV = Math.max(...points.map((p) => p.value)) || 1;
    const n = points.length - 1 || 1;
    const x = (i) => (i / n) * W;
    const y = (v) => padT + (H - padT - padB) * (1 - v / maxV);

    const line = (key) => points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(2)},${y(p[key]).toFixed(2)}`).join(" ");
    const area = (key) => `${line(key)} L${W},${H} L0,${H} Z`;
    const last = points[points.length - 1];

    const grid = [0.25, 0.5, 0.75].map((f) =>
      `<line x1="0" x2="${W}" y1="${padT + (H - padT - padB) * f}" y2="${padT + (H - padT - padB) * f}" stroke="#eef2f7" stroke-width="1"/>`).join("");

    svg.innerHTML = `
      <defs>
        <linearGradient id="gGrow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#3fb67b" stop-opacity=".45"/>
          <stop offset="1" stop-color="#3fb67b" stop-opacity=".05"/>
        </linearGradient>
        <linearGradient id="gInv" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#94a3b8" stop-opacity=".35"/>
          <stop offset="1" stop-color="#94a3b8" stop-opacity=".04"/>
        </linearGradient>
      </defs>
      ${grid}
      <path d="${area("value")}" fill="url(#gGrow)"/>
      <path d="${area("invested")}" fill="url(#gInv)"/>
      <path d="${line("value")}" fill="none" stroke="#3fb67b" stroke-width="2" vector-effect="non-scaling-stroke"/>
      <path d="${line("invested")}" fill="none" stroke="#64748b" stroke-width="1.6" stroke-dasharray="3 3" vector-effect="non-scaling-stroke"/>
      <circle cx="${W}" cy="${y(last.value)}" r="3" fill="#3fb67b" stroke="#fff" stroke-width="1"/>
      <circle cx="${W}" cy="${y(last.invested)}" r="2.6" fill="#64748b" stroke="#fff" stroke-width="1"/>`;

    $("xMid").textContent = `Year ${Math.round(last.year / 2)}`;
    $("xEnd").textContent = `Year ${last.year} (Maturity)`;
  };

  const render = (res) => {
    const s = summarize(res);

    $("total").textContent = fmt(s.total);
    $("invested").textContent = fmt(s.invested);
    $("returns").textContent = (s.returns >= 0 ? "+" : "−") + fmt(Math.abs(s.returns));
    $("invPct").textContent = s.invPct + "%";
    $("retPct").textContent = s.retPct + "%";
    $("pctGain").textContent = (s.gainPct >= 0 ? "+" : "") + s.gainPct.toFixed(1) + "%";
    $("multiple").textContent = s.multiple.toFixed(2) + "x";
    $("barInv").style.width = s.invPct + "%";
    drawChart(res.points);

    $("empty").hidden = true;
    $("results").hidden = false;
  };

  const readInputs = () => ({
    lump: parseNum(fields.lump.value),
    sip: parseNum(fields.sip.value),
    every: Number(freq.value),
    years: Math.floor(parseNum(fields.years.value)),
    stay: Math.floor(parseNum(fields.stay.value)),
    rate: parseNum(fields.rate.value),
    stepup: stepupOn.checked ? parseNum(fields.stepup.value) : 0,
  });

  const validate = (v) => {
    document.querySelectorAll(".input.invalid").forEach((el) => el.classList.remove("invalid"));
    const fail = (id, msg) => { fields[id].closest(".input").classList.add("invalid"); return msg; };
    if (v.lump <= 0 && v.sip <= 0) return fail("lump", "Enter a lump sum or a periodic investment amount.");
    if (v.sip > 0 && v.years < 1) return fail("years", "Investment period must be at least 1 year.");
    if (v.stay < 1 || v.stay > 100) return fail("stay", "Stay-invested period must be between 1 and 100 years.");
    if (v.stay < v.years) return fail("stay", "Stay-invested period can't be shorter than the investment period.");
    if (v.rate > 50) return fail("rate", "Expected return must be 50% or lower.");
    if (stepupOn.checked && v.stepup > 100) return fail("stepup", "Step-up must be 100% or lower.");
    return "";
  };

  const showError = (msg) => {
    $("error").textContent = msg;
    $("error").hidden = !msg;
  };

  const run = () => {
    const v = readInputs();
    const err = validate(v);
    showError(err);
    if (err) return;
    render(calculate(v));
    setButton(true);
  };

  /* ---------- Events ---------- */
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    run();
  });

  const markDirty = () => { if (calculated) setButton(false); };

  ["lump", "sip"].forEach((id) =>
    fields[id].addEventListener("input", () => { formatMoneyInput(fields[id]); markDirty(); }));
  ["years", "stay"].forEach((id) =>
    fields[id].addEventListener("input", () => { sanitizeNumeric(fields[id], false); markDirty(); }));
  ["rate", "stepup"].forEach((id) =>
    fields[id].addEventListener("input", () => { sanitizeNumeric(fields[id], true); markDirty(); }));
  freq.addEventListener("change", markDirty);

  stepupOn.addEventListener("change", () => {
    document.querySelector(".stepup-extra").hidden = !stepupOn.checked;
    markDirty();
  });

  document.querySelectorAll(".cur").forEach((btn) =>
    btn.addEventListener("click", () => {
      currency = btn.dataset.cur;
      document.querySelectorAll(".cur").forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".sym").forEach((s) => (s.textContent = CURRENCIES[currency].symbol));
      ["lump", "sip"].forEach((id) => formatMoneyInput(fields[id]));
      if (calculated) run();
    }));

  // Init
  ["lump", "sip"].forEach((id) => formatMoneyInput(fields[id]));
})();
