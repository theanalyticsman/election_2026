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

// ---- official state feeds: 2026 rows that scripts/fetch_*.py upsert into Supabase, merged under anything pasted ----
let FEED = { contests: {}, stamp: '', updated: null };
const allContests = () => ({ ...FEED.contests, ...LIVE.contests }); // a pasted state overrides the feed for that contest
async function feedRefresh() {
  let data = [];
  try {
    for (let from = 0; ; from += 1000) {
      const { data: d, error } = await db.from('county_results').select('*').eq('year', 2026).order('county_fips').range(from, from + 999);
      if (error) throw error;
      data = data.concat(d);
      if (d.length < 1000) break;
    }
  } catch (e) { console.warn('official feed unavailable', e.message || e); return false; }
  const contests = {};
  let updated = null;
  for (const r of data) {
    if (!(r.total_votes > 0)) continue;
    const k = `${r.office}|${r.race}|${r.state_po}`;
    const c = contests[k] || (contests[k] = { office: r.office, race: r.race, state_po: r.state_po, feed: true, rows: [] });
    c.rows.push({ fips: r.county_fips, name: r.county_name, d: r.dem_votes, r: r.rep_votes, o: r.other_votes, dc: r.dem_candidate, rc: r.rep_candidate });
    if (r.updated_at && (!updated || r.updated_at > updated)) updated = r.updated_at;
  }
  const stamp = JSON.stringify(Object.values(contests).map(c => [c.office, c.race, c.state_po, c.rows.reduce((s, r) => s + r.d + r.r + r.o, 0)]));
  const changed = stamp !== FEED.stamp;
  FEED = { contests, stamp, updated };
  return changed;
}
function feedNote() {
  const st = [...new Set(Object.values(FEED.contests).map(c => c.state_po))];
  if (!st.length) return '';
  const t = FEED.updated ? new Date(FEED.updated).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
  return `Official state feed: ${st.join(', ')}${t ? ` (updated ${t})` : ''}.`;
}
// poll for new counts every minute; only redraw when something changed
setInterval(async () => { if (await feedRefresh()) await lvAfterChange(null); }, 60000);

// ---- hooks used by app.js so 2026 behaves like any other year ----
function liveAvailable() {
  return [...new Set(Object.values(allContests()).map(c => c.office))].map(office => ({ office, year: 2026 }));
}
function liveElection(office) {
  const m = new Map();
  for (const c of Object.values(allContests())) {
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
const lvNum = s => {
  const raw = String(s ?? '').trim();
  const lead = raw.match(/^(\d[\d,]*)\s*\(\s*[\d.]+%\s*\)$/) || raw.match(/^(\d[\d,]*)\s+[\d.]+%$/); // "429,916 (59.7%)" / "429,916 59.7%"
  const t = (lead ? lead[1] : raw).replace(/[,\s]/g, '');
  return /^-?\d+(\.\d+)?$/.test(t) ? +t : NaN;
};
function lvSplitCsv(l) {
  const out = []; let cur = '', q = false;
  for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur.trim()); cur = ''; } else cur += ch; }
  out.push(cur.trim()); return out;
}
function lvFallbackSplit(l) {
  const m = l.match(/^(.*?)\s+((?:[\d,.]+%?\s*)+)$/);
  return m ? [m[1].trim(), ...m[2].trim().split(/\s+/)] : [l];
}
// CNN's "Results by county" copies as one value per line: name, "Est. 100% in", then pct / votes for each candidate
function lvParseStacked(lines) {
  const isRep = l => /^(est\.?\s*)?[\d.]+%\s*(in|reporting)$/i.test(l);
  const at = lines.map((l, i) => isRep(l) ? i : -1).filter(i => i > 0);
  if (at.length < 3) return null;
  const head = lines.slice(0, at[0] - 1).reverse().find(l => l.includes('\t'));
  const names = head ? head.split('\t').map(x => x.trim()).filter(Boolean) : null;
  const out = [];
  at.forEach((i, k) => {
    const end = k + 1 < at.length ? at[k + 1] - 1 : lines.length;
    const toks = lines.slice(i + 1, end);
    const votes = [];
    for (let j = 0; j + 1 < toks.length; j += 2) { const v = lvNum(toks[j + 1]); votes.push(String(isNaN(v) ? 0 : v)); }
    out.push([lines[i - 1], lines[i].replace(/^est\.?\s*/i, '').replace(/\s*(in|reporting)$/i, ''), ...votes]);
  });
  const n = Math.max(...out.map(r => r.length - 2));
  return [['County', '% in', ...Array.from({ length: n }, (_, c) => (names && names[c]) || 'Candidate ' + (c + 1))], ...out];
}
function lvParse(text) {
  const lines = text.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const stacked = lvParseStacked(lines);
  if (stacked) return stacked;
  const tabs = lines.filter(l => l.includes('\t')).length > lines.length / 2;
  // CSV when every line splits into the same number (3+) of comma fields; thousands separators would make the counts vary
  const csvCounts = tabs ? [] : lines.map(l => lvSplitCsv(l).length);
  // a field like "916 283" means a number with thousands commas was split apart, so this is not CSV
  const splitNumber = !tabs && lines.some(l => lvSplitCsv(l).some(f => /\d\s+\d/.test(f)));
  const csvish = csvCounts.length > 0 && csvCounts[0] >= 3 && csvCounts.every(c => c === csvCounts[0]) && !splitNumber;
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
    other: find(/other|\bind\b|libert|green/i), total: find(/total/i), pct: find(/report|precinct|% in|counted|expected/i) };
  const data = rows.slice(hasHeader ? 1 : 0);
  const isText = c => data.filter(r => (r[c] || '').trim() && isNaN(lvNum(r[c])) && !/^[\d.]+%?$/.test((r[c] || '').trim())).length > data.length * 0.6;
  const named = find(/county|parish|jurisdiction|name/i);
  g.county = named >= 0 ? named : Math.max(0, [...Array(ncol).keys()].find(isText) ?? 0);
  const numeric = [...Array(ncol).keys()].filter(c => c !== g.county && data.filter(r => !isNaN(lvNum(r[c]))).length > data.length * 0.6);
  if (g.dem < 0) g.dem = numeric[0] ?? -1;
  if (g.rep < 0) g.rep = numeric.find(c => c !== g.dem) ?? -1;
  return { hasHeader, g, ncol, head };
}

// ---- county-name matching (within one state) ----
function lvNorm(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, 'and').replace(/\bsaint\b/g, 'st').replace(/\bste\.?\b/g, 'ste')
    .replace(/\b(county|parish|borough|census area|municipality|city and borough|co|cty)\b/g, '')
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
  if (Math.max(...rows.map(r => r.length)) < 3) {
    mapDiv.innerHTML = ''; mapDiv.dataset.sig = '';
    prev.innerHTML = `Couldn't split this into columns. Try selecting the table on the news site and copying it again (columns then arrive tab-separated), or use commas with <b>no thousands separators</b> (or put quotes around numbers like "429,916").`;
    return;
  }
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
    let pct = NaN;
    if (c.pct >= 0) {
      const cell = String(r[c.pct]), frac = cell.match(/(\d[\d,]*)\s*(?:of|\/)\s*(\d[\d,]*)/i);
      pct = frac ? (+frac[1].replace(/,/g, '') / +frac[2].replace(/,/g, '')) * 100 : parseFloat(cell.replace(/[^\d.]/g, ''));
      if (!isNaN(pct) && pct <= 1 && /^\s*0?\.\d+\s*$/.test(cell)) pct *= 100; // a 0-1 fraction
    }
    const row = { name: label, d, r: rp, o, pct: isNaN(pct) ? null : pct, dc, rc };
    const hit = idx.get(lvNorm(label));
    if (hit && hit.length === 1 && !used.has(hit[0])) { used.add(hit[0]); matched.push({ ...row, fips: hit[0] }); }
    else unmatched.push(row);
  }
  lvPrev = { matched, unmatched, po, used };
  const free = lvCounties(po).filter(r => !used.has(r.county_fips));
  const hdrName = i => (hdr && rows[0][i]) ? esc(rows[0][i]) : `column ${i + 1}`;
  prev.innerHTML = `Using <b>${hdrName(c.dem)}</b> as Democratic and <b>${hdrName(c.rep)}</b> as Republican (change the pickers above if that is backwards).<br><b>${matched.length}</b> of ${matched.length + unmatched.length} rows matched to ${STATE_NAMES[po] || po} counties` +
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
  lvQ('lvSaved').innerHTML = (feedNote() ? feedNote() + ' ' : '') + (cs.length ? 'Saved in this browser: ' + cs.map(([k, c]) =>
    `${STATE_NAMES[c.state_po] || c.state_po} ${c.office}${c.race === 'special' ? ' (special)' : ''}: ${c.rows.length} counties <a href="#" data-k="${k}">remove</a>`).join(' &middot; ') : '');
  lvQ('lvSaved').querySelectorAll('a').forEach(a => a.onclick = async e => {
    e.preventDefault(); const c = LIVE.contests[a.dataset.k]; delete LIVE.contests[a.dataset.k]; lvSave(); lvSavedList(); await lvAfterChange(c ? { office: c.office, race: c.race } : null);
  });
}

// refresh dropdowns/map/panel after the stored results change
async function lvAfterChange(focus) {
  for (const o of ['president', 'senate', 'house']) cache.delete(o + '|2026');
  v26 = null; // 2026 tab: back to auto (shows results vs polls once data exists)
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
  for (const c of Object.values(allContests())) for (const r of c.rows)
    lines.push([c.state_po, r.fips, q(r.name), c.office, c.race, r.d, r.r, r.o, q(r.dc), q(r.rc)].join(','));
  const url = URL.createObjectURL(new Blob([head + '\n' + lines.join('\n') + '\n'], { type: 'text/csv' }));
  const a = document.createElement('a'); a.href = url; a.download = 'results_2026.csv'; a.click(); URL.revokeObjectURL(url);
}

// ---- bellwether projection (shown in the state panel) ----
function projectionHtml(po) {
  const all = Object.values(allContests()).filter(c => c.state_po === po);
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
  const pm = (typeof pollAvg !== 'undefined' && pollAvg && c.office === 'senate') ? pollAvg.get(po + '|' + c.race) : null;
  const pollLine = pm ? ` Pre-election poll average: <b>${sgn(+pm.margin)}</b>.` : '';
  const countedLine = `<div class="small muted">Counted so far: <b>${sgn(counted)}</b> from ${n} of ${nState} counties (${T.toLocaleString()} votes).${pollLine}</div>`;
  if (ests.length < 3) {
    return head + countedLine + `<p class="muted">Waiting for at least 3 bellwether counties (${ests.length} so far${ests.length < n ? '; others are below the % reporting cutoff or unscored' : ''}).</p>` + foot;
  }
  const W = ests.reduce((s, e) => s + e.w, 0), mean = ests.reduce((s, e) => s + e.w * e.est, 0) / W;
  const sd = Math.sqrt(ests.reduce((s, e) => s + e.w * (e.est - mean) ** 2, 0) / W);
  const half = Math.max(1.5, sd), lo = mean - half, hi = mean + half;
  const verdict = lo > 0 ? 'Leaning Democratic' : hi < 0 ? 'Leaning Republican' : 'Too close for the bellwethers to separate';
  const top = [...ests].sort((a, b) => b.w - a.w).slice(0, 5);
  return head + `<div class="big">${sgn(mean)}</div>
    <div class="small">Projected statewide margin, rough range ${sgn(lo)} to ${sgn(hi)}. <b>${verdict}.</b>${pm ? ` Poll average was ${sgn(+pm.margin)}, so this projection is ${Math.abs(mean - +pm.margin).toFixed(1)} pts ${mean >= +pm.margin ? 'more Democratic' : 'more Republican'}.` : ''}</div>` + countedLine +
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
