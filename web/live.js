// Election-night entry (paste county results) and bellwether projection.
// Loaded before app.js; it uses app.js globals (affinity, fipsToPo, cache, loadAvailable, ...) only inside
// functions that run later. Results live in this browser (localStorage); use Export to keep a copy.
const LV_KEY = 'elec2026_v1';
let LIVE = lvLoad();
function lvLoad() {
  try { const v = JSON.parse(localStorage.getItem(LV_KEY)); if (v && v.contests) return v; } catch (e) { /* private mode etc. */ }
  return { contests: {}, minPct: 70 };
}
function lvSave() { try { localStorage.setItem(LV_KEY, JSON.stringify(LIVE)); } catch (e) { /* ignore */ } }

// ---- hooks used by app.js so 2026 behaves like any other year ----
function liveAvailable() {
  return [...new Set(Object.values(LIVE.contests).map(c => c.office))].map(office => ({ office, year: 2026 }));
}
function liveElection(office) {
  const m = new Map();
  for (const c of Object.values(LIVE.contests)) {
    if (c.office !== office) continue;
    for (const r of c.rows) {
      const row = { office, year: 2026, race: c.race, state_po: c.state_po, county_fips: r.fips, county_name: r.name,
        dem_votes: r.d, rep_votes: r.r, other_votes: r.o, total_votes: r.d + r.r + r.o,
        dem_candidate: r.dc || '', rep_candidate: r.rc || '', pct_reporting: r.pct };
      if (!m.has(r.fips)) m.set(r.fips, []);
      m.get(r.fips).push(row);
    }
  }
  return m;
}

// ---- parsing ----
const lvNum = s => { const t = String(s ?? '').replace(/[,\s]/g, ''); return /^-?\d+(\.\d+)?$/.test(t) ? +t : NaN; };
function lvSplitCsv(l) {
  const out = []; let cur = '', q = false;
  for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur.trim()); cur = ''; } else cur += ch; }
  out.push(cur.trim()); return out;
}
function lvFallbackSplit(l) {
  const m = l.match(/^(.*?)\s+((?:[\d,.]+%?\s*)+)$/);
  return m ? [m[1].trim(), ...m[2].trim().split(/\s+/)] : [l];
}
function lvParse(text) {
  const lines = text.replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (!lines.length) return [];
  const tabs = lines.filter(l => l.includes('\t')).length > lines.length / 2;
  const csvish = !tabs && lines.every(l => l.includes(',')) && !lines.some(l => /\d,\d{3}(\D|$)/.test(l) && !l.includes('"'));
  return lines.map(l => tabs ? l.split('\t').map(s => s.trim())
    : csvish ? lvSplitCsv(l)
    : l.split(/\s{2,}/).length > 2 ? l.split(/\s{2,}/).map(s => s.trim())
    : lvFallbackSplit(l.trim()));
}
function lvGuess(rows) {
  const hasHeader = rows[0].filter(c => !isNaN(lvNum(c))).length < 2;
  const head = hasHeader ? rows[0] : [];
  const ncol = Math.max(...rows.map(r => r.length));
  const find = re => head.findIndex(h => re.test(h));
  const g = { county: 0, dem: find(/\(d\)|dem|biden|harris|^d$/i), rep: find(/\(r\)|rep|gop|trump|^r$/i),
    other: find(/other|\bind\b|libert|green/i), total: find(/total/i), pct: find(/report|% in|counted|expected/i) };
  const data = rows.slice(hasHeader ? 1 : 0);
  const numeric = [...Array(ncol).keys()].filter(c => c !== g.county && data.filter(r => !isNaN(lvNum(r[c]))).length > data.length * 0.6);
  if (g.dem < 0) g.dem = numeric[0] ?? -1;
  if (g.rep < 0) g.rep = numeric.find(c => c !== g.dem) ?? -1;
  return { hasHeader, g, ncol, head };
}

// ---- county-name matching (within one state) ----
function lvNorm(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, 'and').replace(/\bsaint\b/g, 'st').replace(/\bste\.?\b/g, 'ste')
    .replace(/\b(county|parish|borough|census area|municipality|city and borough)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}
function lvCounties(po) { return affinity ? [...affinity.values()].filter(r => r.state_po === po) : []; }

// ---- dialog ----
const lvQ = id => document.getElementById(id);
let lvPrev = null; // {matched, unmatched, po, office, race}

function lvBuildDialog() {
  const d = document.createElement('dialog');
  d.id = 'lvDlg';
  d.innerHTML = `
    <form method="dialog" id="lvForm">
      <button type="button" id="lvClose" class="x" aria-label="Close">&times;</button>
      <h2>Add 2026 results</h2>
      <p class="muted">Copy a county results table from NYT, CNN, a state site or anywhere else and paste it here. Re-paste a state as numbers update; it replaces that state's earlier numbers.</p>
      <div class="row">
        <label>State <select id="lvState"></select></label>
        <label>Contest <select id="lvOffice"><option value="senate">Senate</option><option value="house">House (county totals)</option><option value="president">President</option></select></label>
        <label>Race type <select id="lvRace"><option value="regular">Regular</option><option value="special">Special</option></select></label>
      </div>
      <textarea id="lvText" rows="8" placeholder="Paste here. Needs a county name column plus Democratic and Republican vote columns (vote counts, not percentages). Optional: other votes, % reporting."></textarea>
      <div id="lvMap"></div>
      <div id="lvPreview" class="muted"></div>
      <div class="row actions">
        <button type="button" id="lvApply" disabled>Add to map</button>
        <button type="button" id="lvExport">Export all as CSV</button>
        <button type="button" id="lvClear">Clear all 2026 data</button>
      </div>
      <div id="lvSaved" class="muted small"></div>
    </form>`;
  document.body.appendChild(d);
  lvQ('lvClose').onclick = () => d.close();
  lvQ('lvText').oninput = lvRefresh;
  ['lvState', 'lvOffice', 'lvRace'].forEach(id => lvQ(id).onchange = lvRefresh);
  lvQ('lvApply').onclick = lvApply;
  lvQ('lvExport').onclick = lvExport;
  lvQ('lvClear').onclick = () => {
    if (!confirm('Remove all 2026 results saved in this browser?')) return;
    LIVE = { contests: {}, minPct: LIVE.minPct }; lvSave(); lvAfterChange(null); lvSavedList();
  };
  lvQ('addLive').onclick = async () => {
    await ensureAffinity();
    const states = [...new Set([...affinity.values()].map(r => r.state_po))].sort();
    lvQ('lvState').innerHTML = states.map(s => `<option value="${s}">${STATE_NAMES[s] || s}</option>`).join('');
    if (typeof selectedPo === 'string' && states.includes(selectedPo)) lvQ('lvState').value = selectedPo;
    lvSavedList(); lvRefresh(); d.showModal();
  };
}

function lvRefresh() {
  const text = lvQ('lvText').value, po = lvQ('lvState').value;
  const mapDiv = lvQ('lvMap'), prev = lvQ('lvPreview');
  lvPrev = null; lvQ('lvApply').disabled = true;
  const rows = lvParse(text);
  if (!rows.length) { mapDiv.innerHTML = ''; prev.textContent = ''; return; }
  const { hasHeader, g, ncol, head } = lvGuess(rows);
  // column pickers (kept if the user changed them; rebuilt when the pasted shape changes)
  const sig = ncol + '|' + (hasHeader ? rows[0].join('~') : '');
  if (mapDiv.dataset.sig !== sig) {
    const opts = sel => `<option value="-1">(none)</option>` + [...Array(ncol).keys()].map(c => `<option value="${c}" ${c === sel ? 'selected' : ''}>${c + 1}: ${esc(head[c] || rows[hasHeader ? 1 : 0]?.[c] || '')}</option>`).join('');
    mapDiv.dataset.sig = sig;
    mapDiv.innerHTML = `<div class="row small">
      <label>County <select id="lvcCounty">${opts(g.county)}</select></label>
      <label>Democratic votes <select id="lvcDem">${opts(g.dem)}</select></label>
      <label>Republican votes <select id="lvcRep">${opts(g.rep)}</select></label>
      <label>Other votes <select id="lvcOther">${opts(g.other)}</select></label>
      <label>Total votes <select id="lvcTotal">${opts(g.total)}</select></label>
      <label>% reporting <select id="lvcPct">${opts(g.pct)}</select></label>
      <label class="chk"><input type="checkbox" id="lvHdr" ${hasHeader ? 'checked' : ''}> first row is a header</label></div>`;
    mapDiv.querySelectorAll('select,input').forEach(el => el.onchange = lvRefresh);
  }
  const col = id => +lvQ(id).value;
  const c = { county: col('lvcCounty'), dem: col('lvcDem'), rep: col('lvcRep'), other: col('lvcOther'), total: col('lvcTotal'), pct: col('lvcPct') };
  const hdr = lvQ('lvHdr').checked, body = rows.slice(hdr ? 1 : 0);
  if (c.county < 0 || c.dem < 0 || c.rep < 0) { prev.textContent = 'Choose the county, Democratic and Republican columns.'; return; }
  const clean = h => (h || '').replace(/\s*\([A-Za-z]{1,3}\)\s*/g, '').trim();
  const dc = hdr ? clean(rows[0][c.dem]) : '', rc = hdr ? clean(rows[0][c.rep]) : '';
  const idx = new Map();
  for (const r of lvCounties(po)) { const k = lvNorm(r.county_name); (idx.get(k) || idx.set(k, []).get(k)).push(r.county_fips); }
  const used = new Set(), matched = [], unmatched = [], skipped = [];
  for (const r of body) {
    const label = (r[c.county] || '').trim(), d = lvNum(r[c.dem]), rp = lvNum(r[c.rep]);
    if (!label || /^(total|statewide|state total)/i.test(label)) { skipped.push(label); continue; }
    if (isNaN(d) || isNaN(rp)) { skipped.push(label); continue; }
    let o = c.other >= 0 ? lvNum(r[c.other]) : NaN;
    const t = c.total >= 0 ? lvNum(r[c.total]) : NaN;
    if (isNaN(o)) o = !isNaN(t) ? Math.max(0, t - d - rp) : 0;
    let pct = c.pct >= 0 ? parseFloat(String(r[c.pct]).replace(/[^\d.]/g, '')) : NaN;
    const row = { name: label, d, r: rp, o, pct: isNaN(pct) ? null : pct, dc, rc };
    const hit = idx.get(lvNorm(label));
    if (hit && hit.length === 1 && !used.has(hit[0])) { used.add(hit[0]); matched.push({ ...row, fips: hit[0] }); }
    else unmatched.push(row);
  }
  lvPrev = { matched, unmatched, po, used };
  const free = lvCounties(po).filter(r => !used.has(r.county_fips));
  prev.innerHTML = `<b>${matched.length}</b> of ${matched.length + unmatched.length} rows matched to ${STATE_NAMES[po] || po} counties` +
    (skipped.length ? ` (${skipped.length} non-county rows ignored)` : '') + '.' +
    (unmatched.length ? `<div class="small">Couldn't match these automatically; pick the county or leave blank to skip:</div><div id="lvUn">` +
      unmatched.map((u, i) => `<div class="un"><span>${esc(u.name)}</span><select data-i="${i}"><option value="">(skip)</option>${free.map(f => `<option value="${f.county_fips}">${titleCase(f.county_name)}</option>`).join('')}</select></div>`).join('') + '</div>' : '');
  lvQ('lvApply').disabled = matched.length + unmatched.length === 0;
}

async function lvApply() {
  if (!lvPrev) return;
  const po = lvPrev.po, office = lvQ('lvOffice').value, race = lvQ('lvRace').value;
  const rows = [...lvPrev.matched], seen = new Set(rows.map(r => r.fips));
  document.querySelectorAll('#lvUn select').forEach(sel => {
    const f = sel.value; if (!f || seen.has(f)) return;
    seen.add(f); rows.push({ ...lvPrev.unmatched[+sel.dataset.i], fips: f });
  });
  const name = fips => affinity.get(fips)?.county_name || fips;
  LIVE.contests[`${office}|${race}|${po}`] = {
    office, race, state_po: po, updated: Date.now(),
    rows: rows.map(r => ({ fips: r.fips, name: name(r.fips), d: r.d, r: r.r, o: r.o, pct: r.pct, dc: r.dc, rc: r.rc }))
  };
  lvSave();
  lvQ('lvText').value = ''; lvRefresh(); lvSavedList();
  lvQ('lvDlg').close();
  await lvAfterChange({ office, race });
}

function lvSavedList() {
  const cs = Object.entries(LIVE.contests);
  lvQ('lvSaved').innerHTML = cs.length ? 'Saved in this browser: ' + cs.map(([k, c]) =>
    `${STATE_NAMES[c.state_po] || c.state_po} ${c.office}${c.race === 'special' ? ' (special)' : ''}: ${c.rows.length} counties <a href="#" data-k="${k}">remove</a>`).join(' &middot; ') : '';
  lvQ('lvSaved').querySelectorAll('a').forEach(a => a.onclick = async e => {
    e.preventDefault(); const c = LIVE.contests[a.dataset.k]; delete LIVE.contests[a.dataset.k]; lvSave(); lvSavedList(); await lvAfterChange(c ? { office: c.office, race: c.race } : null);
  });
}

// refresh dropdowns/map/panel after the stored results change
async function lvAfterChange(focus) {
  for (const o of ['president', 'senate', 'house']) cache.delete(o + '|2026');
  await loadAvailable();
  for (const p of ['a', 'b']) fillYears(p);
  if (focus && liveAvailable().some(a => a.office === focus.office)) {
    $('aOffice').value = focus.office; fillYears('a'); $('aYear').value = '2026';
    if (focus.office !== 'president') $('race').value = focus.race;
  }
  await render();
  if (selectedPo && affinity) {
    const any = [...affinity.values()].find(r => r.state_po === selectedPo);
    if (any) await selectState({ id: any.county_fips }, { noZoom: true });
  }
}

function lvExport() {
  const head = 'state_po,county_fips,county_name,office,race,dem_votes,rep_votes,other_votes,dem_candidate,rep_candidate';
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lines = [];
  for (const c of Object.values(LIVE.contests)) for (const r of c.rows)
    lines.push([c.state_po, r.fips, q(r.name), c.office, c.race, r.d, r.r, r.o, q(r.dc), q(r.rc)].join(','));
  const url = URL.createObjectURL(new Blob([head + '\n' + lines.join('\n') + '\n'], { type: 'text/csv' }));
  const a = document.createElement('a'); a.href = url; a.download = 'results_2026.csv'; a.click(); URL.revokeObjectURL(url);
}

// ---- bellwether projection (shown in the state panel) ----
function projectionHtml(po) {
  const all = Object.values(LIVE.contests).filter(c => c.state_po === po);
  const cs = all.filter(c => c.office === 'senate' || c.office === 'president');
  if (!cs.length) return all.length ? `<p class="muted small">House results are loaded for this state. Projections cover Senate and President only.</p>` : '';
  return cs.map(c => lvProjectOne(po, c)).join('');
}
function lvProjectOne(po, c) {
  const minPct = LIVE.minPct ?? 70, label = `2026 ${OFFICES[c.office]}${c.race === 'special' ? ' (special)' : ''}`;
  const nState = lvCounties(po).length;
  let D = 0, R = 0, T = 0, n = 0; const ests = [];
  for (const r of c.rows) {
    const t = r.d + r.r + r.o; if (t <= 0) continue;
    D += r.d; R += r.r; T += t; n++;
    const af = affinity.get(r.fips);
    if (!af || (r.pct != null && r.pct < minPct)) continue;
    const m = (r.d - r.r) / t * 100;
    ests.push({ name: af.county_name, pct: r.pct, m, lean: +af.lean, est: m - +af.lean, w: 1 / ((+af.score + 0.5) ** 2) });
  }
  const head = `<div class="proj"><h3>${label}</h3>`;
  const foot = `<label class="small">Count a county only if at least <input type="number" id="minpct" min="0" max="100" value="${minPct}"> % reporting (used only where you entered a % reporting column)</label></div>`;
  if (T <= 0) return head + `<p class="muted">No votes entered yet.</p>` + foot;
  if (Math.min(D, R) / T < 0.10) return head + `<p class="muted">One major party has almost no votes in this contest, so a bellwether projection isn't meaningful.</p>` + foot;
  const counted = (D - R) / T * 100;
  const countedLine = `<div class="small muted">Counted so far: <b>${sgn(counted)}</b> from ${n} of ${nState} counties (${T.toLocaleString()} votes)</div>`;
  if (ests.length < 3) {
    return head + countedLine + `<p class="muted">Waiting for at least 3 bellwether counties (${ests.length} so far${ests.length < n ? '; others are below the % reporting cutoff or unscored' : ''}).</p>` + foot;
  }
  const W = ests.reduce((s, e) => s + e.w, 0), mean = ests.reduce((s, e) => s + e.w * e.est, 0) / W;
  const sd = Math.sqrt(ests.reduce((s, e) => s + e.w * (e.est - mean) ** 2, 0) / W);
  const half = Math.max(1.5, sd), lo = mean - half, hi = mean + half;
  const verdict = lo > 0 ? 'Leaning Democratic' : hi < 0 ? 'Leaning Republican' : 'Too close for the bellwethers to separate';
  const top = [...ests].sort((a, b) => b.w - a.w).slice(0, 5);
  return head + `<div class="big">${sgn(mean)}</div>
    <div class="small">Projected statewide margin, rough range ${sgn(lo)} to ${sgn(hi)}. <b>${verdict}.</b></div>` + countedLine +
    `<table class="mini"><thead><tr><th>County</th><th>Now</th><th>Usual lean</th><th>Implies</th></tr></thead><tbody>` +
    top.map(e => `<tr><td>${titleCase(e.name)}${e.pct != null ? ` <span class="muted">(${e.pct}% in)</span>` : ''}</td><td>${sgn(e.m)}</td><td>${sgn(e.lean)}</td><td><b>${sgn(e.est)}</b></td></tr>`).join('') + `</tbody></table>
    <p class="small muted">Each reporting county implies a statewide margin: its margin now minus its usual lean. ${ests.length} counties are combined, weighted toward the best bellwethers. In the 2024 hold-out test, 5 bellwethers landed within about 1.5 points on average, but early or partial counts, and which counties report first, can push it further off.</p>` + foot;
}
function bindProjection(po) {
  const el = document.getElementById('minpct');
  if (!el) return;
  el.onchange = async () => {
    LIVE.minPct = Math.max(0, Math.min(100, +el.value || 0)); lvSave();
    const any = [...affinity.values()].find(r => r.state_po === po);
    if (any) await selectState({ id: any.county_fips }, { noZoom: true });
  };
}

window.addEventListener('DOMContentLoaded', lvBuildDialog);
