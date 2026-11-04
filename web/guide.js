// "Guide" tab: instructions and background, shown over the map. Static content; no data access.
(() => {
  const html = `
<article>
  <button type="button" class="gclose" aria-label="Close guide">&times;</button>
  <h1>Guide</h1>
  <p class="lead">A county-level map of President, Senate and House results, built to compare 2016&ndash;2024 and to check 2026 against history. This page explains how to use it and where the numbers come from.</p>

  <h2>Quick start for election night</h2>
  <ol>
    <li><b>Start on the 2026 tab:</b> before any results are in it shows the polling model. When you add county results it switches to showing where counties are running ahead of or behind the polls.</li>
    <li><b>Prepare:</b> open <b>Affinity</b> and click a state. The panel lists the 10 counties that best mirror that state: the ones to watch.</li>
    <li><b>Enter results:</b> click <b>+ Add 2026 results</b>, choose the state and contest, and paste a county table from NYT, CNN or a state site. Check the column guesses, then <b>Add to map</b>.</li>
    <li><b>Read the state:</b> click the state again. The box at the top of the panel shows a projected statewide margin built from the counties already in, next to what has actually been counted.</li>
    <li><b>Spot surprises:</b> on the 2026 tab, <b>Actual vs polls</b> shows which counties are running ahead or behind what the polls imply.</li>
    <li><b>Update:</b> re-paste a state whenever numbers change. It replaces that state's earlier rows.</li>
  </ol>

  <h2>The views</h2>
  <table class="g">
    <tr><th>Historical</th><td>Each county coloured by margin: red is Republican, blue is Democratic, white is even. The colours saturate at 60 points. Pick office, year, and (for Senate or House) regular or special races. Hover for percentages and vote counts. In <b>House</b> view, amber dashed lines draw the congressional districts (116th Congress maps for 2016&ndash;2020, 119th for 2022&ndash;2024, 120th for 2026); the colours still show whole counties, so a county split between districts is one blended colour.</td></tr>
    <tr><th>Affinity</th><td>How closely each county tracks its state. Dark blue counties are the best bellwethers; pale ones are far from the state's result. Based on President and Senate in 2020, 2022 and 2024.</td></tr>
    <tr><th>2026</th><td>The landing tab. With no results added, it shows the <b>polling model</b>: the statewide 2026 Senate poll average plus each county's usual lean gives an expected margin for every county (grey states have no poll average). Once you add results it switches to <b>Actual vs polls</b>: each county coloured by how far its real margin is from that expectation. Blue means more Democratic than the polls imply, red more Republican. Toggle between the two at the top. Before any results exist, <b>Actual vs polls (example)</b> shows a clearly labelled simulated scenario with a slider, so you can see how the view reads. The poll average weights recent polls, larger samples and non-partisan sponsors more, and sets undecided voters aside. Expect a typical miss of about 5 points, mostly from the poll itself; the county pattern given the state result is good to about 2&ndash;3. Hovering a county with live results also shows <b>% of votes in</b> when the source reports it (today that is the civicAPI states; its figure counts reporting precincts and can differ from the news sites' estimate of expected vote). Counties below the % reporting cutoff in the state panel are left out of the projection.</td></tr>
    <tr><th>Swing</th><td>Compares two elections (A then B), county by county. Blue means the county moved toward Democrats, red toward Republicans, saturating at 25 points. You can compare different offices, such as 2020 President with 2020 Senate.</td></tr>
  </table>
  <p>Zoom with the scroll wheel or the + / &minus; buttons, drag to pan, <b>Fit</b> resets. <b>Click a state</b> to open its panel and zoom in; press Esc or click the ocean to close it.</p>

  <h2>Reading the state panel</h2>
  <ul>
    <li><b>Score:</b> how far a county's margin typically sits from its state's, in points, blended with how well its swing between elections follows the state's. <b>Lower is better.</b></li>
    <li><b>Lean:</b> which way the county usually differs from the state. D+2 means about 2 points more Democratic; R+2 about 2 points more Republican.</li>
    <li><b>Vote:</b> the county's share of the statewide vote. Small counties are noisier; large ones move the state.</li>
    <li><b>Poll average:</b> shown above the projection for polled states, with the number of polls, the latest date and a warning when polling is thin (under 3 polls, or none in 3 weeks).</li>
    <li><b>Projection:</b> a projected <b>final</b> statewide margin with a range and the model's odds of who finishes ahead. It adds the votes already counted to a projection of the votes still to come. Each county's expected final vote comes from its 2024 turnout, scaled by how this year's turnout is running and by how much of the county is in. The rest of each county is projected at the statewide estimate plus its usual lean (the affinity model). The statewide estimate averages what each reporting county implies, weighted toward the best bellwethers, and is blended with the pre-election poll average (or, with no poll, a weak prior from 2024) that fades as more is counted. <b>How good is it:</b> in a hold-out test on 2022 and 2024 results, with counties reporting in random order, it missed the final margin by about 2.7 points with 2% of the vote counted, 2.3 with 10%, 1.8 with 25% and 1.1 with half; counting only the votes so far missed by 8 to 22 points. The range assumes the votes counted so far are representative. If early or mail votes lean differently from Election Day votes (the test used up to 8 points), every method missed by about 4.5 points. It needs county turnout and affinity scores, so it covers Senate and President only.</li>
  </ul>
  <p><b>Example:</b> if Erie is at D+1.7 and usually runs D+1.7 ahead of its state, it implies a state that is even.</p>

  <h2>Adding 2026 results</h2>
  <ul>
    <li><b>Official feeds:</b> Florida, South Carolina and Ohio Senate results are pulled automatically from the states' own sites every few minutes and appear on the map by themselves (the page checks once a minute). You don't need to paste those states; if you do, your paste takes priority.</li>
    <li><b>What to paste:</b> a table with a county column plus <b>vote counts</b> for the Democrat and the Republican. Other votes, total votes and % reporting are optional. Percent-only tables do not work.</li>
    <li><b>Matching:</b> county names are matched within the chosen state. It copes with &ldquo;County&rdquo;/&ldquo;Parish&rdquo; endings, &ldquo;St.&rdquo; versus &ldquo;Saint&rdquo;, spacing and accents. Rows it cannot match are listed with a dropdown so you can assign or skip them.</li>
    <li><b>Where it is stored:</b> only in your browser. Other devices will not see it, and clearing site data erases it. Use <b>Export all as CSV</b> to keep a copy.</li>
    <li><b>Contests:</b> Senate and President get projections. House results can be mapped but not projected, and county House totals add up every district that touches the county.</li>
    <li><b>Not supported:</b> Alaska and DC (no county-level scores).</li>
  </ul>

  <h2>How the scores are built</h2>
  <ul>
    <li><b>Contests:</b> President and Senate (regular and special) in 2020, 2022 and 2024, weighted 1 : 2 : 4 so the latest cycle counts most.</li>
    <li><b>Gap:</b> in each contest, county margin minus statewide margin. The score uses the weighted average of the absolute gaps, and Lean is the weighted average of the signed gaps.</li>
    <li><b>Swing tracking:</b> between consecutive contests of the same office in a state, how far the county's swing differs from the state's. The final score is 60% gap and 40% swing tracking (gap only where a state has no such pair).</li>
    <li><b>Left out:</b> Alaska (its districts were redrawn in 2022), DC, and any contest where one major party has almost no votes. Angus King (ME) and Bernie Sanders (VT) are counted as Democrats; other independents count as &ldquo;other&rdquo;.</li>
  </ul>

  <h2>How well does it work?</h2>
  <p>I rebuilt the scores from 2020 and 2022 only, then tried to project each state's 2024 result from a few counties:</p>
  <table class="g">
    <tr><th></th><th>5 bellwethers</th><th>5 biggest counties</th><th>5 random counties</th></tr>
    <tr><td>President (42 states)</td><td>1.3 pts</td><td>1.9 pts</td><td>2.1 pts</td></tr>
    <tr><td>Senate (29 states)</td><td>1.6 pts</td><td>1.7 pts</td><td>2.3 pts</td></tr>
  </table>
  <p>Average error in margin points. Carrying the 2020 presidential margin forward missed by 4.3. For the Senate the bellwethers only slightly beat simply using the biggest counties. The test assumes the counties were fully counted; real election-night counts are partial and arrive in an uneven order, so expect larger errors early.</p>

  <h2>Where the data comes from</h2>
  <ul>
    <li><b>Results:</b> MIT Election Data and Science Lab (Harvard Dataverse). County returns for President; precinct returns for Senate and House, which are summed to county level.</li>
    <li><b>Boundaries:</b> US Census cartographic files, via the us-atlas package; Alaska state House districts from Census files.</li>
    <li><b>Years:</b> President 2016, 2020, 2024; Senate 2016&ndash;2024; House 2016&ndash;2024. 2026 comes only from what you paste.</li>
  </ul>

  <h2>Known gaps and cautions</h2>
  <ul>
    <li><b>Alaska</b> is mapped by state House district, not county. Districts were redrawn in 2022, so Alaska has no scores and swings across 2022 stay grey. Alaska's 2022 Senate result exists only as a statewide total.</li>
    <li><b>Connecticut</b> moved to planning regions in some sources, and a few counties in other states do not match boundaries, so some counties show no data. Kansas City, MO was reported as its own unit in 2016 and is left out.</li>
    <li><b>House</b> county totals combine every district in the county, and a seat where one party did not run counts as zero for that party. Redistricting in 2022 means House swings across it are not like for like.</li>
    <li><b>Runoffs</b> are excluded; only general-election votes are counted.</li>
    <li><b>Partial counts mislead.</b> Rural counties often report first, and early, mail and Election Day votes can lean differently. Treat early projections as a rough guide, not a call.</li>
    <li>This is an independent analysis tool, not an official source of results. Always check outcomes against your state's election authority.</li>
  </ul>

  <h2>Glossary</h2>
  <ul>
    <li><b>Margin:</b> Democratic share minus Republican share of all votes, in points. D+5 means Democrats lead by 5.</li>
    <li><b>Swing:</b> the change in margin between two elections.</li>
    <li><b>Bellwether:</b> a county whose result tracks the whole state's.</li>
    <li><b>Points:</b> percentage points, not percent.</li>
  </ul>
</article>`;

  const q = id => document.getElementById(id);
  const guide = q('guide'), btn = q('guideBtn');
  guide.innerHTML = html;
  let prevOn = null;

  function open() {
    prevOn = document.querySelector('#mode button.on');
    document.querySelectorAll('#mode button').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    guide.hidden = false; guide.scrollTop = 0;
    q('tip').style.display = 'none';
  }
  function close(restore) {
    guide.hidden = true; btn.classList.remove('on');
    if (restore && prevOn) prevOn.classList.add('on');
  }
  btn.onclick = () => (guide.hidden ? open() : close(true));
  guide.querySelector('.gclose').onclick = () => close(true);
  addEventListener('keydown', e => { if (e.key === 'Escape' && !guide.hidden) close(true); });
  // picking a map view closes the guide (the view's own handler has already set the highlighted tab)
  q('mode').addEventListener('click', e => { if (e.target.closest('button[data-m]')) close(false); });
})();
