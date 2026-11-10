(function (root) {
  /* Annual compounding. Growth is applied monthly at the equivalent rate (1 + R)^(1/12) - 1,
     so every full year grows by exactly R. Periodic contributions are made at the start of
     each contribution period, i.e. FV = P × [((1 + r)^n − 1) / r] × (1 + r), during the
     investment term; the corpus then keeps compounding
     until the end of the stay-invested term. Step-up raises the contribution at the start of
     every new year, by a % (stepup) or a fixed amount (stepupAmt). */
  function calculate({ lump, sip, every, years, stay, rate, stepup, stepupAmt = 0 }) {
    const r = Math.pow(1 + rate / 100, 1 / 12) - 1;
    const investMonths = years * 12;
    const totalMonths = stay * 12;
    let balance = lump;
    let invested = lump;
    const points = [{ year: 0, invested, value: balance }];

    for (let m = 1; m <= totalMonths; m++) {
      if (m <= investMonths && (m - 1) % every === 0) {
        const yearIdx = Math.floor((m - 1) / 12);
        const amt = sip * Math.pow(1 + stepup / 100, yearIdx) + stepupAmt * yearIdx;
        balance += amt;
        invested += amt;
      }
      balance *= 1 + r;
      if (m % 12 === 0) points.push({ year: m / 12, invested, value: balance });
    }
    return { total: balance, invested, returns: balance - invested, points };
  }

  // Half-up rounding to d decimals; avoids toFixed's binary errors (1.005 -> "1.00")
  function roundTo(x, d) {
    const f = Math.pow(10, d);
    return Math.round(x * f * (1 + Number.EPSILON)) / f;
  }

  /* Display figures. Returns are derived from the rounded total and invested amounts so
     the three numbers on screen always add up, and the two percentages always sum to 100. */
  function summarize(res) {
    const total = Math.round(res.total);
    const invested = Math.round(res.invested);
    const returns = total - invested;
    const invPct = total ? Math.round((res.invested / res.total) * 100) : 0;
    return {
      total,
      invested,
      returns,
      invPct,
      retPct: total ? 100 - invPct : 0,
      gainPct: res.invested ? roundTo((res.returns / res.invested) * 100, 1) : 0,
      multiple: res.invested ? roundTo(res.total / res.invested, 2) : 0,
    };
  }

  const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
    "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  function below1000(n) {
    let s = "";
    if (n >= 100) { s += ONES[Math.floor(n / 100)] + " Hundred"; n %= 100; if (n) s += " "; }
    if (n >= 20) { s += TENS[Math.floor(n / 10)]; n %= 10; if (n) s += " " + ONES[n]; }
    else if (n > 0) s += ONES[n];
    return s;
  }

  // system: "INR" (Lakh/Crore) or "USD" (Million/Billion)
  function toWords(num, system) {
    num = Math.floor(num);
    if (num === 0) return "Zero";
    const units = system === "INR"
      ? [[1e7, "Crore"], [1e5, "Lakh"], [1e3, "Thousand"]]
      : [[1e12, "Trillion"], [1e9, "Billion"], [1e6, "Million"], [1e3, "Thousand"]];
    const parts = [];
    for (const [value, name] of units) {
      if (num >= value) {
        const q = Math.floor(num / value);
        // Crores can exceed 999 — recurse so "1,234 Crore" still reads correctly
        parts.push((q >= 1000 ? toWords(q, system) : below1000(q)) + " " + name);
        num %= value;
      }
    }
    if (num) parts.push(below1000(num));
    return parts.join(" ");
  }

  const api = { calculate, summarize, roundTo, toWords };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CompoundCalc = api;
})(this);
