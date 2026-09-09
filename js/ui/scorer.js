import { loadMatch, saveMatch, deleteMatch } from '../storage.js';
import { exportMatch } from '../fileio.js';
import {
  newOverEntry, newFowEntry, newInnings, teamName, SESSIONS, advanceSession,
  parseOverBall, inningsOrdinalForTeam, emptySessionRecord,
} from '../model.js';
import {
  currentScore, isInningsClosed, partnerships, bestPartnership, teamMilestones,
  crossedMilestones, sessionSummary, matchSessionSummary, daySummaries, matchStatusText,
  followOnThreshold, requiredRunRate, sortedOvers, overByOverSeries, ballSummary,
  inningsRelativeState, partnershipsComparison, milestonesComparison, sessionRecord,
  expectedOversForSession, expectedOversForDay, battingSideForInnings, oppositeSide,
} from '../calc.js';
import { esc, fmtRR, toast, openModal, closeModal } from './common.js';

const TOP_TABS = [
  ['innings', 'Innings'],
  ['scorecard', 'Scorecard'],
  ['partnerships', 'Partnerships'],
  ['milestones', 'Milestones'],
  ['sessions', 'Sessions'],
  ['info', 'Match Info'],
];

function getInnings(match, number) {
  return match.innings.find((i) => i.number === number) || null;
}
function lastInnings(match) {
  return match.innings[match.innings.length - 1] || null;
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

function inningsSubTabLabel(match, number) {
  const side = battingSideForInnings(match, number);
  const ordinal = inningsOrdinalForTeam(match, number) === 1 ? '1st' : '2nd';
  return `${teamName(match, side)} ${ordinal} Innings`;
}

function oversDiffSpan(actualDecimal, expected) {
  const diff = actualDecimal - expected;
  const cls = diff > 0.05 ? 'badge-ahead' : diff < -0.05 ? 'badge-behind' : 'badge-exact';
  const sign = diff > 0 ? '+' : '';
  return `<span class="${cls}">(${sign}${diff.toFixed(1)})</span>`;
}

function ensureDayRecord(match, dayNumber) {
  let day = match.days.find((d) => d.dayNumber === dayNumber);
  if (!day) {
    day = { dayNumber, date: null, sessions: { morning: emptySessionRecord(), afternoon: emptySessionRecord(), evening: emptySessionRecord() } };
    match.days.push(day);
    match.days.sort((a, b) => a.dayNumber - b.dayNumber);
  }
  return day;
}

async function persist(match) {
  await saveMatch(match);
}

export async function renderScorer(container, navigate, matchId, tab = 'innings', sub = null) {
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
      ${TOP_TABS.map(([key, label]) => `<button data-tab="${key}" class="${tab === key ? 'active' : ''}">${label}</button>`).join('')}
    </div>
    <div id="tab-content"></div>
  `;
  container.replaceChildren(root);

  root.querySelector('#tab-bar').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-tab]');
    if (btn) navigate(`#/match/${matchId}/${btn.dataset.tab}`);
  });

  const contentEl = root.querySelector('#tab-content');
  const rerender = () => renderScorer(container, navigate, matchId, tab, sub);

  switch (tab) {
    case 'innings': renderInningsTab(contentEl, match, navigate, rerender, sub); break;
    case 'scorecard': renderScorecardTab(contentEl, match); break;
    case 'partnerships': renderPartnershipsCompareTab(contentEl, match); break;
    case 'milestones': renderMilestonesCompareTab(contentEl, match); break;
    case 'sessions': renderSessionsTab(contentEl, match, rerender); break;
    case 'info': renderInfoTab(contentEl, match, rerender, navigate); break;
    default: renderInningsTab(contentEl, match, navigate, rerender, sub);
  }
}

function safeStatus(match) {
  try { return matchStatusText(match); } catch { return 'Status unavailable'; }
}

// -------------------------------------------------------------- INNINGS TAB

function renderInningsTab(el, match, navigate, rerender, subParam) {
  const wrap = document.createElement('div');

  if (match.innings.length === 0) {
    wrap.innerHTML = `<div class="card">No innings yet.</div>`;
    el.replaceChildren(wrap);
    return;
  }

  const last = lastInnings(match);
  const subNumber = subParam ? Number(subParam) : last.number;
  const inn = getInnings(match, subNumber) || last;
  const isActive = inn.number === last.number;
  const battingSide = battingSideForInnings(match, inn.number);
  const battingLineup = match.lineups[battingSide] || [];

  wrap.innerHTML = `
    <div class="tabs sub-tabs" id="innings-subtabs">
      ${match.innings.map((i) => `<button data-subtab="${i.number}" class="${i.number === inn.number ? 'active' : ''}">${esc(inningsSubTabLabel(match, i.number))}</button>`).join('')}
    </div>
    ${scoreHeroCard(match, inn)}
    ${inn.number === 4 ? requiredRunRateCard(match, inn) : ''}
    ${isActive && !isInningsClosed(inn) ? currentlyBattingCard(inn) : ''}
    ${isActive ? (isInningsClosed(inn) ? nextInningsCard(match, inn) : actionsCard(inn)) : ''}
    ${oversTableCard(inn)}
    ${ballSummaryCard(inn)}
    ${fowCard(inn)}
    ${partnershipsCardInnings(inn)}
    ${milestonesCardInnings(inn)}
  `;
  el.replaceChildren(wrap);

  wrap.querySelector('#innings-subtabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-subtab]');
    if (btn) navigate(`#/match/${match.id}/innings/${btn.dataset.subtab}`);
  });

  wrap.querySelectorAll('.batsman-input').forEach((input) => {
    input.addEventListener('change', async () => {
      inn.currentBatsmen[Number(input.dataset.idx)] = input.value.trim();
      await persist(match);
    });
  });

  const rrrInput = wrap.querySelector('#overs-remaining');
  if (rrrInput) {
    rrrInput.addEventListener('input', (e) => {
      const rrr = requiredRunRate(match, Number(e.target.value));
      wrap.querySelector('#rrr-out').textContent = rrr ? `Required run rate: ${fmtRR(rrr)}` : 'Enter overs remaining to estimate the required run rate.';
    });
  }

  wrap.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === 'set-runs') {
      await saveOver(match, inn, Number(btn.dataset.value));
      rerender();
    }
    if (action === 'set-runs-custom') {
      openCustomRunsModal(match, inn, rerender);
    }
    if (action === 'wicket') {
      await handleWicket(match, inn, battingLineup);
      rerender();
    }
    if (action === 'end-session') {
      if (confirm(`End the ${cap(match.currentSession.session)} session (Day ${match.currentSession.day})? Overs from now on are tagged as the next session.`)) {
        match.currentSession = advanceSession(match.currentSession);
        await persist(match);
        rerender();
      }
    }
    if (action === 'new-ball') {
      if (confirm('Take a new ball from the start of the next over?')) {
        inn.currentBallNumber += 1;
        await persist(match);
        rerender();
      }
    }
    if (action === 'mark-session-lost') {
      if (confirm(`Mark the ${cap(match.currentSession.session)} session (Day ${match.currentSession.day}) as completely lost?`)) {
        ensureDayRecord(match, match.currentSession.day).sessions[match.currentSession.session].lost = true;
        match.currentSession = advanceSession(match.currentSession);
        await persist(match);
        rerender();
      }
    }
    if (action === 'declare') {
      const sc = currentScore(inn);
      if (confirm(`Declare ${teamName(match, battingSide)}'s innings closed at ${sc.runs}/${sc.wickets}?`)) {
        inn.declared = true;
        await persist(match);
        rerender();
      }
    }
    if (action === 'undo') {
      const overs = sortedOvers(inn);
      const lastOver = overs[overs.length - 1];
      if (lastOver && confirm(`Remove over ${lastOver.overNumber} (${lastOver.runs} runs)?`)) {
        inn.overs = inn.overs.filter((o) => o.id !== lastOver.id);
        inn.fallOfWickets = inn.fallOfWickets.filter((w) => w.oversCompleted + 1 !== lastOver.overNumber);
        await persist(match);
        rerender();
      }
    }
    if (action === 'start-next') {
      await startNextInnings(match, navigate);
    }
    if (action === 'reopen') {
      inn.declared = false;
      await persist(match);
      rerender();
    }
  });
}

function scoreHeroCard(match, inn) {
  const battingSide = battingSideForInnings(match, inn.number);
  const bowlingSide = oppositeSide(battingSide);
  const sc = currentScore(inn);
  const closed = isInningsClosed(inn);
  return `
    <div class="card">
      <div class="score-hero">
        <div>
          <div class="runs">${sc.runs}/${sc.wickets}</div>
          <div class="meta">${esc(teamName(match, battingSide))} · ${sc.overString} ov · RR ${fmtRR(sc.runRate)}</div>
        </div>
        <div class="pill">Innings ${inn.number}${inn.followOn ? ' (follow-on)' : ''}</div>
        ${closed ? '<div class="pill">Closed</div>' : ''}
      </div>
      <div class="meta" style="margin-top:6px;">Bowling: ${esc(teamName(match, bowlingSide))}</div>
    </div>
  `;
}

function requiredRunRateCard(match, inn) {
  const i3 = getInnings(match, 3);
  if (!i3 || !isInningsClosed(i3) || isInningsClosed(inn)) return '';
  return `
    <div class="card">
      <h3>Required run rate</h3>
      <div class="field"><label>Overs remaining today</label><input id="overs-remaining" type="number" min="0" step="0.1" placeholder="e.g. 32" /></div>
      <div id="rrr-out" class="meta">Enter overs remaining to estimate the required run rate.</div>
    </div>
  `;
}

function currentlyBattingCard(inn) {
  return `
    <div class="card">
      <h3>Currently batting</h3>
      <div class="grid cols-2">
        <div class="field"><label>Batsman 1</label><input class="batsman-input" data-idx="0" value="${esc(inn.currentBatsmen[0])}" placeholder="Name" /></div>
        <div class="field"><label>Batsman 2</label><input class="batsman-input" data-idx="1" value="${esc(inn.currentBatsmen[1])}" placeholder="Name" /></div>
      </div>
    </div>
  `;
}

function actionsCard(inn) {
  const cur = currentScore(inn);
  const nextOver = sortedOvers(inn).length + 1;
  const numpadValues = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  return `
    <div class="card">
      <h3>Over ${nextOver} - runs scored</h3>
      <div class="numpad">
        ${numpadValues.map((n) => `<button class="numpad-btn" data-action="set-runs" data-value="${n}">${n}</button>`).join('')}
        <button class="numpad-btn numpad-more" data-action="set-runs-custom">10+</button>
      </div>
      <div class="btn-row" style="margin-top:14px;">
        <button class="btn warn" data-action="wicket" ${cur.wickets >= 10 ? 'disabled' : ''}>Wicket</button>
        <button class="btn secondary" data-action="end-session">End Session</button>
        <button class="btn secondary" data-action="new-ball">New Ball</button>
        <button class="btn ghost" data-action="mark-session-lost">Mark Session Lost</button>
      </div>
      <div class="btn-row" style="margin-top:8px;">
        <button class="btn warn" data-action="declare">Declare innings</button>
        <button class="btn ghost" data-action="undo" ${sortedOvers(inn).length === 0 ? 'disabled' : ''}>Undo last over</button>
      </div>
    </div>
  `;
}

function nextInningsCard(match, inn) {
  if (match.innings.length >= 4) {
    return `<div class="card meta">All four innings have been played. See Match Info to set the final result if needed.</div>`;
  }
  const sc = currentScore(inn);
  return `
    <div class="card">
      <p>${esc(teamName(match, battingSideForInnings(match, inn.number)))}'s innings is closed at ${sc.runs}/${sc.wickets}.</p>
      <div class="btn-row">
        <button class="btn primary" data-action="start-next">Start innings ${inn.number + 1}</button>
        ${!inn.declared ? '' : '<button class="btn ghost" data-action="reopen">Reopen (undo declaration)</button>'}
      </div>
    </div>
  `;
}

function oversTableCard(inn) {
  const rows = overByOverSeries(inn).slice().reverse();
  return `
    <div class="card">
      <h3>Overs</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Over</th><th>Runs</th><th>Score</th><th>RR</th></tr></thead>
          <tbody>
            ${rows.map((r) => `<tr><td>${r.overNumber}</td><td>${r.runs}</td><td>${r.cumRuns}/${r.cumWickets}</td><td>${fmtRR(r.runRate)}</td></tr>`).join('') || '<tr><td colspan="4" class="meta">No overs yet</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function ballSummaryCard(inn) {
  const rows = ballSummary(inn);
  if (rows.length === 0) return '';
  return `
    <div class="card">
      <h3>By ball</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Ball</th><th>Overs</th><th>Runs</th><th>Wkts</th><th>RR</th></tr></thead>
          <tbody>
            ${rows.map((r) => `<tr><td>${r.ballNumber}</td><td>${r.overs}</td><td>${r.runs}</td><td>${r.wickets}</td><td>${fmtRR(r.runRate)}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function fowCard(inn) {
  const fow = [...inn.fallOfWickets].sort((a, b) => a.wicketNumber - b.wicketNumber);
  return `
    <div class="card">
      <h3>Fall of wickets</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Wkt</th><th>Score</th><th>Over</th><th>Batsman out</th></tr></thead>
          <tbody>
            ${fow.map((w) => `<tr><td>${w.wicketNumber}</td><td>${w.score}</td><td>${w.oversCompleted}.${w.ball}</td><td>${esc(w.outBatsman) || '-'}</td></tr>`).join('') || '<tr><td colspan="4" class="meta">No wickets yet</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function partnershipsCardInnings(inn) {
  const parts = partnerships(inn);
  const best = bestPartnership(inn);
  return `
    <div class="card">
      <h3>Partnerships</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Wkt</th><th>Batsmen</th><th>Runs</th><th>Balls</th><th>RR</th></tr></thead>
          <tbody>
            ${parts.map((p) => `<tr class="${best && p.wicketNumber === best.wicketNumber ? 'highlight' : ''}">
              <td>${p.wicketNumber}</td>
              <td>${esc(p.batsman1) || '-'} &amp; ${esc(p.batsman2) || '-'}</td>
              <td>${p.runs}</td><td>${p.balls}</td><td>${fmtRR(p.runRate)}</td>
            </tr>`).join('') || '<tr><td colspan="5" class="meta">No partnerships yet</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function milestonesCardInnings(inn) {
  const ms = teamMilestones(inn);
  return `
    <div class="card">
      <h3>Milestones</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Runs</th><th>Reached at</th><th>Segment RR</th></tr></thead>
          <tbody>
            ${ms.map((m) => `<tr><td>${m.milestone}</td><td>${m.overs} ov</td><td>${fmtRR(m.runRateForSegment)}</td></tr>`).join('') || '<tr><td colspan="3" class="meta">No 50 reached yet</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

async function saveOver(match, inn, runs) {
  const prevRuns = currentScore(inn).runs;
  const overNumber = sortedOvers(inn).length + 1;
  const entry = newOverEntry({
    overNumber,
    runs,
    day: match.currentSession.day,
    session: match.currentSession.session,
    ballNumber: inn.currentBallNumber,
  });
  inn.overs.push(entry);
  await persist(match);
  const newRuns = currentScore(inn).runs;
  const crossed = crossedMilestones(prevRuns, newRuns, inn.milestonesLog);
  if (crossed.length) {
    await collectMilestones(match, inn, crossed, overNumber);
  }
}

function openCustomRunsModal(match, inn, rerender) {
  const html = `
    <h2>Runs this over</h2>
    <form id="custom-runs-form">
      <div class="field"><label>Total runs (11+)</label><input name="runs" type="number" min="11" value="11" required autofocus /></div>
      <button type="submit" class="btn primary big">Save over</button>
    </form>
  `;
  openModal(html, {
    onMount: (m) => {
      m.querySelector('#custom-runs-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const runs = Number(new FormData(e.target).get('runs')) || 0;
        closeModal();
        await saveOver(match, inn, runs);
        rerender();
      });
    },
  });
}

async function collectMilestones(match, inn, crossed, overNumber) {
  for (const milestone of crossed) {
    await new Promise((resolve) => {
      const html = `
        <h2>${milestone} up!</h2>
        <p class="meta">Which ball did the team reach ${milestone}?</p>
        <form id="milestone-form">
          <div class="field"><label>Over.Ball (e.g. ${overNumber - 1}.4)</label><input name="overBall" value="${overNumber - 1}.6" required autofocus /></div>
          <button type="submit" class="btn primary big">Confirm</button>
        </form>
      `;
      openModal(html, {
        onMount: (m) => {
          m.querySelector('#milestone-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const { oversCompleted, ball } = parseOverBall(new FormData(e.target).get('overBall'));
            inn.milestonesLog.push({ milestone, oversCompleted, ball });
            closeModal();
            resolve();
          });
        },
      });
    });
  }
  await persist(match);
}

async function handleWicket(match, inn, battingLineup) {
  if (isInningsClosed(inn)) return;
  const wicketNumber = inn.fallOfWickets.length + 1;
  const pair = [...inn.currentBatsmen];
  const nextOverNumber = sortedOvers(inn).length + 1;
  const cur = currentScore(inn);

  const step1 = await new Promise((resolve) => {
    const html = `
      <h2>Wicket ${wicketNumber}</h2>
      <form id="wicket-form">
        <div class="field"><label>Who's out?</label>
          <select name="outIndex">
            <option value="0">${esc(pair[0] || 'Batsman 1')}</option>
            <option value="1">${esc(pair[1] || 'Batsman 2')}</option>
          </select>
        </div>
        <div class="grid cols-2">
          <div class="field"><label>Over.Ball (e.g. ${nextOverNumber - 1}.4)</label><input name="overBall" value="${nextOverNumber - 1}.1" required /></div>
          <div class="field"><label>Team score</label><input name="score" type="number" value="${cur.runs}" required /></div>
        </div>
        <button type="submit" class="btn primary big">Next: new batsman</button>
      </form>
    `;
    openModal(html, {
      onMount: (m) => {
        m.querySelector('#wicket-form').addEventListener('submit', (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const { oversCompleted, ball } = parseOverBall(fd.get('overBall'));
          resolve({
            outIndex: Number(fd.get('outIndex')),
            oversCompleted,
            ball,
            score: Number(fd.get('score')) || cur.runs,
          });
        });
      },
    });
  });

  const outName = pair[step1.outIndex] || `Batsman ${step1.outIndex + 1}`;

  let inBatsman = '';
  if (wicketNumber < 10) {
    inBatsman = await new Promise((resolve) => {
      const html = `
        <h2>New batsman</h2>
        <p class="meta">${esc(outName)} is out.</p>
        <form id="newbat-form">
          <div class="field"><label>Incoming batsman</label>
            <input name="name" list="bat-list" placeholder="Name" autofocus />
            <datalist id="bat-list">${battingLineup.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
          </div>
          <button type="submit" class="btn primary big">Confirm</button>
        </form>
      `;
      openModal(html, {
        onMount: (m) => {
          m.querySelector('#newbat-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const name = (new FormData(e.target).get('name') || '').trim();
            closeModal();
            resolve(name);
          });
        },
      });
    });
  } else {
    closeModal();
  }

  inn.fallOfWickets.push(newFowEntry({
    wicketNumber,
    oversCompleted: step1.oversCompleted,
    ball: step1.ball,
    score: step1.score,
    batsman1: pair[0],
    batsman2: pair[1],
    outBatsman: outName,
    inBatsman,
  }));
  const newPair = [...pair];
  newPair[step1.outIndex] = inBatsman;
  inn.currentBatsmen = newPair;

  await persist(match);
}

async function startNextInnings(match, navigate) {
  const last = lastInnings(match);
  const nextNumber = last.number + 1;
  let followOn = false;
  if (nextNumber === 3) {
    const i1 = getInnings(match, 1);
    const i2 = getInnings(match, 2);
    const lead = currentScore(i1).runs - currentScore(i2).runs;
    const threshold = followOnThreshold(match.scheduledDays);
    if (lead >= threshold) {
      followOn = confirm(`${teamName(match, battingSideForInnings(match, 1))} lead by ${lead} runs (≥ ${threshold}). Enforce the follow-on?\n\nOK = enforce follow-on, Cancel = bat again normally.`);
    }
  }
  const inn = newInnings(match, nextNumber, { followOn });
  const battingSide = nextNumber === 3
    ? battingSideForInnings(match, nextNumber, { followOnOverride: followOn })
    : battingSideForInnings(match, nextNumber);
  const openers = (match.lineups[battingSide] || []).slice(0, 2);
  while (openers.length < 2) openers.push('');
  inn.currentBatsmen = openers;
  match.innings.push(inn);
  await persist(match);
  navigate(`#/match/${match.id}/innings/${nextNumber}`);
}

// ------------------------------------------------------------ SCORECARD TAB

function renderScorecardTab(el, match) {
  const wrap = document.createElement('div');
  const summaryRows = [1, 2, 3, 4].map((n) => {
    const inn = getInnings(match, n);
    if (!inn) return null;
    const st = inningsRelativeState(match, n);
    const text = n < 4
      ? `${teamName(match, st.team)} ${st.verb === 'lead' ? 'leads' : 'trails'} by ${st.amount} with ${st.wicketsRemaining} wickets remaining`
      : `${teamName(match, st.team)} require ${st.amount} to win with ${st.wicketsRemaining} wickets remaining`;
    return `<div class="summary-row"><strong>Innings ${n}:</strong> ${esc(text)}</div>`;
  }).filter(Boolean).join('');

  wrap.innerHTML = `
    <div class="card">
      <h3>Summary</h3>
      ${summaryRows || '<p class="meta">Match not started</p>'}
    </div>
    <div class="card">
      <h3>Innings scores</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Team</th><th>Score</th><th>Overs</th><th>RR</th><th>Best stand</th></tr></thead>
          <tbody>
            ${match.innings.map((i) => {
              const sc = currentScore(i);
              const bp = bestPartnership(i);
              const side = battingSideForInnings(match, i.number);
              return `<tr>
                <td>${i.number}${i.followOn ? ' (f/on)' : ''}</td>
                <td>${esc(teamName(match, side))}</td>
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
  `;
  el.replaceChildren(wrap);
}

// --------------------------------------------------------- PARTNERSHIPS TAB

function renderPartnershipsCompareTab(el, match) {
  const wrap = document.createElement('div');
  const rows = partnershipsComparison(match);
  const headers = match.innings.map((i) => inningsSubTabLabel(match, i.number));
  wrap.innerHTML = `
    <div class="card">
      <h3>Partnerships across innings</h3>
      <p class="meta">Runs (balls faced, run rate) for each wicket, compared across every innings played so far.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Wkt</th>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>
            ${rows.map((r) => `<tr><td>${r.wicket}</td>${r.cells.map((c) => `<td>${c ? `${c.runs} (${c.balls}b, RR ${fmtRR(c.runRate)})` : '-'}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${headers.length + 1}" class="meta">No partnerships yet</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
  el.replaceChildren(wrap);
}

// ----------------------------------------------------------- MILESTONES TAB

function renderMilestonesCompareTab(el, match) {
  const wrap = document.createElement('div');
  const rows = milestonesComparison(match);
  const headers = match.innings.map((i) => inningsSubTabLabel(match, i.number));
  wrap.innerHTML = `
    <div class="card">
      <h3>Milestones across innings</h3>
      <p class="meta">Over.ball each team milestone was reached, compared across every innings played so far.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Runs</th>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>
            ${rows.map((r) => `<tr><td>${r.milestone}</td>${r.cells.map((c) => `<td>${c ? `${c.overs} ov` : '-'}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${headers.length + 1}" class="meta">No milestones reached yet</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
  `;
  el.replaceChildren(wrap);
}

// ------------------------------------------------------------- SESSIONS TAB

function sessionTimeLostCell(day, session) {
  const rec = day.sessions[session];
  const h = Math.floor((rec.lostMinutes || 0) / 60);
  const m = (rec.lostMinutes || 0) % 60;
  return `<td>
    <label style="display:flex;align-items:center;gap:4px;font-size:0.75rem;margin-bottom:6px;">
      <input type="checkbox" class="lost-toggle" data-day="${day.dayNumber}" data-session="${session}" ${rec.lost ? 'checked' : ''} /> Lost
    </label>
    ${rec.lost ? '<span class="meta">Session lost</span>' : `
      <div style="display:flex;gap:4px;align-items:center;">
        <input type="number" min="0" class="time-lost-h" data-day="${day.dayNumber}" data-session="${session}" value="${h}" style="width:56px;" /><span class="meta">h</span>
        <input type="number" min="0" max="59" class="time-lost-m" data-day="${day.dayNumber}" data-session="${session}" value="${m}" style="width:56px;" /><span class="meta">m</span>
      </div>
    `}
  </td>`;
}

function renderSessionsTab(el, match, rerender) {
  const wrap = document.createElement('div');
  const options = match.innings.map((i) => ({ value: i.number, label: inningsSubTabLabel(match, i.number) }));
  const selected = lastInnings(match)?.number ?? options[0]?.value;
  const overallRows = matchSessionSummary(match);
  const dayRows = daySummaries(match);

  wrap.innerHTML = `
    <div class="card">
      <h3>Current session</h3>
      <p class="meta">Day ${match.currentSession.day} - ${cap(match.currentSession.session)}. New overs are tagged with this automatically; use End Session / Mark Session Lost on the active innings tab to move on.</p>
    </div>
    <div class="card">
      <h3>Session-by-session (all innings combined)</h3>
      <p class="meta">Each session is expected to have ${30} overs. Green = ahead of that, red = behind, white = on pace. The expectation drops by 2 overs for every innings change during the session.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Day</th><th>Session</th><th>Runs</th><th>Wkts</th><th>Overs</th><th>RR</th></tr></thead>
          <tbody>
            ${overallRows.map((r) => {
              const rec = sessionRecord(match, r.day, r.session);
              if (rec?.lost) {
                return `<tr><td>${r.day}</td><td>${cap(r.session)}</td><td colspan="4" class="meta">Session lost</td></tr>`;
              }
              const expected = expectedOversForSession(match, r.day, r.session);
              return `<tr><td>${r.day}</td><td>${cap(r.session)}</td><td>${r.runs}</td><td>${r.wickets}</td><td>${r.overs} ${oversDiffSpan(r.oversDecimal, expected)}</td><td>${fmtRR(r.runRate)}</td></tr>`;
            }).join('') || '<tr><td colspan="6" class="meta">No play recorded yet</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <h3>Day-by-day</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Day</th><th>Runs</th><th>Wkts</th><th>Overs</th><th>RR</th></tr></thead>
          <tbody>
            ${dayRows.map((d) => {
              const expected = expectedOversForDay(match, d.day);
              return `<tr><td>${d.day}</td><td>${d.runs}</td><td>${d.wickets}</td><td>${d.overs} ${oversDiffSpan(d.oversDecimal, expected)}</td><td>${fmtRR(d.runRate)}</td></tr>`;
            }).join('') || '<tr><td colspan="5" class="meta">No play recorded yet</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <div class="field"><label>Innings (session breakdown)</label>
        <select id="inn-select">${options.map((o) => `<option value="${o.value}" ${o.value === selected ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
      </div>
      <div id="session-body"></div>
    </div>
    <div class="card">
      <h3>Time lost per session</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Day</th><th>Morning</th><th>Afternoon</th><th>Evening</th></tr></thead>
          <tbody>
            ${match.days.map((d) => `<tr><td>Day ${d.dayNumber}</td>${SESSIONS.map((s) => sessionTimeLostCell(d, s)).join('')}</tr>`).join('')}
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

  wrap.querySelectorAll('.lost-toggle').forEach((cb) => {
    cb.addEventListener('change', async () => {
      const day = ensureDayRecord(match, Number(cb.dataset.day));
      day.sessions[cb.dataset.session].lost = cb.checked;
      await persist(match);
      rerender();
    });
  });

  wrap.querySelectorAll('.time-lost-h, .time-lost-m').forEach((input) => {
    input.addEventListener('change', async () => {
      const dayNum = Number(input.dataset.day);
      const session = input.dataset.session;
      const day = ensureDayRecord(match, dayNum);
      const hInput = wrap.querySelector(`.time-lost-h[data-day="${dayNum}"][data-session="${session}"]`);
      const mInput = wrap.querySelector(`.time-lost-m[data-day="${dayNum}"][data-session="${session}"]`);
      const hours = Number(hInput.value) || 0;
      const mins = Number(mInput.value) || 0;
      day.sessions[session].lostMinutes = hours * 60 + mins;
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
              <option value="home" id="toss-home-option" ${match.toss.wonBy === 'home' ? 'selected' : ''}>${esc(match.homeTeam)}</option>
              <option value="away" id="toss-away-option" ${match.toss.wonBy === 'away' ? 'selected' : ''}>${esc(match.awayTeam)}</option>
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
          <div class="field"><label id="home-lineup-label">${esc(match.homeTeam)} line-up</label><textarea name="homeLineup">${esc((match.lineups.home || []).join('\n'))}</textarea></div>
          <div class="field"><label id="away-lineup-label">${esc(match.awayTeam)} line-up</label><textarea name="awayLineup">${esc((match.lineups.away || []).join('\n'))}</textarea></div>
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

  const infoForm = wrap.querySelector('#info-form');
  infoForm.homeTeam.addEventListener('input', () => {
    const name = infoForm.homeTeam.value || 'Home team';
    wrap.querySelector('#toss-home-option').textContent = name;
    wrap.querySelector('#home-lineup-label').textContent = `${name} line-up`;
  });
  infoForm.awayTeam.addEventListener('input', () => {
    const name = infoForm.awayTeam.value || 'Away team';
    wrap.querySelector('#toss-away-option').textContent = name;
    wrap.querySelector('#away-lineup-label').textContent = `${name} line-up`;
  });

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
    toast('Saved - toss/team changes now apply to every innings');
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
        await deleteMatch(match.id);
        navigate('#/');
      }
    }
  });
}
