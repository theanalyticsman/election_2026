// Statewide outcome projection from partial county results. Pure functions (no page access), so the same code runs in the
// browser and in the Node backtest (scripts/backtest_projection.js).
//
// Idea: the votes already counted are certain; the question is what the REST will look like.
//  1. Expected size of each county's final vote = what it cast before (base) scaled by how this year's turnout is running
//     in the counties that have reported; the share still to come is (1 - percent in) of that.
//  2. Each reporting county implies a statewide margin (its margin now minus its usual lean vs its state, from the affinity
//     model). They are averaged, weighted toward the best bellwethers, into a statewide estimate S with a standard error.
//  3. The pre-election poll average acts as a prior for S: it dominates while little is counted and fades as counties report.
//  4. A county's remaining votes are projected at S + its usual lean (a partly-counted county keeps part of its own deviation).
//  5. Final margin = counted votes plus projected remaining votes, as one statewide number, with a range and win probability.
const PROJ = (() => {
  // defaults picked with scripts/backtest_projection.js (size weighting and a county noise of 2 gave the most accurate, best-calibrated ranges)
  const PARAMS = { sizeWeight: 0.5, lambda: 0.5, spreadFloor: 3, seFloor: 1.5, countyNoise: 2, systematic: 0.5, pollExtra: 2.5, minPct: 0, sysEarly: 4, cred: 0.05, tiltK: 0.6 };

  const phi = z => { // standard normal CDF (Abramowitz-Stegun)
    const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
  };

  // counties: [{ fips, d, r, o, pct (0-100 or null/undefined = fully counted), base (prior total votes or null), lean (D+ points), score }]
  // poll: { margin, err } or null.  Margins are in points, D positive.
  function project(counties, poll, params) {
    const P = Object.assign({}, PARAMS, params || {});
    const rows = counties.map(c => {
      const t = (c.d || 0) + (c.r || 0) + (c.o || 0);
      const p = c.pct == null || isNaN(c.pct) ? (t > 0 ? 1 : 0) : Math.max(0, Math.min(1, c.pct / 100));
      return { ...c, t, p: t > 0 ? Math.max(p, 0.02) : 0, m: t > 0 ? (c.d - c.r) / t * 100 : null };
    });
    const rep = rows.filter(c => c.t > 0);
    if (!rep.length) return null;

    // 1. turnout scale: this year's votes per prior vote in the counties that have reported
    let num = 0, den = 0;
    for (const c of rep) if (c.base > 0) { num += c.t; den += c.base * c.p; }
    const k = den > 0 ? num / den : null;
    for (const c of rows) {
      let rem;
      if (c.t === 0) rem = k != null && c.base > 0 ? k * c.base : 0;
      else if (c.p >= 0.999) rem = 0;
      else rem = k != null && c.base > 0 ? (1 - c.p) * k * c.base : c.t * (1 - c.p) / c.p;
      c.rem = Math.max(0, rem);
    }

    // share of the expected vote already counted (drives how much to trust a handful of early counties)
    const countedAll = rep.reduce((s, c) => s + c.t, 0), remAll = rows.reduce((s, c) => s + c.rem, 0), fIn = countedAll / (countedAll + remAll);
    // 2. statewide estimate from the reporting counties
    const est = rep.filter(c => c.lean != null && !isNaN(c.lean) && c.score != null && !isNaN(c.score) && c.p * 100 >= P.minPct).map(c => ({
      e: c.m - c.lean,
      w: (1 / ((+c.score + 0.5) ** 2)) * c.p * (P.sizeWeight ? Math.pow(Math.min(c.t, 50000) / 5000, P.sizeWeight) : 1),
    }));
    const counted = rep.reduce((s, c) => s + c.t, 0), D = rep.reduce((s, c) => s + c.d, 0), R = rep.reduce((s, c) => s + c.r, 0);
    const countedMargin = (D - R) / counted * 100;
    let S = countedMargin, seS = 8, nEff = 0, sdw = P.spreadFloor;
    if (est.length) {
      const W = est.reduce((s, x) => s + x.w, 0), mean = est.reduce((s, x) => s + x.w * x.e, 0) / W;
      sdw = Math.max(P.spreadFloor, Math.sqrt(est.reduce((s, x) => s + x.w * (x.e - mean) ** 2, 0) / W));
      nEff = W * W / est.reduce((s, x) => s + x.w * x.w, 0);
      S = mean; seS = Math.sqrt(sdw * sdw / Math.max(1, nEff) + P.seFloor * P.seFloor + (P.sysEarly * (1 - fIn)) ** 2); // the last term: early counties can all lean the same way (early/mail votes), fading as more is counted
    }
    // 3. prior: the poll average, or (without one) a weak history prior such as the state's last presidential margin
    let pollUsed = false;
    if (poll && poll.margin != null && !isNaN(poll.margin)) {
      const sdp = Math.sqrt((+poll.err || 4) ** 2 + P.pollExtra ** 2);
      // credibility: trust the counted counties in proportion to how much of the vote they are (cred = how much vote counts as 'half trust')
      // with a real poll average: if the counted counties disagree sharply with it, suspect early/mail-ballot tilt (every county shifted the same way) and trust them less (not used for the weak history prior, which is often far off; the backtest has no polls, so this guard is untested)
      const tilt = poll.isPoll ? P.tiltK * Math.abs(S - (+poll.margin)) * (1 - fIn) : 0, seD = Math.sqrt(seS * seS + tilt * tilt);
      const a = (1 / (seD * seD)) * (P.cred > 0 ? fIn / (fIn + P.cred) : 1), b = 1 / (sdp * sdp);
      S = (S * a + (+poll.margin) * b) / (a + b); seS = Math.sqrt(1 / (a + b)); pollUsed = true;
    }
    // 4-5. final margin: counted votes + projected remaining votes
    let diff = 0, total = 0, remTotal = 0;
    for (const c of rows) {
      const lean = c.lean != null && !isNaN(c.lean) ? c.lean : 0;
      let remM = S + lean;
      if (c.t > 0 && c.p < 0.999 && est.length) remM += P.lambda * ((c.m - c.lean) - S); // a partly counted county keeps part of its own deviation
      if (c.t > 0) diff += c.d - c.r;
      diff += c.rem * remM / 100; total += c.t + c.rem; remTotal += c.rem;
    }
    const margin = diff / total * 100, fRem = remTotal / total;
    const sd = Math.sqrt((fRem * Math.hypot(seS, P.countyNoise)) ** 2 + P.systematic * P.systematic);
    return { margin, sd, lo: margin - sd, hi: margin + sd, pDem: phi(margin / sd), S, seS, nEff, pctIn: (1 - fRem) * 100,
      counted, projectedTotal: total, countedMargin, k, pollUsed, reporting: rep.length, counties: rows.length };
  }
  return { project, PARAMS, phi };
})();
if (typeof module !== 'undefined') module.exports = PROJ;
