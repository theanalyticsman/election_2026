const db = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
const $ = id => document.getElementById(id);
const OFFICES = { president: 'President', senate: 'Senate', house: 'House' };
const cache = new Map(); // "office|year" -> Map(fips -> row[])
let counties, mode = 'poll', available = [], v26 = null; // v26: null = auto, 'model' or 'vs' (2026 tab)

// ---- data ----
async function loadAvailable() {
  const { data, error } = await db.from('county_result_elections').select('office,year').order('year');
  if (error) throw error;
  const seen = new Set();
  data.forEach(r => seen.add(r.office + '|' + r.year));
  if (typeof liveAvailable === 'function') liveAvailable().forEach(a => seen.add(a.office + '|' + a.year));
  available = [...seen].map(s => { const [o, y] = s.split('|'); return { office: o, year: +y }; });
}

async function loadElection(office, year) {
  const key = office + '|' + year;
  if (year === 2026 && typeof liveElection === 'function') return liveElection(office);
  if (cache.has(key)) return cache.get(key);
  const byFips = new Map();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('county_results').select('*')
      .eq('office', office).eq('year', year).order('county_fips').order('race').range(from, from + 999);
    if (error) throw error;
    data.forEach(r => { (byFips.get(r.county_fips) || byFips.set(r.county_fips, []).get(r.county_fips)).push(r); });
    if (data.length < 1000) break;
  }
  cache.set(key, byFips);
  return byFips;
}

// Pick the row for a county matching the chosen race (regular/special); President is always 'regular'
function pick(rows, race) {
  return rows ? rows.find(r => r.race === race) || null : null;
}
const margin = r => (r && r.total_votes > 0) ? (r.dem_votes - r.rep_votes) / r.total_votes * 100 : null;

// ---- UI ----
function fillSelects() {
  for (const p of ['a', 'b']) {
    const off = $(p + 'Office');
    off.innerHTML = Object.entries(OFFICES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
    off.onchange = () => { fillYears(p); render(); };
    fillYears(p);
    $(p + 'Year').onchange = render;
  }
  $('bYear').value = $('aYear').options[Math.max(0, $('aYear').options.length - 2)]?.value;
  $('race').onchange = render;
  $('baseSel').onchange = render;
  $('v26model').onclick = () => { v26 = 'model'; render(); };
  $('v26vs').onclick = () => { v26 = 'vs'; render(); };
  document.querySelectorAll('#mode button[data-m]').forEach(b => b.onclick = () => {
    mode = b.dataset.m;
    document.querySelectorAll('#mode button').forEach(x => x.classList.toggle('on', x === b));
    $('bGrp').style.display = mode === 'swing' ? '' : 'none';
    $('aGrp').style.display = (mode === 'affinity' || mode === 'poll') ? 'none' : '';
    $('baseGrp').style.display = mode === 'perf' ? '' : 'none';
    $('v26Grp').style.display = mode === 'poll' ? '' : 'none';
    if (mode === 'affinity' || mode === 'poll') $('raceGrp').style.display = 'none';
    $('aLabel').textContent = mode === 'swing' ? 'Election A' : 'Election';
    render();
  });
}
function fillYears(p) {
  const off = $(p + 'Office').value;
  const years = [...new Set(available.filter(a => a.office === off).map(a => a.year))];
  const sel = $(p + 'Year'), cur = sel.value;
  sel.innerHTML = years.map(y => `<option>${y}</option>`).join('');
  if (years.includes(+cur)) sel.value = cur; else sel.value = years[years.length - 1];
}

// ---- map ----
const svg = d3.select('#map');
const path = d3.geoPath();
const colorResult = d3.scaleDiverging(t => d3.interpolateRdBu(t)).domain([-60, 0, 60]).clamp(true); // RdBu runs red to blue: low = R, high = D
const colorSwing = d3.scaleDiverging(t => d3.interpolateRdBu(t)).domain([-25, 0, 25]).clamp(true);   // blue = shift to D

async function init() {
  const us = await d3.json('https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/counties-albers-10m.json');
  // Alaska reports by state House district, so its boroughs are replaced by district shapes (2013 plan for
  // 2016-2020, 2021 plan for 2022+). Lon/lat shapes are projected to match the atlas's Albers USA inset.
  const proj = d3.geoAlbersUsa().scale(1300).translate([487.5, 305]);
  const akPath = d3.geoPath(proj);
  const akFeatures = [];
  for (const plan of ['ak13', 'ak22']) {
    const g = await d3.json(`${plan}_districts.json`);
    g.features.forEach(f => { f.id = f.properties.GEOID; f.properties.name = f.properties.NAMELSAD; f.plan = plan; akFeatures.push(f); });
  }
  counties = topojson.feature(us, us.objects.counties).features.filter(f => !f.id.startsWith('02')).concat(akFeatures);
  const view = svg.append('g').attr('id', 'view');
  view.append('g').attr('id', 'cg').selectAll('path').data(counties).join('path')
    .attr('class', 'county').attr('d', d => d.plan ? akPath(d) : path(d)).style('fill', 'var(--nodata)')
    .on('mousemove', (e, d) => showTip(e, d)).on('mouseleave', () => $('tip').style.display = 'none')
    .on('click', (e, d) => selectState(d));
  view.append('path').attr('class', 'state').attr('d', path(topojson.mesh(us, us.objects.states)));
  view.append('path').attr('id', 'cdLines').attr('class', 'cd');

  // zoom/pan: lines use non-scaling strokes (see CSS) so county and state borders stay crisp at any zoom
  const zoom = d3.zoom().scaleExtent([1, 40]).translateExtent([[0, 0], [975, 610]])
    .on('zoom', e => view.attr('transform', e.transform));
  zoomB = zoom;
  svg.call(zoom).on('dblclick.zoom', null);
  svg.on('click', e => { if (e.target === svg.node()) clearSel(); });
  addEventListener('keydown', e => { if (e.key === 'Escape') clearSel(); });
  $('zin').onclick = () => svg.transition().duration(250).call(zoom.scaleBy, 1.8);
  $('zout').onclick = () => svg.transition().duration(250).call(zoom.scaleBy, 1 / 1.8);
  $('zreset').onclick = () => svg.transition().duration(350).call(zoom.transform, d3.zoomIdentity);
  if (typeof feedRefresh === 'function') await feedRefresh();
  await loadAvailable();
  fillSelects();
  document.querySelector('#mode button[data-m="poll"]').click(); // land on the 2026 tab
}

const planOf = year => year <= 2020 ? 'ak13' : 'ak22';
let cur = {};
async function render() {
  $('status').textContent = 'Loading…';
  updateCdLines();
  if (mode === 'affinity') return renderAffinity();
  if (mode === 'poll') return renderPoll();
  const race = $('race').value;
  const aOff = $('aOffice').value, aYear = +$('aYear').value;
  const isRace = o => o === 'senate' || o === 'house';
  $('raceGrp').style.display = (isRace(aOff) || (mode === 'swing' && isRace($('bOffice').value))) ? '' : 'none';
  const A = await loadElection(aOff, aYear);
  if (mode === 'perf') return renderPerf(A, race, aOff, aYear);
  let B = null, bOff, bYear;
  if (mode === 'swing') { bOff = $('bOffice').value; bYear = +$('bYear').value; B = await loadElection(bOff, bYear); }
  cur = { A, B, race, aOff, aYear, bOff, bYear };
  let have = 0;
  const plan = planOf(aYear), samePlan = mode !== 'swing' || planOf(aYear) === planOf(bYear);
  svg.selectAll('path.county').style('display', d => (d.plan && d.plan !== plan) ? 'none' : null).style('fill', d => {
    const id = d.id;
    if (d.plan && (d.plan !== plan || !samePlan)) return 'var(--nodata)';
    const a = pick(A.get(id), race), ma = margin(a);
    if (mode === 'result') { if (ma == null) return 'var(--nodata)'; have++; return colorResult(ma); }
    const mb = margin(pick(B.get(id), race));
    if (ma == null || mb == null) return 'var(--nodata)';
    have++; return colorSwing(mb - ma);
  });
  drawLegend();
  const label = mode === 'result' ? `${aYear} ${OFFICES[aOff]}` : `${aYear} ${OFFICES[aOff]} → ${bYear} ${OFFICES[bOff]} swing`;
  $('status').textContent = `${label}: ${have.toLocaleString()} counties with data` + (aOff === 'senate' || bOff === 'senate' ? ' (Senate shows only states with a race that year)' : '') + (aOff === 'house' || bOff === 'house' ? ' (House totals sum all districts in a county; uncontested seats count 0 for the missing party)' : '') + '; Alaska is shown by state House district';
}

// ---- affinity: how closely each county tracks its state (lower score = closer) ----
let affinity = null, zoomB = null, selectedPo = null;
async function ensureAffinity() {
  if (affinity) return;
  const m = new Map();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('county_affinity').select('*').order('county_fips').range(from, from + 999);
    if (error) throw error;
    data.forEach(r => m.set(r.county_fips, r));
    if (data.length < 1000) break;
  }
  affinity = m;
  for (const r of m.values()) fipsToPo[r.county_fips.slice(0, 2)] = r.state_po;
}
const colorAff = d3.scaleSequential(t => d3.interpolateYlGnBu(1 - t)).domain([0, 30]).clamp(true);
// ---- congressional district lines: drawn over the counties when viewing House results ----
// map file by election year: 116th Congress maps for 2016-2020, 119th for 2022-2024, 120th (post mid-decade redistricting) for 2026
const cdProj = d3.geoAlbersUsa().scale(1300).translate([487.5, 305]), cdGeo = d3.geoPath(cdProj), cdCache = new Map();
const cdFile = y => y >= 2026 ? 'cd120' : y >= 2022 ? 'cd119' : 'cd116';
const cdLabel = { cd116: '116th Congress maps (used for 2018 and 2020; 2016 had a few differences)', cd119: '119th Congress maps (2024; a few states used older maps in 2022)', cd120: '120th Congress maps (2026, including mid-decade redistricting)' };
async function updateCdLines() {
  const note = $('cdnote'), line = svg.select('#cdLines');
  const want = (mode === 'result' && $('aOffice').value === 'house') ? cdFile(+$('aYear').value) : null;
  if (!want) { line.attr('d', null); note.textContent = ''; return; }
  if (!cdCache.has(want)) {
    try { cdCache.set(want, cdGeo(await d3.json(want + '.json'))); } catch (e) { console.warn('district lines unavailable', e); return; }
  }
  if (mode === 'result' && $('aOffice').value === 'house' && cdFile(+$('aYear').value) === want) {
    line.attr('d', cdCache.get(want));
    note.textContent = 'Dashed lines: congressional districts, ' + cdLabel[want] + '. House results are summed by county, so a county split between districts shows one combined colour.';
  }
}

async function renderAffinity() {
  await ensureAffinity();
  cur = { affinity: true };
  let have = 0;
  svg.selectAll('path.county').style('display', d => (d.plan === 'ak13') ? 'none' : null).style('fill', d => {
    const r = d.plan ? null : affinity.get(d.id);
    if (!r) return 'var(--nodata)';
    have++; return colorAff(+r.score);
  });
  const stops = d3.range(0, 1.001, .1).map(t => colorAff(t * 30));
  $('legend').innerHTML = `<span>Tracks state (0 pts)</span><span class="bar" style="background:linear-gradient(90deg,${stops.join(',')})"></span><span>30+ pts off</span>`;
  $('status').textContent = `Affinity: ${have.toLocaleString()} counties scored vs. their state (President + Senate 2020/2022/2024, weights 1:2:4; Alaska excluded). Hover for details.`;
}

function drawLegend() {
  const sc = mode === 'result' ? colorResult : colorSwing, lim = sc.domain()[2];
  const stops = d3.range(0, 1.001, .1).map(t => sc(-lim + t * 2 * lim));
  const lo = mode === 'result' ? `R +${lim}` : `Shift R ${lim}`, hi = mode === 'result' ? `D +${lim}` : `Shift D ${lim}`;
  $('legend').innerHTML = `<span>${lo}</span><span class="bar" style="background:linear-gradient(90deg,${stops.join(',')})"></span><span>${hi}</span><span>(margin, points)</span>`;
}

const fmt = d3.format(',');
const sgn = v => (v >= 0 ? 'D +' : 'R +') + Math.abs(v).toFixed(1);
function line(r, title) {
  if (!r) return `<tr><td colspan="3" style="color:var(--muted)">${title}: no data</td></tr>`;
  const m = margin(r), T = r.total_votes || 1;
  const pct = v => (v / T * 100).toFixed(1) + '%';
  const row = (color, name, v) => `<tr><td style="color:${color}">${name}</td><td class="pct">${pct(v)}</td><td class="votes">${fmt(v)}</td></tr>`;
  return `<tr><td colspan="3"><b style="margin:4px 0 2px">${title}: ${sgn(m)}</b></td></tr>`
    + row('#5b8fe0', r.dem_candidate || 'Democrat', r.dem_votes)
    + row('#e0675a', r.rep_candidate || 'Republican', r.rep_votes)
    + row('inherit', 'Other', r.other_votes);
}
function showAffTip(e, d) {
  const r = d.plan ? null : affinity.get(d.id);
  const t = $('tip');
  t.innerHTML = r ? `<b>${d.properties.name} County, ${r.state_po}</b><table>
    <tr><td>Affinity score</td><td>${(+r.score).toFixed(1)} pts</td></tr>
    <tr><td>Rank in state</td><td>#${r.rank_in_state}</td></tr>
    <tr><td>Avg margin gap</td><td>${(+r.gap_score).toFixed(1)} pts</td></tr>
    <tr><td>Lean vs state</td><td>${(+r.lean >= 0 ? 'D +' : 'R +') + Math.abs(+r.lean).toFixed(1)}</td></tr>
    <tr><td>Swing tracking error</td><td>${r.swing_err == null ? 'n/a' : (+r.swing_err).toFixed(1) + ' pts'}</td></tr>
    <tr><td>Share of state vote</td><td>${(r.state_vote_share * 100).toFixed(1)}%</td></tr></table>`
    : `<b>${d.properties.name}</b><br><span style="color:var(--muted)">No affinity score</span>`;
  t.style.display = 'block';
  t.style.left = Math.min(e.clientX + 14, innerWidth - 240) + 'px';
  t.style.top = Math.min(e.clientY + 14, innerHeight - t.offsetHeight - 8) + 'px';
}
function showTip(e, d) {
  if (cur.affinity) return showAffTip(e, d);
  if (cur.perf) return showPerfTip(e, d);
  if (cur.poll) return showPollTip(e, d);
  const id = d.id, a = pick(cur.A.get(id), cur.race);
  let html = `<b>${d.plan ? d.properties.name + ' (Alaska)' : d.properties.name + ' County, FIPS ' + id}</b><table>` + line(a, `${cur.aYear} ${OFFICES[cur.aOff]}`);
  if (cur.B) {
    const b = pick(cur.B.get(id), cur.race);
    html += line(b, `${cur.bYear} ${OFFICES[cur.bOff]}`);
    const ma = margin(a), mb = margin(b);
    if (ma != null && mb != null) html += `<tr><td colspan="3"><b>Swing: ${sgn(mb - ma)}</b></td></tr>`;
  }
  const t = $('tip'); t.innerHTML = html + '</table>'; t.style.display = 'block';
  t.style.left = Math.min(e.clientX + 14, innerWidth - 240) + 'px';
  t.style.top = Math.min(e.clientY + 14, innerHeight - t.offsetHeight - 8) + 'px';
}

init().catch(err => { $('status').textContent = 'Error: ' + (err.message || err); console.error(err); });

// ---- state panel: top 10 bellwether counties for the clicked state ----
const STATE_NAMES = {AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'District of Columbia',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming'};
let fipsToPo = { '02': 'AK', '11': 'DC' };
const poOf = d => fipsToPo[d.id.slice(0, 2)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const titleCase = s => esc(s).toLowerCase().replace(/(^|[\s-])\w/g, m => m.toUpperCase());

async function selectState(d, opts = {}) {
  await Promise.all([ensureAffinity(), ensurePolls()]);
  for (const r of affinity.values()) fipsToPo[r.county_fips.slice(0, 2)] = r.state_po;
  const po = poOf(d);
  if (!po) return;
  selectedPo = po;
  svg.classed('hasSel', true);
  svg.selectAll('path.county').classed('sel', x => poOf(x) === po);
  const rows = [...affinity.values()].filter(r => r.state_po === po).sort((x, y) => x.rank_in_state - y.rank_in_state);
  const p = $('panel');
  const name = STATE_NAMES[po] || po;
  if (!rows.length) {
    p.innerHTML = `<button id="pclose" aria-label="Close">&times;</button><h2>${name}</h2>
      <p class="muted">No affinity scores for ${name}${po === 'AK' ? ': its state House districts were redrawn in 2022, so there is no stable county-level history to compare.' : '.'}</p>`;
  } else {
    const near = rows.filter(r => +r.score <= 3).length;
    p.innerHTML = `<button id="pclose" aria-label="Close">&times;</button><h2>${name}</h2>
      <p class="muted">${rows.length} counties scored. ${near} within 3 pts of the state. Lower score = tracks the state's result more closely.</p>
      ${pollHtml(po)}
      ${typeof projectionHtml === 'function' ? projectionHtml(po) : ''}
      <table><thead><tr><th>#</th><th>County</th><th title="Weighted gap + swing error, points">Score</th><th title="Positive = more Democratic than the state">Lean</th><th title="Share of the statewide vote">Vote</th></tr></thead><tbody>` +
      rows.slice(0, 10).map(r => `<tr data-f="${r.county_fips}"><td>${r.rank_in_state}</td><td>${titleCase(r.county_name)}</td><td>${(+r.score).toFixed(1)}</td>
        <td class="${+r.lean >= 0 ? 'd' : 'r'}">${(+r.lean >= 0 ? 'D+' : 'R+') + Math.abs(+r.lean).toFixed(1)}</td><td>${(r.state_vote_share * 100).toFixed(1)}%</td></tr>`).join('') +
      `</tbody></table>
      <details class="how" open><summary>How to read this</summary>
        <ul>
          <li><b>Score</b>: how far, in points, a county's vote margin typically sits from the state's, blended with how closely its swing between elections follows the state's. <b>Lower = better bellwether.</b></li>
          <li><b>Lean</b>: which way the county usually differs from the state. <span class="d">D+2</span> means about 2 points more Democratic than the state; <span class="r">R+2</span> more Republican.</li>
          <li><b>Vote</b>: the county's share of the state's total votes. Small counties are noisier; large ones move the state.</li>
        </ul>
        ${(() => { const a = rows[0], b = rows[Math.min(9, rows.length - 1)], lean = r => (+r.lean >= 0 ? 'Democratic' : 'Republican');
          return `<p><b>Example:</b> ${titleCase(a.county_name)} (#1) scores ${(+a.score).toFixed(1)}, so its margin usually lands within about ${(+a.score).toFixed(1)} pts of ${name}'s overall result, and it runs ${Math.abs(+a.lean).toFixed(1)} pts more ${lean(a)} than the state. ${rows.length > 9 ? `${titleCase(b.county_name)} (#${b.rank_in_state}) scores ${(+b.score).toFixed(1)}: it runs about ${Math.abs(+b.lean).toFixed(1)} pts more ${lean(b)} than ${name}, so it is a weaker stand-in.` : ''}</p>`; })()}
        <p class="small">Based on President + Senate 2020, 2022 and 2024, weighted 1:2:4 so 2024 counts most. Hover a row to find the county on the map.</p>
      </details>`;
    p.querySelectorAll('tbody tr').forEach(tr => {
      // dim the rest of the state to ~30% and bring the hovered county to the front with a bold outline
      tr.onmouseenter = () => {
        svg.classed('hasHl', true);
        svg.selectAll('path.county').classed('hl', x => x.id === tr.dataset.f && !x.plan).filter('.hl').raise();
      };
      tr.onmouseleave = () => {
        svg.classed('hasHl', false);
        svg.selectAll('path.county').classed('hl', false);
        svg.select('#cg').selectAll('path.county').order();
      };
    });
  }
  p.hidden = false;
  $('pclose').onclick = clearSel;
  if (typeof bindProjection === 'function') bindProjection(po);
  if (!opts.noZoom) zoomToState(po);
}

function zoomToState(po) {
  const fs = counties.filter(x => !x.plan && poOf(x) === po);
  if (!fs.length || !zoomB) return;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  fs.forEach(f => { const [[a, b], [c, e]] = path.bounds(f); x0 = Math.min(x0, a); y0 = Math.min(y0, b); x1 = Math.max(x1, c); y1 = Math.max(y1, e); });
  // keep the state in the left ~60% so the panel does not cover it
  const k = Math.min(8, 0.8 / Math.max((x1 - x0) / 975, (y1 - y0) / 610));
  const tx = 975 * (innerWidth <= 700 ? 0.5 : 0.36) - k * (x0 + x1) / 2, ty = 610 / 2 - k * (y0 + y1) / 2;
  svg.transition().duration(500).call(zoomB.transform, d3.zoomIdentity.translate(tx, ty).scale(k));
}

// phones: tapping the panel title folds the panel down to its title so the map is visible
document.addEventListener('click', e => { const h = e.target.closest('#panel h2'); if (h && innerWidth <= 700) $('panel').classList.toggle('min'); });

function clearSel() {
  selectedPo = null;
  $('panel').hidden = true; $('panel').classList.remove('min');
  svg.classed('hasSel', false);
  svg.selectAll('path.county').classed('sel', false).classed('hl', false);
  if (zoomB) svg.transition().duration(350).call(zoomB.transform, d3.zoomIdentity);
}

// ---- vs expected: is a county running more Democratic/Republican than its usual relationship to the state? ----
// expected margin = this contest's statewide margin + the county's historical lean (from county_affinity)
// performance     = actual margin - expected margin   (+ = more Democratic than expected)
const colorPerf = d3.scaleDiverging(t => d3.interpolateRdBu(t)).domain([-15, 0, 15]).clamp(true);
function perfInfo(d) {
  if (d.plan || !cur.stM) return null;
  const r = pick(cur.A.get(d.id), cur.race), af = affinity.get(d.id);
  if (!r || !af || !(r.total_votes > 0)) return null;
  const sm = cur.stM(af.state_po);
  if (sm == null) return null;
  const actual = margin(r), expected = sm + +af.lean;
  return { r, af, sm, actual, expected, perf: actual - expected };
}
async function renderPerf(A, race, aOff, aYear) {
  await ensureAffinity();
  const st = {};
  for (const [f, rows] of A) {
    const r = pick(rows, race), po = fipsToPo[f.slice(0, 2)];
    if (!r || !po || !(r.total_votes > 0)) continue;
    const s = st[po] || (st[po] = [0, 0, 0]);
    s[0] += r.dem_votes; s[1] += r.rep_votes; s[2] += r.total_votes;
  }
  // a contest where one major party has almost no votes (no candidate, or a strong independent) gives no meaningful expectation
  const valid = po => st[po] && Math.min(st[po][0], st[po][1]) / st[po][2] >= 0.10;
  await ensurePolls();
  const usePoll = $('baseSel').value === 'poll' && aOff === 'senate' && aYear === 2026;
  const counted = po => valid(po) ? (st[po][0] - st[po][1]) / st[po][2] * 100 : null;
  cur = { perf: true, A, race, aOff, aYear, usePoll, stM: po => { const p = usePoll && pollAvg.get(po + '|' + race); return p ? +p.margin : (usePoll ? null : counted(po)); } };
  let have = 0;
  svg.selectAll('path.county').style('display', d => (d.plan === 'ak13') ? 'none' : null).style('fill', d => {
    const i = perfInfo(d);
    if (!i) return 'var(--nodata)';
    have++; return colorPerf(i.perf);
  });
  const stops = d3.range(0, 1.001, .1).map(t => colorPerf(-15 + t * 30));
  $('legend').innerHTML = `<span>More R than expected</span><span class="bar" style="background:linear-gradient(90deg,${stops.join(',')})"></span><span>More D than expected</span><span>(points)</span>`;
  const inSample = aYear >= 2020 && aYear <= 2024 && (aOff === 'president' || aOff === 'senate');
  $('status').textContent = `${aYear} ${OFFICES[aOff]} vs expected: ${have.toLocaleString()} counties. Expected = the state's margin in this contest plus the county's usual lean; ${usePoll ? 'the state margin is the poll average (grey = state has no poll average).' : 'the state margin uses only the counties loaded.'}`
    + (inSample ? ' (2020-2024 are the years the scores were built from, so large surprises are rare here; this view is meant for 2026.)' : '');
}
function showPerfTip(e, d) {
  const i = perfInfo(d), t = $('tip');
  const sgn2 = v => (v >= 0 ? 'D +' : 'R +') + Math.abs(v).toFixed(1);
  t.innerHTML = i ? `<b>${d.properties.name} County, ${i.af.state_po}</b><table>
    <tr><td colspan="3"><b style="margin:4px 0 2px">${i.perf >= 0 ? 'More Democratic' : 'More Republican'} than expected by ${Math.abs(i.perf).toFixed(1)} pts</b></td></tr>
    <tr><td>Actual margin</td><td class="pct">${sgn2(i.actual)}</td><td></td></tr>
    <tr><td>State margin</td><td class="pct">${sgn2(i.sm)}</td><td></td></tr>
    <tr><td>Usual lean vs state</td><td class="pct">${sgn2(+i.af.lean)}</td><td></td></tr>
    <tr><td>Expected margin</td><td class="pct">${sgn2(i.expected)}</td><td></td></tr></table>`
    : `<b>${d.properties.name}</b><br><span style="color:var(--muted)">No expectation available (no scores or no result)</span>`;
  t.style.display = 'block';
  t.style.left = Math.min(e.clientX + 14, innerWidth - 260) + 'px';
  t.style.top = Math.min(e.clientY + 14, innerHeight - t.offsetHeight - 8) + 'px';
}

// ---- poll forecast: statewide poll average + each county's usual lean = expected county margin ----
let pollAvg = null, pollByState = null;
async function ensurePolls() {
  if (pollAvg) return;
  pollAvg = new Map(); pollByState = new Map();
  const { data, error } = await db.from('poll_averages').select('*');
  if (error) { console.warn('poll_averages unavailable', error.message); return; }
  data.forEach(p => { pollAvg.set(p.state_po + '|' + p.race, p); pollByState.set(p.state_po, p); });
}
function pollExpected(d) {
  if (d.plan || !pollByState) return null;
  const af = affinity.get(d.id), p = af && pollByState.get(af.state_po);
  return p ? { af, p, expected: +p.margin + +af.lean } : null;
}
// ---- the 2026 tab: the polling model until results are added, then results against the polling expectation ----
function liveSenateRows() {
  const m = new Map(), states = new Set();
  if (typeof LIVE === 'undefined') return { m, states };
  const cs = Object.values(allContests()).filter(c => c.office === 'senate');
  // apply each state's race that matches its poll last, so it wins if both regular and special rows were pasted
  const match = c => (pollByState && pollByState.get(c.state_po) && pollByState.get(c.state_po).race === c.race) ? 1 : 0;
  cs.sort((a, b) => match(a) - match(b));
  for (const c of cs) { states.add(c.state_po); for (const r of c.rows) m.set(r.fips, { d: r.d, r: r.r, o: r.o, state: c.state_po }); }
  return { m, states };
}
// example scenario for the 'vs polls' view before real results exist: every county misses the poll by one shared amount plus a fixed bit of county noise
let demoShift = 3;
const demoNoise = id => { const u = Math.sin(+id * 12.9898) * 43758.5453; return ((u - Math.floor(u)) - 0.5) * 6; };
const demoDiff = d => demoShift + demoNoise(d.id);
async function renderPoll() {
  await Promise.all([ensureAffinity(), ensurePolls()]);
  const { m: live, states } = liveSenateRows();
  const hasData = states.size > 0;
  const view = hasData && v26 !== 'model' ? 'vs' : (v26 === 'vs' ? 'demo' : 'model');
  $('v26model').classList.toggle('on', view === 'model');
  $('v26vs').classList.toggle('on', view !== 'model');
  $('v26vs').textContent = hasData ? `Actual vs polls (${states.size} state${states.size === 1 ? '' : 's'})` : 'Actual vs polls (example)';
  cur = { poll: true, view, live };
  let have = 0;
  svg.selectAll('path.county').style('display', d => (d.plan === 'ak13') ? 'none' : null).style('fill', d => {
    const e = pollExpected(d);
    if (!e) return 'var(--nodata)';
    if (view === 'model') { have++; return colorResult(e.expected); }
    if (view === 'demo') { have++; return colorPerf(demoDiff(d)); }
    const r = live.get(d.id), t = r ? r.d + r.r + r.o : 0;
    if (!(t > 0)) return 'var(--nodata)';
    have++; return colorPerf((r.d - r.r) / t * 100 - e.expected);
  });
  if (view === 'model') {
    const stops = d3.range(0, 1.001, .1).map(t => colorResult(-60 + t * 120));
    $('legend').innerHTML = `<span>R +60</span><span class="bar" style="background:linear-gradient(90deg,${stops.join(',')})"></span><span>D +60</span><span>(expected margin, points)</span>`;
    $('status').textContent = `Polling model: 2026 Senate polling average + each county's usual lean = expected margin. ${have.toLocaleString()} counties in ${pollByState ? pollByState.size : 0} polled states; grey = no poll average. Add results (+ Add 2026 results) to compare them with this. Expect a typical miss of about 5 points, mostly from the poll itself.`;
  } else if (view === 'demo') {
    const stops = d3.range(0, 1.001, .1).map(t => colorPerf(-15 + t * 30));
    $('legend').innerHTML = `<span>More R than polls imply</span><span class="bar" style="background:linear-gradient(90deg,${stops.join(',')})"></span><span>More D than polls imply</span><span>(points)</span>`;
    const lab = demoShift === 0 ? 'exactly as polled' : `${Math.abs(demoShift)} pts more ${demoShift > 0 ? 'Democratic' : 'Republican'} than polled`;
    $('status').innerHTML = `<b>EXAMPLE ONLY, not real results.</b> No 2026 results are in yet, so this shows how the view will look: every state comes in <b id="demoLab">${lab}</b>, plus some random county-to-county variation. <input id="demoRng" type="range" min="-10" max="10" step="1" value="${demoShift}" style="vertical-align:middle;width:160px"> Real results (pasted or from the state feeds) replace this automatically.`;
    $('demoRng').oninput = e => { demoShift = +e.target.value; renderPoll(); };
  } else {
    const stops = d3.range(0, 1.001, .1).map(t => colorPerf(-15 + t * 30));
    $('legend').innerHTML = `<span>More R than polls imply</span><span class="bar" style="background:linear-gradient(90deg,${stops.join(',')})"></span><span>More D than polls imply</span><span>(points)</span>`;
    $('status').textContent = `2026 Senate results vs. the polling expectation (poll average + the county's usual lean): ${have.toLocaleString()} counties with results in ${states.size} state${states.size === 1 ? '' : 's'}. Blue = more Democratic than the polls imply, red = more Republican. States without results stay grey; switch to Poll model to see the forecast everywhere. ${typeof feedNote === 'function' ? feedNote() : ''}`;
  }
}
function showPollTip(e, d) {
  const x = pollExpected(d), t = $('tip');
  const sgn2 = v => (v >= 0 ? 'D +' : 'R +') + Math.abs(v).toFixed(1);
  if (!x) { t.innerHTML = `<b>${d.properties.name}</b><br><span style="color:var(--muted)">No poll forecast (no poll average for this state)</span>`; }
  else {
    const r = cur.live && cur.live.get(d.id), tot = r ? r.d + r.r + r.o : 0;
    const miss = Math.sqrt(Number(x.p.err) ** 2 + 2.5 ** 2);
    let head, actualRow = '';
    if (cur.view === 'demo') {
      const diff = demoDiff(d);
      head = `Example only: ${diff >= 0 ? 'more Democratic' : 'more Republican'} than the polls imply by ${Math.abs(diff).toFixed(1)} pts`;
    } else if (cur.view === 'vs' && tot > 0) {
      const actual = (r.d - r.r) / tot * 100, diff = actual - x.expected;
      head = `${diff >= 0 ? 'More Democratic' : 'More Republican'} than the polls imply by ${Math.abs(diff).toFixed(1)} pts`;
      actualRow = `<tr><td>Actual margin</td><td class="pct">${sgn2(actual)}</td><td></td></tr>`;
    } else {
      head = `Expected margin: ${sgn2(x.expected)} (about &plusmn;${miss.toFixed(0)})${cur.view === 'vs' ? ', no results yet' : ''}`;
    }
    t.innerHTML = `<b>${d.properties.name} County, ${x.af.state_po}</b><table>
      <tr><td colspan="3"><b style="margin:4px 0 2px">${head}</b></td></tr>${actualRow}
      ${actualRow ? `<tr><td>Polls imply</td><td class="pct">${sgn2(x.expected)}</td><td></td></tr>` : ''}
      <tr><td>State poll average</td><td class="pct">${sgn2(+x.p.margin)}</td><td></td></tr>
      <tr><td>Usual lean vs state</td><td class="pct">${sgn2(+x.af.lean)}</td><td></td></tr>
      <tr><td colspan="3" style="color:var(--muted);font-size:12px">${x.p.n_polls} polls, latest ${x.p.last_poll}</td></tr></table>`;
  }
  t.style.display = 'block';
  t.style.left = Math.min(e.clientX + 14, innerWidth - 260) + 'px';
  t.style.top = Math.min(e.clientY + 14, innerHeight - t.offsetHeight - 8) + 'px';
}
function pollHtml(po) {
  const p = pollByState && pollByState.get(po);
  if (!p) return '';
  const thin = p.n_polls < 3 || (Date.now() - Date.parse(p.last_poll)) / 864e5 > 21;
  return `<div class="proj"><h3>Poll average: 2026 ${OFFICES[p.office]}${p.race === 'special' ? ' (special)' : ''}</h3>
    <div class="big">${sgn(+p.margin)}</div>
    <div class="small">D ${(+p.dem_pct).toFixed(0)} &middot; R ${(+p.rep_pct).toFixed(0)} of decided voters, from ${p.n_polls} polls, latest ${p.last_poll}. Typical miss about &plusmn;${(+p.err).toFixed(0)} points.</div>
    ${thin ? '<div class="small muted">Thin polling: fewer than 3 polls, or none in the last 3 weeks.</div>' : ''}
    <div class="small muted">The 2026 tab shows each county's expected margin (this average plus the county's usual lean).</div></div>`;
}
