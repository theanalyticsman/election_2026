// Backtest of web/model.js on history: pretend only some counties (or part of each county's vote) have reported, project the
// state's final margin, compare with what happened. Usage: node scripts/backtest_projection.js
// Affinity (lean/score) for each test is rebuilt ONLY from earlier contests, and the turnout base is the last presidential
// vote before the test year, so nothing from the test election leaks in. No polls exist for history, so the poll prior is not tested.
const fs = require('fs'), path = require('path');
const PROJ = require('../web/model.js');
const ROOT = path.resolve(__dirname, '..');

function parseLine(l) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < l.length; i++) {
    const ch = l[i];
    if (q) { if (ch === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur); return out;
}
const lines = fs.readFileSync(path.join(ROOT, 'data/processed/county_results.csv'), 'utf8').split(/\r?\n/).filter(Boolean);
const head = parseLine(lines[0]), ix = Object.fromEntries(head.map((h, i) => [h, i]));
// contests[`${office}|${year}|${race}`][state] = Map(fips -> {d,r,o})
const contests = {};
for (const l of lines.slice(1)) {
  const f = parseLine(l), office = f[ix.office];
  if (office !== 'president' && office !== 'senate') continue;
  const key = `${office}|${f[ix.year]}|${f[ix.race]}`, st = f[ix.state_po];
  ((contests[key] ||= {})[st] ||= new Map()).set(f[ix.county_fips], { d: +f[ix.dem_votes], r: +f[ix.rep_votes], o: +f[ix.other_votes] });
}
const sum = m => { let d = 0, r = 0, t = 0; for (const v of m.values()) { d += v.d; r += v.r; t += v.d + v.r + v.o; } return { d, r, t, margin: (d - r) / t * 100 }; };

// affinity from contests in the last three cycles BEFORE year Y (weights 1:2:4, most recent heaviest)
function affinityFor(st, Y) {
  const prior = Object.keys(contests).map(k => ({ k, office: k.split('|')[0], year: +k.split('|')[1] })).filter(x => x.year < Y && contests[x.k][st])
    .sort((a, b) => b.year - a.year).slice(0, 4);
  if (!prior.length) return null;
  const acc = new Map();
  prior.forEach((x, i) => {
    const m = contests[x.k][st], s = sum(m), w = 2 ** (prior.length - 1 - i);
    for (const [fips, v] of m) { const t = v.d + v.r + v.o; if (t <= 0) continue; const gap = (v.d - v.r) / t * 100 - s.margin; const a = acc.get(fips) || { g: 0, ag: 0, w: 0 }; a.g += w * gap; a.ag += w * Math.abs(gap); a.w += w; acc.set(fips, a); }
  });
  const out = new Map(); for (const [fips, a] of acc) out.set(fips, { lean: a.g / a.w, score: a.ag / a.w }); return out;
}
function baseFor(st, Y) { // last presidential county totals before Y
  const ks = Object.keys(contests).filter(k => k.startsWith('president|') && +k.split('|')[1] < Y && contests[k][st]).sort().reverse();
  if (!ks.length) return null; const m = new Map(); for (const [fips, v] of contests[ks[0]][st]) m.set(fips, v.d + v.r + v.o); return m;
}
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

const TESTS = [['senate|2022|regular', 2022], ['senate|2024|regular', 2024], ['president|2024|regular', 2024]];
const FRACS = [0.02, 0.05, 0.1, 0.25, 0.5];
const ORDERS = ['rural-first', 'urban-first', 'random'];
const variants = {
  'counted only': null,
  'bellwethers, no turnout (old)': 'old',
  'model, no early-count noise': { sysEarly: 0 },
  'model': {},
  'model + history prior': { _prior: true },
  'model + prior, credibility 0.05': { _prior: true, cred: 0.05 },
  'model + prior, credibility 0.1': { _prior: true, cred: 0.1 },
  'model + prior, credibility 0.2': { _prior: true, cred: 0.2 },
};

function run(mode) {
  const partial = mode !== 'full';
  const res = {}; for (const v of Object.keys(variants)) res[v] = { err: [], byF: {}, inByF: {}, within1: 0, within2: 0, n: 0 };
  for (const [key, Y] of TESTS) {
    for (const st of Object.keys(contests[key])) {
      const final = contests[key][st]; if (final.size < 8) continue;
      const aff = affinityFor(st, Y), base = baseFor(st, Y); if (!aff || !base) continue;
      const pk = Object.keys(contests).filter(k => k.startsWith('president|') && +k.split('|')[1] < Y && contests[k][st]).sort().reverse()[0];
      const priorMargin = pk ? sum(contests[pk][st]).margin : null;
      const fs_ = sum(final); if (fs_.t <= 0) continue;
      for (const order of ORDERS) for (const f of FRACS) for (let rep = 0; rep < (order === 'random' ? 5 : 1); rep++) {
        const rand = rng(Y * 1000 + st.charCodeAt(0) * 31 + st.charCodeAt(1) + rep * 7919 + Math.round(f * 100));
        const tilt = (rand() * 2 - 1) * 8;
        let list = [...final.entries()].filter(([fips, v]) => v.d + v.r + v.o > 0);
        if (order === 'rural-first') list.sort((a, b) => (a[1].d + a[1].r + a[1].o) - (b[1].d + b[1].r + b[1].o));
        else if (order === 'urban-first') list.sort((a, b) => (b[1].d + b[1].r + b[1].o) - (a[1].d + a[1].r + a[1].o));
        else list.sort(() => rand() - 0.5);
        const rows = []; let got = 0; const need = f * fs_.t;
        for (const [fips, v] of list) {
          if (got >= need) break;
          const p = partial ? 0.3 + 0.7 * rand() : 1, t = v.d + v.r + v.o;
          // 'tilt': the votes counted so far lean differently from the rest (early/mail votes), the same way in every county of a state
          const dl = mode === 'tilt' && p < 0.999 ? Math.round((tilt / 200) * t * p) : 0;
          rows.push({ fips, d: Math.round(v.d * p) + dl, r: Math.round(v.r * p) - dl, o: Math.round(v.o * p), pct: p * 100 }); got += t * p;
        }
        const county = (fips, extra) => ({ fips, base: base.get(fips), lean: aff.get(fips)?.lean, score: aff.get(fips)?.score, ...extra });
        const counties = [...final.keys()].map(fips => { const r = rows.find(x => x.fips === fips); return r ? county(fips, r) : county(fips, { d: 0, r: 0, o: 0 }); });
        for (const [name, cfg] of Object.entries(variants)) {
          let est, sd = null, err = null;
          const R_ = rows.reduce((a, x) => ({ d: a.d + x.d, r: a.r + x.r, t: a.t + x.d + x.r + x.o }), { d: 0, r: 0, t: 0 });
          if (cfg === null) est = (R_.d - R_.r) / R_.t * 100;
          else if (cfg === 'old') {
            const e = rows.map(x => { const a = aff.get(x.fips); const t = x.d + x.r + x.o; return a ? { v: (x.d - x.r) / t * 100 - a.lean, w: 1 / ((a.score + 0.5) ** 2) } : null; }).filter(Boolean);
            if (e.length < 3) continue; const W = e.reduce((s, z) => s + z.w, 0); est = e.reduce((s, z) => s + z.w * z.v, 0) / W;
          } else { const c2 = { ...cfg }; const usePrior = c2._prior; delete c2._prior; const o = PROJ.project(counties, usePrior && priorMargin != null ? { margin: priorMargin, err: 6.5 } : null, c2); if (!o) continue; est = o.margin; sd = o.sd; err = est - fs_.margin; (res[name].inByF[f] ||= []).push(Math.abs(err) <= sd ? 1 : 0); }
          if (err === null) err = est - fs_.margin;
          const r = res[name]; r.err.push(err); (r.byF[f] ||= []).push(err); r.n++;
          if (err === null) err = est - fs_.margin;
          if (sd != null) { if (Math.abs(err) <= sd) r.within1++; if (Math.abs(err) <= 2 * sd) r.within2++; }
        }
      }
    }
  }
  return res;
}
const mae = a => a.reduce((s, x) => s + Math.abs(x), 0) / a.length, bias = a => a.reduce((s, x) => s + x, 0) / a.length;
for (const [label, mode] of [['Counties reported in full (2% to 50% of the final vote)', 'full'], ['Counties reported partly (each 30-100% in)', 'partial'], ['Counties partly in, and the votes counted so far lean up to 8 points differently from the rest', 'tilt']]) {
  const res = run(mode);
  console.log('\n' + label);
  console.log('variant'.padEnd(38), 'cases'.padStart(6), 'avg miss'.padStart(10), 'bias'.padStart(7), 'in range 1sd'.padStart(13), '2sd'.padStart(6));
  for (const [name, r] of Object.entries(res)) {
    if (!r.n) continue;
    const cal = name.startsWith('model') ? `${(100 * r.within1 / r.n).toFixed(0)}%`.padStart(13) + `${(100 * r.within2 / r.n).toFixed(0)}%`.padStart(6) : ''.padStart(19);
    const byF = FRACS.map(f => `${f * 100}%: ${mae(r.byF[f]).toFixed(2)}`).join('  ');
    console.log(name.padEnd(38), String(r.n).padStart(6), (mae(r.err).toFixed(2) + ' pts').padStart(10), bias(r.err).toFixed(2).padStart(7), cal, '  by share counted ->', byF);
  }
}
