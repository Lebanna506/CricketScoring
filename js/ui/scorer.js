import { loadMatch, saveMatch } from '../storage.js';
import { exportMatch } from '../fileio.js';
import { newOverEntry, newFowEntry, newInnings, teamName, SESSIONS } from '../model.js';
import {
  currentScore, isInningsClosed, partnerships, bestPartnership, teamMilestones,
  sessionSummary, daySummaries, matchStatusText, followOnThreshold, requiredRunRate,
  sortedOvers, oppositeSide,
} from '../calc.js';
import { esc, fmtRR, toast, openModal, closeModal } from './common.js';

const TABS = [
  ['score', 'Score'],
  ['scorecard', 'Scorecard'],
  ['partnerships', 'Partnerships'],
  ['milestones', 'Milestones'],
  ['sessions', 'Sessions & Days'],
  ['info', 'Match Info'],
];

function getInnings(match, number) {
  return match.innings.find((i) => i.number === number) || null;
}
function activeInnings(match) {
  return match.innings[match.innings.length - 1] || null;
}

async function persist(match) {
  await saveMatch(match);
}

export async function renderScorer(container, navigate, matchId, tab = 'score') {
  const match = await loadMatch(matchId);
  if (!match) {
    container.innerHTML = `<div class="card">Match not found. <a href="#/">Go back</a></div>`;
    return;
  }

  const root = document.createElement('div');
  const status = safeStatus(match);
  const decided = /won|drawn|Match not started/i.test(status) && !/lead|trail|require/i.test(status);

  root.innerHTML = `
    <div class="status-banner ${decided ? 'decided' : ''}">${esc(status)}</div>
    <div class="tabs" id="tab-bar">
      ${TABS.map(([key, label]) => `<button data-tab="${key}" class="${tab === key ? 'active' : ''}">${label}</button>`).join('')}
    </div>
    <div id="tab-content"></div>
  `;
  container.replaceChildren(root);

  root.querySelector('#tab-bar').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (btn) navigate(`#/match/${matchId}/${btn.dataset.tab}`);
  });

  const contentEl = root.querySelector('#tab-content');
  const rerender = () => renderScorer(container, navigate, matchId, tab);

  switch (tab) {
    case 'score': renderScoreTab(contentEl, match, rerender, navigate); break;
    case 'scorecard': renderScorecardTab(contentEl, match); break;
    case 'partnerships': renderPartnershipsTab(contentEl, match); break;
    case 'milestones': renderMilestonesTab(contentEl, match); break;
    case 'sessions': renderSessionsTab(contentEl, match, rerender); break;
    case 'info': renderInfoTab(contentEl, match, rerender, navigate); break;
    default: renderScoreTab(contentEl, match, rerender, navigate);
  }
}

function safeStatus(match) {
  try { return matchStatusText(match); } catch { return 'Status unavailable'; }
}

// ---------------------------------------------------------------- SCORE TAB

function renderScoreTab(el, match, rerender, navigate) {
  const inn = activeInnings(match);
  const wrap = document.createElement('div');

  if (!inn) {
    wrap.innerHTML = `<div class="card">No innings yet.</div>`;
    el.replaceChildren(wrap);
    return;
  }

  const sc = currentScore(inn);
  const closed = isInningsClosed(inn);
  const battingName = teamName(match, inn.battingTeam);
  const bowlingName = teamName(match, inn.bowlingTeam);
  const lastOver = sortedOvers(inn).slice(-1)[0];
  const nextOverNumber = sortedOvers(inn).length + 1;
  const defaultDay = lastOver ? lastOver.day : 1;
  const defaultSession = lastOver ? lastOver.session : 'morning';
  const bowlingLineup = match.lineups[inn.bowlingTeam] || [];
  const battingLineup = match.lineups[inn.battingTeam] || [];

  wrap.innerHTML = `
    <div class="card">
      <div class="score-hero">
        <div>
          <div class="runs">${sc.runs}/${sc.wickets}</div>
          <div class="meta">${battingName} · ${sc.overString} ov · RR ${fmtRR(sc.runRate)}</div>
        </div>
        <div class="pill">Innings ${inn.number}${inn.followOn ? ' (follow-on)' : ''}</div>
        ${closed ? '<div class="pill">Closed</div>' : ''}
      </div>
      <div class="meta" style="margin-top:6px;">Bowling: ${esc(bowlingName)}</div>
    </div>

    ${closed ? renderNextInningsCard(match) : renderOverEntryCard({
      nextOverNumber, defaultDay, defaultSession, scheduledDays: match.scheduledDays, bowlingLineup,
      maxWickets: Math.min(6, 10 - sc.wickets),
    })}

    ${!closed ? `<div class="card"><button class="btn warn" data-action="declare">Declare innings</button>
      <button class="btn ghost" data-action="undo" ${sortedOvers(inn).length === 0 ? 'disabled' : ''}>Undo last over</button></div>` : ''}

    <div class="card">
      <h3>Recent overs</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Over</th><th>Runs</th><th>Wkts</th><th>Bowler</th><th>Day</th><th>Session</th></tr></thead>
          <tbody>
            ${sortedOvers(inn).slice(-8).reverse().map((o) => `
              <tr>
                <td>${o.overNumber}</td>
                <td>${o.runs}</td>
                <td>${o.wickets}</td>
                <td>${esc(o.bowler) || '-'}</td>
                <td>${o.day}</td>
                <td>${cap(o.session)}</td>
              </tr>`).join('') || '<tr><td colspan="6" class="meta">No overs entered yet</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
  el.replaceChildren(wrap);

  const form = wrap.querySelector('#over-entry-form');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const runs = Number(fd.get('runs')) || 0;
      const wickets = Math.min(10 - sc.wickets, Number(fd.get('wickets')) || 0);
      const entry = newOverEntry({
        overNumber: nextOverNumber,
        runs,
        wickets,
        extras: Number(fd.get('extras')) || 0,
        day: Number(fd.get('day')),
        session: fd.get('session'),
        bowler: fd.get('bowler'),
      });
      inn.overs.push(entry);
      await persist(match);

      if (wickets > 0) {
        await collectFallOfWickets(match, inn, wickets, battingLineup, bowlingLineup);
      }
      rerender();
    });
  }

  wrap.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'declare') {
      if (confirm(`Declare ${battingName}'s innings closed at ${sc.runs}/${sc.wickets}?`)) {
        inn.declared = true;
        await persist(match);
        rerender();
      }
    }
    if (btn.dataset.action === 'undo') {
      const overs = sortedOvers(inn);
      const last = overs[overs.length - 1];
      if (last && confirm(`Remove over ${last.overNumber} (${last.runs} runs, ${last.wickets} wkts)?`)) {
        inn.overs = inn.overs.filter((o) => o.id !== last.id);
        inn.fallOfWickets = inn.fallOfWickets.filter((w) => w.oversCompleted + 1 !== last.overNumber);
        await persist(match);
        rerender();
      }
    }
    if (btn.dataset.action === 'start-next') {
      await startNextInnings(match, navigate);
    }
    if (btn.dataset.action === 'reopen') {
      inn.declared = false;
      await persist(match);
      rerender();
    }
  });
}

function renderOverEntryCard({ nextOverNumber, defaultDay, defaultSession, scheduledDays, bowlingLineup, maxWickets }) {
  const dayOptions = Array.from({ length: scheduledDays }, (_, i) => i + 1)
    .map((d) => `<option value="${d}" ${d === defaultDay ? 'selected' : ''}>Day ${d}</option>`).join('');
  const sessionOptions = SESSIONS.map((s) => `<option value="${s}" ${s === defaultSession ? 'selected' : ''}>${cap(s)}</option>`).join('');
  return `
    <div class="card">
      <h3>Add over ${nextOverNumber}</h3>
      <form id="over-entry-form">
        <div class="grid cols-4">
          <div class="field"><label>Runs this over</label><input name="runs" type="number" min="0" inputmode="numeric" value="0" required /></div>
          <div class="field"><label>Wickets</label>
            <select name="wickets">
              ${Array.from({ length: Math.max(1, maxWickets) + 1 }, (_, n) => n).map((n) => `<option value="${n}">${n}</option>`).join('')}
            </select>
          </div>
          <div class="field"><label>Day</label><select name="day">${dayOptions}</select></div>
          <div class="field"><label>Session</label><select name="session">${sessionOptions}</select></div>
        </div>
        <div class="grid cols-2">
          <div class="field">
            <label>Bowler (optional)</label>
            <input name="bowler" list="bowler-list" placeholder="e.g. Cummins" />
            <datalist id="bowler-list">${bowlingLineup.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
          </div>
          <div class="field"><label>Extras this over (optional, included in runs)</label><input name="extras" type="number" min="0" value="0" /></div>
        </div>
        <button type="submit" class="btn primary big">Save over</button>
      </form>
    </div>
  `;
}

function renderNextInningsCard(match) {
  const inn = activeInnings(match);
  if (match.innings.length >= 4) {
    return `<div class="card meta">All four innings have been played. See Match Info to set the final result if needed.</div>`;
  }
  const sc = currentScore(inn);
  return `
    <div class="card">
      <p>${teamName(match, inn.battingTeam)}'s innings is closed at ${sc.runs}/${sc.wickets}.</p>
      <div class="btn-row">
        <button class="btn primary" data-action="start-next">Start innings ${inn.number + 1}</button>
        ${!inn.declared ? '' : '<button class="btn ghost" data-action="reopen">Reopen (undo declaration)</button>'}
      </div>
    </div>
  `;
}

async function startNextInnings(match, navigate) {
  const nextNumber = activeInnings(match).number + 1;
  let followOn = false;
  if (nextNumber === 3) {
    const i1 = getInnings(match, 1), i2 = getInnings(match, 2);
    const lead = currentScore(i1).runs - currentScore(i2).runs;
    const threshold = followOnThreshold(match.scheduledDays);
    if (lead >= threshold) {
      followOn = confirm(`${teamName(match, i1.battingTeam)} lead by ${lead} runs (≥ ${threshold}). Enforce the follow-on?\n\nOK = enforce follow-on, Cancel = bat again normally.`);
    }
  }
  const inn = newInnings(match, nextNumber, { followOn });
  match.innings.push(inn);
  await persist(match);
  navigate(`#/match/${match.id}/score`);
}

async function collectFallOfWickets(match, inn, count, battingLineup, bowlingLineup) {
  for (let i = 0; i < count; i++) {
    const sc = currentScore(inn);
    const wicketNumber = inn.fallOfWickets.length + 1;
    if (wicketNumber > 10) break;
    await new Promise((resolve) => {
      const html = `
        <h2>Wicket ${wicketNumber}</h2>
        <form id="fow-form">
          <div class="grid cols-2">
            <div class="field"><label>Team score at dismissal</label><input name="score" type="number" value="${sc.runs}" required /></div>
            <div class="field"><label>Ball (1-6) in over ${sortedOvers(inn).slice(-1)[0]?.overNumber ?? ''}</label><input name="ball" type="number" min="1" max="6" value="6" required /></div>
          </div>
          <div class="field"><label>Batsman out</label><input name="batsmanOut" list="bat-list" placeholder="Name" />
            <datalist id="bat-list">${battingLineup.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
          </div>
          <div class="grid cols-2">
            <div class="field"><label>How out</label>
              <select name="howOut">
                <option value="">-</option>
                <option>Bowled</option><option>Caught</option><option>LBW</option>
                <option>Run Out</option><option>Stumped</option><option>Hit Wicket</option>
                <option>Retired Hurt</option><option>Other</option>
              </select>
            </div>
            <div class="field"><label>Bowler</label><input name="bowler" list="bowl-list" />
              <datalist id="bowl-list">${bowlingLineup.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
            </div>
          </div>
          <div class="field"><label>Fielder (if applicable)</label><input name="fielder" list="bowl-list" /></div>
          <button type="submit" class="btn primary big">Save wicket</button>
        </form>
      `;
      const modal = openModal(html, {
        onMount: (m) => {
          const overLabel = sortedOvers(inn).slice(-1)[0]?.overNumber ?? 1;
          const oversCompleted = overLabel - 1; // standard cricket notation: full overs bowled BEFORE this ball
          m.querySelector('#fow-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const fd = new FormData(e.target);
            inn.fallOfWickets.push(newFowEntry({
              wicketNumber,
              oversCompleted,
              ball: Number(fd.get('ball')) || 6,
              score: Number(fd.get('score')) || sc.runs,
              batsmanOut: fd.get('batsmanOut'),
              howOut: fd.get('howOut'),
              bowler: fd.get('bowler'),
              fielder: fd.get('fielder'),
            }));
            closeModal();
            resolve();
          });
        },
      });
    });
  }
  await persist(match);
}

// ------------------------------------------------------------ SCORECARD TAB

function renderScorecardTab(el, match) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="card">
      <h3>Innings summary</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Team</th><th>Score</th><th>Overs</th><th>RR</th><th>Best stand</th></tr></thead>
          <tbody>
            ${match.innings.map((i) => {
              const sc = currentScore(i);
              const bp = bestPartnership(i);
              return `<tr>
                <td>${i.number}${i.followOn ? ' (f/on)' : ''}</td>
                <td>${esc(teamName(match, i.battingTeam))}</td>
                <td>${sc.runs}/${sc.wickets}${isInningsClosed(i) ? '' : '*'}</td>
                <td>${sc.overString}</td>
                <td>${fmtRR(sc.runRate)}</td>
                <td>${bp ? `${bp.runs} (wkt ${bp.wicketNumber})` : '-'}</td>
              </tr>`;
            }).join('') || '<tr><td colspan="6" class="meta">No innings yet</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
    ${match.innings.map((i) => renderFowCard(match, i)).join('')}
  `;
  el.replaceChildren(wrap);
}

function renderFowCard(match, inn) {
  const fow = [...inn.fallOfWickets].sort((a, b) => a.wicketNumber - b.wicketNumber);
  if (fow.length === 0) return '';
  return `
    <div class="card">
      <h3>${esc(teamName(match, inn.battingTeam))} - Innings ${inn.number} - Fall of wickets</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Wkt</th><th>Score</th><th>Over</th><th>Batsman</th><th>How out</th><th>Bowler</th></tr></thead>
          <tbody>
            ${fow.map((w) => `<tr>
              <td>${w.wicketNumber}</td>
              <td>${w.score}</td>
              <td>${w.oversCompleted}.${w.ball}</td>
              <td>${esc(w.batsmanOut) || '-'}</td>
              <td>${esc(w.howOut) || '-'}${w.fielder ? ' (' + esc(w.fielder) + ')' : ''}</td>
              <td>${esc(w.bowler) || '-'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// --------------------------------------------------------- PARTNERSHIPS TAB

function renderPartnershipsTab(el, match) {
  const wrap = document.createElement('div');
  const options = inningsOptions(match);
  const selected = activeInnings(match)?.number ?? options[0]?.value;
  wrap.innerHTML = `
    <div class="card">
      <div class="field"><label>Innings</label>
        <select id="inn-select">${options.map((o) => `<option value="${o.value}" ${o.value === selected ? 'selected' : ''}>${o.label}</option>`).join('')}</select>
      </div>
      <div id="partnerships-body"></div>
    </div>
  `;
  el.replaceChildren(wrap);
  const body = wrap.querySelector('#partnerships-body');
  const draw = (num) => {
    const inn = getInnings(match, Number(num));
    const parts = inn ? partnerships(inn) : [];
    const best = bestPartnership(inn);
    body.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Wkt</th><th>Runs</th><th>Balls</th><th>Overs</th><th>Ended</th></tr></thead>
          <tbody>
            ${parts.map((p) => `<tr class="${best && p.wicketNumber === best.wicketNumber ? 'highlight' : ''}">
              <td>${p.wicketNumber}${p.complete ? '' : ' (unbroken)'}</td>
              <td>${p.runs}</td>
              <td>${p.balls}</td>
              <td>${p.fromOver} - ${p.toOver}</td>
              <td>${p.batsmanOut ? esc(p.batsmanOut) + (p.howOut ? ' - ' + esc(p.howOut) : '') : '-'}</td>
            </tr>`).join('') || '<tr><td colspan="5" class="meta">No partnerships yet</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  };
  draw(selected);
  wrap.querySelector('#inn-select').addEventListener('change', (e) => draw(e.target.value));
}

// ----------------------------------------------------------- MILESTONES TAB

function renderMilestonesTab(el, match) {
  const wrap = document.createElement('div');
  const options = inningsOptions(match);
  const selected = activeInnings(match)?.number ?? options[0]?.value;
  wrap.innerHTML = `
    <div class="card">
      <div class="field"><label>Innings</label>
        <select id="inn-select">${options.map((o) => `<option value="${o.value}" ${o.value === selected ? 'selected' : ''}>${o.label}</option>`).join('')}</select>
      </div>
      <p class="meta">Pace to each 50-run mark. The ball within an over is estimated (runs are assumed to spread evenly across that over), since scoring is entered over-by-over rather than ball-by-ball.</p>
      <div id="milestones-body"></div>
    </div>
    <div class="card" id="rrr-card"></div>
  `;
  el.replaceChildren(wrap);
  const body = wrap.querySelector('#milestones-body');
  const draw = (num) => {
    const inn = getInnings(match, Number(num));
    const ms = inn ? teamMilestones(inn) : [];
    body.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Runs</th><th>Reached at</th><th>Balls faced</th><th>Segment RR</th></tr></thead>
          <tbody>
            ${ms.map((m) => `<tr>
              <td>${m.milestone}</td><td>${m.overs} ov</td><td>${m.balls}</td><td>${fmtRR(m.runRateForSegment)}</td>
            </tr>`).join('') || '<tr><td colspan="4" class="meta">No 50 reached yet</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  };
  draw(selected);
  wrap.querySelector('#inn-select').addEventListener('change', (e) => draw(e.target.value));

  const rrrCard = wrap.querySelector('#rrr-card');
  const i4 = getInnings(match, 4);
  if (i4 && !isInningsClosed(i4)) {
    rrrCard.innerHTML = `
      <h3>Required run rate (4th innings)</h3>
      <div class="field"><label>Overs remaining today</label><input id="overs-remaining" type="number" min="0" step="0.1" placeholder="e.g. 32" /></div>
      <div id="rrr-out" class="meta">Enter overs remaining to estimate the required run rate.</div>
    `;
    rrrCard.querySelector('#overs-remaining').addEventListener('input', (e) => {
      const rrr = requiredRunRate(match, Number(e.target.value));
      rrrCard.querySelector('#rrr-out').textContent = rrr ? `Required run rate: ${fmtRR(rrr)}` : 'Enter overs remaining to estimate the required run rate.';
    });
  } else {
    rrrCard.remove();
  }
}

// ------------------------------------------------------------- SESSIONS TAB

function renderSessionsTab(el, match, rerender) {
  const wrap = document.createElement('div');
  const options = inningsOptions(match);
  const selected = activeInnings(match)?.number ?? options[0]?.value;

  wrap.innerHTML = `
    <div class="card">
      <div class="field"><label>Innings (session breakdown)</label>
        <select id="inn-select">${options.map((o) => `<option value="${o.value}" ${o.value === selected ? 'selected' : ''}>${o.label}</option>`).join('')}</select>
      </div>
      <div id="session-body"></div>
    </div>
    <div class="card">
      <h3>Day-by-day</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Day</th><th>Runs</th><th>Wkts</th><th>Overs</th><th>RR</th></tr></thead>
          <tbody>
            ${daySummaries(match).map((d) => `<tr><td>${d.day}</td><td>${d.runs}</td><td>${d.wickets}</td><td>${d.overs}</td><td>${fmtRR(d.runRate)}</td></tr>`).join('') || '<tr><td colspan="5" class="meta">No play recorded yet</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <h3>Time lost to weather (minutes)</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Day</th><th>Morning</th><th>Afternoon</th><th>Evening</th></tr></thead>
          <tbody>
            ${match.days.map((d) => `<tr>
              <td>Day ${d.dayNumber}</td>
              ${SESSIONS.map((s) => `<td><input type="number" min="0" data-day="${d.dayNumber}" data-session="${s}" class="weather-input" value="${d.weather[s] || 0}" /></td>`).join('')}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
  el.replaceChildren(wrap);

  const body = wrap.querySelector('#session-body');
  const draw = (num) => {
    const inn = getInnings(match, Number(num));
    const rows = inn ? sessionSummary(inn) : [];
    body.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead><tr><th>Day</th><th>Session</th><th>Runs</th><th>Wkts</th><th>Overs</th><th>RR</th></tr></thead>
          <tbody>
            ${rows.map((r) => `<tr><td>${r.day}</td><td>${cap(r.session)}</td><td>${r.runs}</td><td>${r.wickets}</td><td>${r.overs}</td><td>${fmtRR(r.runRate)}</td></tr>`).join('') || '<tr><td colspan="6" class="meta">No overs recorded</td></tr>'}
          </tbody>
        </table>
      </div>
    `;
  };
  draw(selected);
  wrap.querySelector('#inn-select').addEventListener('change', (e) => draw(e.target.value));

  wrap.querySelectorAll('.weather-input').forEach((input) => {
    input.addEventListener('change', async () => {
      const day = match.days.find((d) => d.dayNumber === Number(input.dataset.day));
      if (day) day.weather[input.dataset.session] = Number(input.value) || 0;
      await persist(match);
      toast('Saved');
    });
  });
}

// ----------------------------------------------------------------- INFO TAB

function renderInfoTab(el, match, rerender, navigate) {
  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="card">
      <h3>Match details</h3>
      <form id="info-form">
        <div class="grid cols-2">
          <div class="field"><label>Home team</label><input name="homeTeam" value="${esc(match.homeTeam)}" /></div>
          <div class="field"><label>Away team</label><input name="awayTeam" value="${esc(match.awayTeam)}" /></div>
        </div>
        <div class="grid cols-2">
          <div class="field"><label>Venue</label><input name="venue" value="${esc(match.venue)}" /></div>
          <div class="field"><label>Start date</label><input type="date" name="startDate" value="${match.startDate || ''}" /></div>
        </div>
        <div class="grid cols-2">
          <div class="field"><label>Toss won by</label>
            <select name="tossWonBy">
              <option value="home" ${match.toss.wonBy === 'home' ? 'selected' : ''}>${esc(match.homeTeam)}</option>
              <option value="away" ${match.toss.wonBy === 'away' ? 'selected' : ''}>${esc(match.awayTeam)}</option>
            </select>
          </div>
          <div class="field"><label>Elected to</label>
            <select name="tossDecision">
              <option value="bat" ${match.toss.decision === 'bat' ? 'selected' : ''}>Bat</option>
              <option value="bowl" ${match.toss.decision === 'bowl' ? 'selected' : ''}>Bowl</option>
            </select>
          </div>
        </div>
        <div class="grid cols-2">
          <div class="field"><label>${esc(match.homeTeam)} line-up</label><textarea name="homeLineup">${esc((match.lineups.home || []).join('\n'))}</textarea></div>
          <div class="field"><label>${esc(match.awayTeam)} line-up</label><textarea name="awayLineup">${esc((match.lineups.away || []).join('\n'))}</textarea></div>
        </div>
        <button type="submit" class="btn primary">Save details</button>
      </form>
    </div>
    <div class="card">
      <h3>Result override</h3>
      <p class="meta">The status banner is generated automatically. If the match ends in a draw (out of time) or is abandoned, set that here.</p>
      <div class="field"><textarea id="manual-note" placeholder="e.g. Match drawn - stumps on Day 5">${esc(match.result?.manualNote || '')}</textarea></div>
      <div class="btn-row">
        <button class="btn secondary" data-action="save-note">Save override</button>
        <button class="btn ghost" data-action="clear-note">Clear (use automatic status)</button>
      </div>
    </div>
    <div class="card">
      <h3>Save this match</h3>
      <div class="btn-row">
        <button class="btn primary" data-action="export">Save to file (e.g. OneDrive folder)</button>
      </div>
    </div>
    <div class="card">
      <h3>Danger zone</h3>
      <button class="btn danger" data-action="delete-match">Delete this match from this device</button>
    </div>
  `;
  el.replaceChildren(wrap);

  wrap.querySelector('#info-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    match.homeTeam = fd.get('homeTeam').trim() || match.homeTeam;
    match.awayTeam = fd.get('awayTeam').trim() || match.awayTeam;
    match.venue = fd.get('venue').trim();
    match.startDate = fd.get('startDate') || null;
    match.toss = { wonBy: fd.get('tossWonBy'), decision: fd.get('tossDecision') };
    match.lineups.home = (fd.get('homeLineup') || '').split('\n').map((s) => s.trim()).filter(Boolean);
    match.lineups.away = (fd.get('awayLineup') || '').split('\n').map((s) => s.trim()).filter(Boolean);
    await persist(match);
    toast('Saved');
    rerender();
  });

  wrap.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    if (btn.dataset.action === 'save-note') {
      match.result.manualNote = wrap.querySelector('#manual-note').value.trim();
      await persist(match);
      toast('Result override saved');
      rerender();
    }
    if (btn.dataset.action === 'clear-note') {
      match.result.manualNote = '';
      await persist(match);
      rerender();
    }
    if (btn.dataset.action === 'export') {
      try {
        await exportMatch(match);
        toast('Saved to file');
      } catch (err) {
        if (err?.name !== 'AbortError') toast('Save failed: ' + err.message);
      }
    }
    if (btn.dataset.action === 'delete-match') {
      if (confirm('Delete this match from this device? Export it first if you want to keep it.')) {
        const { deleteMatch } = await import('../storage.js');
        await deleteMatch(match.id);
        navigate('#/');
      }
    }
  });
}

function inningsOptions(match) {
  return match.innings.map((i) => ({ value: i.number, label: `Innings ${i.number} - ${teamName(match, i.battingTeam)}` }));
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
