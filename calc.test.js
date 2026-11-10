// Run with: node --test
const test = require("node:test");
const assert = require("node:assert/strict");
const { calculate, summarize, roundTo, toWords } = require("./calc.js");

const base = { lump: 0, sip: 0, every: 1, years: 0, stay: 0, rate: 0, stepup: 0 };
const run = (o) => calculate({ ...base, ...o });

// FV = P × [((1 + r)^n − 1) / r] × (1 + r): payment at the start of each of n periods
const annuityFV = (p, i, n) => (i === 0 ? p * n : ((p * (Math.pow(1 + i, n) - 1)) / i) * (1 + i));
// Equivalent monthly rate for annual compounding at R%
const monthly = (R) => Math.pow(1 + R / 100, 1 / 12) - 1;
const close = (actual, expected, label) =>
  assert.ok(Math.abs(actual - expected) < 0.01, `${label}: got ${actual}, expected ${expected}`);

test("1. Screenshot inputs: ₹5,000 lump + ₹5,000/month, 10y invest, 15y stay, 12% compounded annually", () => {
  const res = run({ lump: 5000, sip: 5000, years: 10, stay: 15, rate: 12 });
  const m = monthly(12);
  const expected = 5000 * Math.pow(1.12, 15) + annuityFV(5000, m, 120) * Math.pow(1.12, 5);
  close(res.total, expected, "total");
  assert.equal(Math.round(res.total), 2001507);
  assert.equal(res.invested, 605000);
  assert.equal(Math.round(res.returns), 1396507);
});

test("2. Lump sum only: ₹1,00,000 for 10y at 12% = 100000 × 1.12^n at every year-end", () => {
  const res = run({ lump: 100000, stay: 10, rate: 12 });
  close(res.total, 100000 * Math.pow(1.12, 10), "total");
  res.points.forEach((p) => close(p.value, 100000 * Math.pow(1.12, p.year), `year ${p.year}`));
  assert.equal(res.invested, 100000);
});

test("3. Zero return: value equals amount invested", () => {
  const res = run({ lump: 10000, sip: 2000, years: 5, stay: 8, rate: 0 });
  assert.equal(res.invested, 10000 + 2000 * 12 * 5);
  close(res.total, res.invested, "total");
  close(res.returns, 0, "returns");
});

test("4. Quarterly ₹15,000 for 5y at 8% (effective quarterly rate)", () => {
  const res = run({ sip: 15000, every: 3, years: 5, stay: 5, rate: 8 });
  const q = Math.pow(1.08, 1 / 4) - 1;
  close(res.total, annuityFV(15000, q, 20), "total");
  assert.equal(res.invested, 15000 * 20);
});

test("5. Step-up 10%: ₹10,000/month for 3y at 12%, each year's SIP grown to maturity", () => {
  const res = run({ sip: 10000, years: 3, stay: 3, rate: 12, stepup: 10 });
  let expected = 0;
  for (let k = 0; k < 3; k++) {
    const yearFV = annuityFV(10000 * Math.pow(1.1, k), monthly(12), 12);
    expected += yearFV * Math.pow(1.12, 2 - k);
  }
  close(res.total, expected, "total");
  close(res.invested, 12 * (10000 + 11000 + 12100), "invested");
});

/* Independent closed-form reference: each year's contributions are an ordinary annuity at
   the effective per-period rate, then grown to maturity; the lump sum compounds throughout. */
function reference({ lump, sip, every, years, stay, rate, stepup }) {
  const R = 1 + rate / 100;
  const perYear = 12 / every;
  const q = Math.pow(R, every / 12) - 1;
  let total = lump * Math.pow(R, stay);
  let invested = lump;
  for (let k = 0; k < years; k++) {
    const amt = sip * Math.pow(1 + stepup / 100, k);
    total += annuityFV(amt, q, perYear) * Math.pow(R, stay - k - 1);
    invested += amt * perYear;
  }
  return { total, invested };
}

// Deterministic PRNG so failures are reproducible
let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const randInt = (a, b) => a + Math.floor(rand() * (b - a + 1));
const randomInput = () => {
  const years = randInt(0, 40);
  return {
    lump: randInt(0, 1e7),
    sip: randInt(0, 2e5),
    every: [1, 3, 6, 12][randInt(0, 3)],
    years,
    stay: years + randInt(years ? 0 : 1, 30),
    rate: randInt(0, 3000) / 100,
    stepup: rand() < 0.5 ? 0 : randInt(0, 2500) / 100,
  };
};

test("6. 5,000 random inputs match the closed-form reference (all frequencies, step-up)", () => {
  for (let i = 0; i < 5000; i++) {
    const input = randomInput();
    const res = calculate(input);
    const ref = reference(input);
    const tol = (x) => Math.max(1e-6, Math.abs(x) * 1e-11);
    assert.ok(Math.abs(res.total - ref.total) <= tol(ref.total), `total ${JSON.stringify(input)}: ${res.total} vs ${ref.total}`);
    assert.ok(Math.abs(res.invested - ref.invested) <= tol(ref.invested), `invested ${JSON.stringify(input)}`);
    // Yearly chart points: one per year, ending at the final figures, never decreasing
    assert.equal(res.points.length, input.stay + 1);
    assert.equal(res.points.at(-1).value, res.total);
    for (let y = 1; y < res.points.length; y++) assert.ok(res.points[y].value >= res.points[y - 1].value);
  }
});

test("7. Displayed figures always add up and percentages sum to 100", () => {
  const stepupCase = summarize(calculate({ ...base, lump: 0, sip: 5000, years: 5, stay: 5, rate: 12, stepup: 7 }));
  assert.equal(stepupCase.total, stepupCase.invested + stepupCase.returns);
  for (let i = 0; i < 5000; i++) {
    const input = randomInput();
    if (!input.lump && (!input.sip || !input.years)) continue;
    const s = summarize(calculate(input));
    assert.equal(s.total, s.invested + s.returns);
    assert.equal(s.invPct + s.retPct, 100);
    assert.ok(Number.isInteger(s.total) && Number.isInteger(s.invested));
  }
});

test("8. Screenshot-input badges: +230.8%, 3.31x, 30% / 70%", () => {
  const s = summarize(run({ lump: 5000, sip: 5000, years: 10, stay: 15, rate: 12 }));
  assert.deepEqual(
    { total: s.total, invested: s.invested, returns: s.returns, invPct: s.invPct, retPct: s.retPct, gain: s.gainPct.toFixed(1), x: s.multiple.toFixed(2) },
    { total: 2001507, invested: 605000, returns: 1396507, invPct: 30, retPct: 70, gain: "230.8", x: "3.31" }
  );
});

test("9. Rounding is half-up even where toFixed fails", () => {
  assert.equal(roundTo(1.005, 2).toFixed(2), "1.01");
  assert.equal(roundTo(2.675, 2).toFixed(2), "2.68");
  assert.equal(roundTo(3.505, 2).toFixed(2), "3.51");
  assert.equal(roundTo(250.25, 1).toFixed(1), "250.3");
  assert.equal(roundTo(3.504999, 2).toFixed(2), "3.50");
});

test("10. Amounts in words (Indian and international)", () => {
  const cases = [
    [0, "INR", "Zero"],
    [5000, "INR", "Five Thousand"],
    [100000, "INR", "One Lakh"],
    [2119532, "INR", "Twenty One Lakh Nineteen Thousand Five Hundred Thirty Two"],
    [10000000, "INR", "One Crore"],
    [9999999999999, "INR", "Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine Crore Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine"],
    [101, "USD", "One Hundred One"],
    [1234567, "USD", "One Million Two Hundred Thirty Four Thousand Five Hundred Sixty Seven"],
    [2000000000, "USD", "Two Billion"],
  ];
  for (const [n, sys, words] of cases) assert.equal(toWords(n, sys), words);
});

test("11. Currency digit grouping", () => {
  assert.equal((2119532).toLocaleString("en-IN"), "21,19,532");
  assert.equal((2119532).toLocaleString("en-US"), "2,119,532");
  assert.equal((1514532).toLocaleString("en-IN"), "15,14,532");
});

/* Hard cases. Expected values: published real-world figures where they exist, otherwise an
   independent 60-digit Python Decimal implementation of the same formula. */
const HARD = [
  ["H1. Groww example: ₹1,000/month, 12 months, 12% (published ≈ ₹12,766)",
    { sip: 1000, years: 1, stay: 1, rate: 12 }, 12766.497908353178, 12000],
  ["H2. Textbook: ₹1,00,000 at 12% for 10y = 1.12^10 (₹3,10,584.82)",
    { lump: 100000, stay: 10, rate: 12 }, 310584.820834420916, 100000],
  ["H3. Textbook: ₹10,000 at 8% for 30y = 1.08^30 (₹1,00,626.57)",
    { lump: 10000, stay: 30, rate: 8 }, 100626.568890734301, 10000],
  ["H4. Rule of 72: ₹1,00,000 at 7.2% roughly doubles in 10y",
    { lump: 100000, stay: 10, rate: 7.2 }, 200423.136165433737, 100000],
  ["H5. PPF: ₹1,50,000/year for 15y at 7.1% (published ₹40,68,209)",
    { sip: 150000, every: 12, years: 15, stay: 15, rate: 7.1 }, 4068209.220288, 2250000],
  ["H6. Quarterly ₹12,345, 7.5% step-up, 17y invest, 33y stay, 11.35%",
    { sip: 12345, every: 3, years: 17, stay: 33, rate: 11.35, stepup: 7.5 }, 21460706.29099, 1592901.778729],
  ["H7. ₹7,77,777 lump + ₹3,333/month, +₹2,500/yr fixed step-up, 37y invest, 41y stay, 13.7%",
    { lump: 777777, sip: 3333, years: 37, stay: 41, rate: 13.7, stepupAmt: 2500 }, 524346532.410138, 22237629],
  ["H8. 0% return, half-yearly ₹9,999 with 9.99% step-up for 25y: value = invested",
    { sip: 9999, every: 6, years: 25, stay: 25, rate: 0, stepup: 9.99 }, 1963789.278288, 1963789.278288],
  ["H9. Extreme: ₹99,99,99,99,99,999 lump at 50% for 100y",
    { lump: 9999999999999, stay: 100, rate: 50 }, 4.065611775351745812795e30, 9999999999999],
];

for (const [name, input, expTotal, expInvested] of HARD) {
  test(name, () => {
    const res = run(input);
    const rel = (a, b) => Math.abs(a - b) / Math.max(1, Math.abs(b));
    assert.ok(rel(res.total, expTotal) < 1e-12, `total ${res.total} vs ${expTotal}`);
    assert.ok(rel(res.invested, expInvested) < 1e-12, `invested ${res.invested} vs ${expInvested}`);
    if (expTotal < 1e15) assert.equal(Math.round(res.total), Math.round(expTotal));
  });
}

test("H10. Tiny: ₹1/month for 1y at 0.01% — paise-level growth, display rounds cleanly", () => {
  const res = run({ sip: 1, years: 1, stay: 1, rate: 0.01 });
  assert.ok(Math.abs(res.total - 12.00065) < 1e-6, `total ${res.total}`);
  const s = summarize(res);
  assert.deepEqual(
    { total: s.total, invested: s.invested, returns: s.returns, invPct: s.invPct, retPct: s.retPct, gain: s.gainPct.toFixed(1) },
    { total: 12, invested: 12, returns: 0, invPct: 100, retPct: 0, gain: "0.0" }
  );
});
