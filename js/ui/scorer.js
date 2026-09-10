import { loadMatch, saveMatch, deleteMatch } from '../storage.js';
import { exportMatch } from '../fileio.js';
import {
  newOverEntry, newFowEntry, newInnings, teamName, SESSIONS, advanceSession,
  inningsOrdinalForTeam, emptySessionRecord, ballsToOverString,
} from '../model.js';
import {
  currentScore, isInningsClosed, partnerships, bestPartnership, teamMilestones,
  teamCenturies, crossedMilestones, sessionSummary, matchSessionSummary, daySummaries,
  matchStatusText, followOnThreshold, requiredRunRate, sortedOvers, overByOverSeries,
  ballSummary, inningsRelativeState, partnershipsComparison, milestonesComparison,
  centuriesComparison, sessionRecord, expectedOversForSession, expectedOversForDay,
  battingSideForInnings, oppositeSide, availableBatsmen,
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

function overRunsLabel(row) {
  if (row.runs !== 0) return String(row.runs);
  return row.wicketInOver ? 'W' : 'M';
}

function last5OversLabel(row) {
  if (row.last5OversRR === null) return '-';
  return `${fmtRR(row.last5OversRR)} (${row.last5OversRuns})`;
}

function ordinal(n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  const suffix = ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
  return `${n}${suffix}`;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// --- Over.ball picker: an editable over number plus a 7-button grid for the
// ball within that over (.0-.6), used anywhere a modal needs to record the
// exact moment something happened (a wicket, a milestone).

function overBallField(name, defaultOver, defaultBall) {
  return `
    <div class="grid cols-2">
      <div class="field"><label>Over</label><input name="${name}Over" type="number" min="0" value="${defaultOver}" required /></div>
      <div class="field">
        <label>Ball</label>
        <div class="ball-grid" data-ball-group="${name}">
          ${[0, 1, 2, 3, 4, 5, 6].map((b) => `<button type="button" class="ball-btn ${b === defaultBall ? 'selected' : ''}" data-ball="${b}">.${b}</button>`).join('')}
        </div>
        <input type="hidden" name="${name}Ball" value="${defaultBall}" />
      </div>
    </div>
  `;
}

function wireBallGrids(container) {
  container.querySelectorAll('[data-ball-group]').forEach((grid) => {
    const hidden = container.querySelector(`input[name="${grid.dataset.ballGroup}Ball"]`);
    grid.querySelectorAll('.ball-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        grid.querySelectorAll('.ball-btn').forEach((b) => b.classList.remove('selected'));
        btn.classList.add('selected');
        hidden.value = btn.dataset.ball;
      });
    });
  });
}

function readOverBall(fd, name) {
  return { oversCompleted: Number(fd.get(`${name}Over`)) || 0, ball: Number(fd.get(`${name}Ball`)) || 0 };
}

// --- Keyboard quick-entry: an opt-in toggle so a PC/iPad keyboard's number
// row can log an over as fast as tapping the pad - handy for catching up on
// overs entered late. Only one listener is ever live at a time.

const KBD_ENTRY_KEY = 'cricket-scorer-kbd-entry';
let activeKeydownHandler = null;

function getKeyboardEntryEnabled() {
  try { return localStorage.getItem(KBD_ENTRY_KEY) === '1'; } catch { return false; }
}
function setKeyboardEntryEnabled(value) {
  try { localStorage.setItem(KBD_ENTRY_KEY, value ? '1' : '0'); } catch { /* private mode etc - just won't persist */ }
}

function isTypingField(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el.type || 'text').toLowerCase();
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range'].includes(type);
  }
  return false;
}

function teardownKeyboardEntry() {
  if (activeKeydownHandler) {
    document.removeEventListener('keydown', activeKeydownHandler);
    activeKeydownHandler = null;
  }
}

function setupKeyboardEntry(match, inn, rerender, enabled) {
  teardownKeyboardEntry();
  if (!enabled) return;
  activeKeydownHandler = (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTypingField(e.target)) return;
    if (document.querySelector('.modal-backdrop')) return;
    if (isInningsClosed(inn)) return;
    if (!/^[0-9]$/.test(e.key)) return;
    e.preventDefault();
    saveOver(match, inn, Number(e.key)).then(rerender);
  };
  document.addEventListener('keydown', activeKeydownHandler);
}

function inningsSubTabLabel(match, number) {
  const side = battingSideForInnings(match, number);
  const ordinal = inningsOrdinalForTeam(match, number) === 1 ? '1st' : '2nd';
  return `${teamName(match, side)} ${ordinal} Innings`;
}

// Cricket overs aren't true decimal (each over is 6 balls, not 10), so the
// gap between actual and expected overs has to be computed in balls and
// converted back to over.ball notation - subtracting the decimal forms
// directly (e.g. "72.5" as 72.5) gives a number that looks plausible but is
// wrong by a few tenths.
function oversDiffSpan(actualBalls, expectedOvers) {
  const diffBalls = actualBalls - expectedOvers * 6;
  const cls = diffBalls > 0 ? 'badge-ahead' : diffBalls < 0 ? 'badge-behind' : 'badge-exact';
  const sign = diffBalls > 0 ? '+' : diffBalls < 0 ? '-' : '';
  return `<span class="${cls}">(${sign}${ballsToOverString(Math.abs(diffBalls))})</span>`;
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

  if (tab !== 'innings') teardownKeyboardEntry();

  try {
    switch (tab) {
      case 'innings': renderInningsTab(contentEl, match, navigate, rerender, sub); break;
      case 'scorecard': renderScorecardTab(contentEl, match); break;
      case 'partnerships': renderPartnershipsCompareTab(contentEl, match); break;
      case 'milestones': renderMilestonesCompareTab(contentEl, match); break;
      case 'sessions': renderSessionsTab(contentEl, match, rerender); break;
      case 'info': renderInfoTab(contentEl, match, rerender, navigate); break;
      default: renderInningsTab(contentEl, match, navigate, rerender, sub);
    }
  } catch (err) {
    console.error('Failed to render tab', tab, err);
    contentEl.innerHTML = `
      <div class="card">
        <h3>Something went wrong showing this tab</h3>
        <p class="meta">${esc(err.message)}</p>
        <p class="meta">This can happen with a match saved by an older version of the app. Try reopening it, or export it from the library first if you want to keep a backup.</p>
      </div>
    `;
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
  const closed = isInningsClosed(inn);
  const battingSide = battingSideForInnings(match, inn.number);
  const battingLineup = match.lineups[battingSide] || [];

  if (isActive && !closed) {
    setupKeyboardEntry(match, inn, rerender, getKeyboardEntryEnabled());
  } else {
    teardownKeyboardEntry();
  }

  wrap.innerHTML = `
    <div class="tabs sub-tabs" id="innings-subtabs">
      ${match.innings.map((i) => `<button data-subtab="${i.number}" class="${i.number === inn.number ? 'active' : ''}">${esc(inningsSubTabLabel(match, i.number))}</button>`).join('')}
    </div>
    <div class="innings-dashboard">
      <div class="dash-left">
        ${partnershipFowCard(inn)}
      </div>
      <div class="dash-right">
        <div class="score-and-pad">
          <div class="score-col">
            ${scoreHeroCard(match, inn)}
            <div class="grid cols-2">
              ${milestonesCardInnings(inn)}
              ${centuriesCardInnings(inn)}
            </div>
            ${ballSummaryCard(inn)}
          </div>
          ${isActive && !closed ? sidePanelCard(inn) : ''}
        </div>
        ${inn.number === 4 ? requiredRunRateCard(match, inn) : ''}
        ${isActive && closed ? nextInningsCard(match, inn) : ''}
        ${oversTableCard(inn)}
      </div>
    </div>
  `;
  el.replaceChildren(wrap);

  wrap.querySelector('#innings-subtabs').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-subtab]');
    if (btn) navigate(`#/match/${match.id}/innings/${btn.dataset.subtab}`);
  });

  const editState = wireEditableNames(wrap, match, inn, rerender, battingLineup);

  const kbdToggle = wrap.querySelector('#kbd-entry-toggle');
  if (kbdToggle) {
    kbdToggle.addEventListener('change', () => {
      setKeyboardEntryEnabled(kbdToggle.checked);
      setupKeyboardEntry(match, inn, rerender, kbdToggle.checked);
      wrap.querySelector('.side-panel')?.classList.toggle('kbd-active', kbdToggle.checked);
    });
  }

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
    // If a name picker is still open, force it to commit and finish saving
    // before this action starts - otherwise the two saves can race and the
    // picker's (now-stale) rerender can land last and undo this action.
    const openEditor = wrap.querySelector('.editable-name-input');
    if (openEditor) openEditor.blur();
    if (editState.pending) await editState.pending;
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
        const removedWickets = inn.fallOfWickets.filter((w) => w.oversCompleted + 1 === lastOver.overNumber);
        inn.fallOfWickets = inn.fallOfWickets.filter((w) => w.oversCompleted + 1 !== lastOver.overNumber);
        // Removing a wicket must also undo the batsman substitution it caused -
        // otherwise the incoming batsman (or, for the 10th wicket, a blank slot)
        // stays "in" with no matching fall-of-wicket record, and the outgoing
        // batsman silently vanishes from the current pair. Match by which slot
        // (batsman1/batsman2) the wicket actually came from, not by searching
        // for the incoming name, so this also works for the all-out 10th wicket
        // where there was no incoming batsman to search for. Undo in reverse
        // ball order so a multi-wicket over unwinds in the order it happened.
        [...removedWickets].sort((a, b) => b.ball - a.ball).forEach((w) => {
          const idx = w.batsman2 === w.outBatsman ? 1 : 0;
          inn.currentBatsmen[idx] = w.outBatsman;
        });
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
    <div class="card score-card">
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

function sidePanelCard(inn) {
  const cur = currentScore(inn);
  const nextOver = sortedOvers(inn).length + 1;
  const keys = [1, 2, 3, 4, 5, 6, 7, 8, 9, 'M', 10, '10+'];
  const kbdOn = getKeyboardEntryEnabled();
  return `
    <div class="card side-panel ${kbdOn ? 'kbd-active' : ''}">
      <div class="meta" style="margin-bottom:6px;">Over ${nextOver} - runs</div>
      <div class="numpad-phone">
        ${keys.map((k) => {
          if (k === 'M') return `<button class="numpad-btn" data-action="set-runs" data-value="0" title="Maiden">M</button>`;
          if (k === '10+') return `<button class="numpad-btn numpad-more" data-action="set-runs-custom">10+</button>`;
          return `<button class="numpad-btn" data-action="set-runs" data-value="${k}">${k}</button>`;
        }).join('')}
      </div>
      <label class="kbd-toggle">
        <input type="checkbox" id="kbd-entry-toggle" ${kbdOn ? 'checked' : ''} />
        Keyboard entry (press 0-9 to score, catching up on overs)
      </label>
      <div class="btn-row side-actions">
        <button class="btn warn" data-action="wicket" ${cur.wickets >= 10 ? 'disabled' : ''}>Wicket</button>
        <button class="btn secondary" data-action="end-session">End Session</button>
        <button class="btn secondary" data-action="new-ball">New Ball</button>
        <button class="btn ghost" data-action="mark-session-lost">Session Lost</button>
        <button class="btn warn" data-action="declare">Declare</button>
        <button class="btn ghost" data-action="undo" ${sortedOvers(inn).length === 0 ? 'disabled' : ''}>Undo</button>
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
  const rows = overByOverSeries(inn);
  if (rows.length === 0) {
    return `<div class="card overs-card-fit"><h3>Overs</h3><p class="meta">No overs yet</p></div>`;
  }
  const columns = chunkArray(rows, 50);
  return `
    <div class="card overs-card-fit">
      <h3>Overs</h3>
      <div class="overs-columns">
        ${columns.map((col) => `
          <div class="table-wrap overs-col">
            <table class="compact-table">
              <thead><tr><th>Ov</th><th>Score</th><th>RR</th><th>R</th><th>5ovr</th></tr></thead>
              <tbody>
                ${col.map((r) => `<tr><td>${r.overNumber}</td><td>${r.cumRuns}/${r.cumWickets}</td><td>${fmtRR(r.runRate)}</td><td>${overRunsLabel(r)}</td><td>${last5OversLabel(r)}</td></tr>`).join('')}
              </tbody>
            </table>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function ballSummaryCard(inn) {
  const rows = ballSummary(inn);
  return `
    <div class="card">
      <h3>By ball</h3>
      <div class="table-wrap">
        <table class="compact-table">
          <thead><tr><th>Ball</th><th>Ovs</th><th>R</th><th>W</th><th>RR</th></tr></thead>
          <tbody>
            ${rows.map((r) => `<tr><td>${r.ballNumber}</td><td>${r.overs}</td><td>${r.runs}</td><td>${r.wickets}</td><td>${fmtRR(r.runRate)}</td></tr>`).join('') || '<tr><td colspan="5" class="meta">No overs yet</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/** Combined fall-of-wickets + partnerships list: one row per stand, batsmen colored by status. */
function partnershipFowCard(inn) {
  const parts = partnerships(inn);
  const best = bestPartnership(inn);
  const fowByWicket = new Map(inn.fallOfWickets.map((w) => [w.wicketNumber, w]));
  return `
    <div class="card">
      <h3>Partnerships</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Wkt</th><th>Batsmen</th><th>Runs</th><th>Balls</th><th>RR</th><th>Fell at</th></tr></thead>
          <tbody>
            ${parts.map((p) => partnershipRow(p, fowByWicket.get(p.wicketNumber), best)).join('') || '<tr><td colspan="6" class="meta">No partnerships yet</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function partnershipRow(p, fow, best) {
  const highlight = best && p.broken && p.wicketNumber === best.wicketNumber ? 'highlight' : '';
  let batsmenHtml;
  if (!p.broken) {
    batsmenHtml = `
      ${editableNameSpan(p.batsman1, 'bat-neutral', { row: 'current', idx: '0' })}
      &amp;
      ${editableNameSpan(p.batsman2, 'bat-neutral', { row: 'current', idx: '1' })}
    `;
  } else {
    const b1Out = !!fow && fow.batsman1 === fow.outBatsman;
    const b2Out = !!fow && fow.batsman2 === fow.outBatsman;
    batsmenHtml = `
      ${editableNameSpan(p.batsman1, b1Out ? 'bat-out' : 'bat-notout', { row: 'fow', fowId: fow?.id, field: 'batsman1' })}
      &amp;
      ${editableNameSpan(p.batsman2, b2Out ? 'bat-out' : 'bat-notout', { row: 'fow', fowId: fow?.id, field: 'batsman2' })}
    `;
  }
  const fellAt = fow ? `${fow.score} (${fow.oversCompleted}.${fow.ball})` : '-';
  return `<tr class="${highlight}">
    <td>${p.wicketNumber}</td>
    <td>${batsmenHtml}</td>
    <td>${p.runs}</td>
    <td>${p.balls}</td>
    <td>${fmtRR(p.runRate)}</td>
    <td>${fellAt}</td>
  </tr>`;
}

function editableNameSpan(name, colorClass, dataAttrs) {
  const attrs = Object.entries(dataAttrs).map(([k, v]) => `data-${k}="${esc(v ?? '')}"`).join(' ');
  const label = name ? esc(name) : '<span class="meta">Add name</span>';
  return `<span class="editable-name ${colorClass}" ${attrs}>${label}</span>`;
}

/**
 * Click any batsman name (current pair or a historical fall-of-wicket entry)
 * to rename it. Returns a small state object exposing `.pending` - the
 * in-flight save promise for whichever name is currently being edited, if
 * any - so callers can await it before starting another action. Without
 * that, a still-open picker's save and a newly-started action's save can
 * race, and whichever one's rerender lands last silently wins, discarding
 * the other.
 */
function wireEditableNames(wrap, match, inn, rerender, battingLineup) {
  const state = { pending: null };

  wrap.querySelectorAll('.editable-name').forEach((span) => {
    span.addEventListener('click', () => {
      const isCurrentRow = span.dataset.row === 'current';
      const currentValue = isCurrentRow
        ? (inn.currentBatsmen[Number(span.dataset.idx)] || '')
        : (inn.fallOfWickets.find((w) => w.id === span.dataset.fowId)?.[span.dataset.field] || '');

      const commit = async (newName) => {
        if (isCurrentRow) {
          inn.currentBatsmen[Number(span.dataset.idx)] = newName;
        } else {
          const w = inn.fallOfWickets.find((x) => x.id === span.dataset.fowId);
          if (w) {
            const field = span.dataset.field;
            const oldVal = w[field];
            w[field] = newName;
            if (oldVal && oldVal === w.outBatsman) w.outBatsman = newName;
          }
        }
        await persist(match);
        state.pending = null;
        rerender();
      };

      if (battingLineup.length > 0) {
        // A batting order was given in Match Info - always pick from it.
        const select = document.createElement('select');
        select.className = 'editable-name-input';
        const blank = document.createElement('option');
        blank.value = '';
        blank.textContent = '- clear -';
        select.appendChild(blank);
        battingLineup.forEach((name) => {
          const opt = document.createElement('option');
          opt.value = name;
          opt.textContent = name;
          if (name === currentValue) opt.selected = true;
          select.appendChild(opt);
        });
        span.replaceWith(select);
        select.focus();
        // Commit on blur only (not on every 'change') - committing mid-selection
        // would tear down and rebuild the DOM while the browser's native picker
        // is still in the middle of the user's interaction, e.g. keyboard
        // navigation firing several 'change' events before a final choice.
        select.addEventListener('blur', () => { state.pending = commit(select.value); }, { once: true });
      } else {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = currentValue;
        input.className = 'editable-name-input';
        input.placeholder = 'Name';
        span.replaceWith(input);
        input.focus();
        input.select();
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
        });
        input.addEventListener('blur', () => { state.pending = commit(input.value.trim()); }, { once: true });
      }
    });
  });

  return state;
}

function milestonesCardInnings(inn) {
  const ms = teamMilestones(inn);
  return `
    <div class="card">
      <h3>Half-Centuries</h3>
      <div class="table-wrap">
        <table class="compact-table">
          <thead><tr><th>Runs</th><th>At</th><th>RR</th></tr></thead>
          <tbody>
            ${ms.map((m) => `<tr><td>${m.milestone}</td><td>${m.overs}</td><td>${fmtRR(m.runRateForSegment)}</td></tr>`).join('') || '<tr><td colspan="3" class="meta">None yet</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

/** Centuries only (100, 200...), each with its own 51-100 segment pace and the full 0-100 pace. */
function centuriesCardInnings(inn) {
  const cs = teamCenturies(inn);
  return `
    <div class="card">
      <h3>Centuries</h3>
      <div class="table-wrap">
        <table class="compact-table">
          <thead><tr><th>Runs</th><th>At</th><th>RR</th></tr></thead>
          <tbody>
            ${cs.map((m) => `<tr><td>${m.milestone}</td><td>${m.overs}</td><td>${fmtRR(m.runRate)}</td></tr>`).join('') || '<tr><td colspan="3" class="meta">None yet</td></tr>'}
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
          ${overBallField('ms', overNumber - 1, 6)}
          <button type="submit" class="btn primary big">Confirm</button>
        </form>
      `;
      openModal(html, {
        onMount: (m) => {
          wireBallGrids(m);
          m.querySelector('#milestone-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const { oversCompleted, ball } = readOverBall(new FormData(e.target), 'ms');
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
        ${overBallField('wkt', nextOverNumber - 1, 1)}
        <div class="field"><label>Team score</label><input name="score" type="number" value="${cur.runs}" required /></div>
        <button type="submit" class="btn primary big">Next: new batsman</button>
      </form>
    `;
    openModal(html, {
      onMount: (m) => {
        wireBallGrids(m);
        m.querySelector('#wicket-form').addEventListener('submit', (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const { oversCompleted, ball } = readOverBall(fd, 'wkt');
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
    const options = availableBatsmen(battingLineup, inn);
    const suggested = options[0] || '';
    const hasLineup = options.length > 0;
    inBatsman = await new Promise((resolve) => {
      const html = `
        <h2>New batsman</h2>
        <p class="meta">${esc(outName)} is out.</p>
        <form id="newbat-form">
          ${hasLineup ? `
            <div class="field"><label>Incoming batsman</label>
              <select name="name">
                ${options.map((n) => `<option value="${esc(n)}" ${n === suggested ? 'selected' : ''}>${esc(n)}</option>`).join('')}
              </select>
            </div>
          ` : `
            <div class="field"><label>Incoming batsman</label>
              <input name="name" placeholder="Name" autofocus />
            </div>
          `}
          <button type="submit" class="btn primary big">Confirm</button>
        </form>
      `;
      openModal(html, {
        onMount: (m) => {
          const form = m.querySelector('#newbat-form');
          form.addEventListener('submit', (e) => {
            e.preventDefault();
            const name = new FormData(form).get('name') || '';
            closeModal();
            resolve(name.trim());
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
    day: match.currentSession.day,
    session: match.currentSession.session,
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
                <td>${bp ? `${bp.runs} (${ordinal(bp.wicketNumber)} Wicket)` : '-'}</td>
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
      <p class="meta">Runs, balls faced and run rate for each wicket, compared across every innings played so far.</p>
      <div class="table-wrap">
        <table class="partnerships-compare">
          <thead>
            <tr><th rowspan="2">Wkt</th>${headers.map((h) => `<th colspan="3" class="grp-start">${esc(h)}</th>`).join('')}</tr>
            <tr>${headers.map(() => `<th class="grp-start">Runs</th><th>Balls</th><th>RR</th>`).join('')}</tr>
          </thead>
          <tbody>
            ${rows.map((r) => `<tr><td>${r.wicket}</td>${r.cells.map((c) => c
              ? `<td class="grp-start">${c.runs}</td><td>${c.balls}</td><td>${fmtRR(c.runRate)}</td>`
              : `<td class="grp-start meta">-</td><td class="meta">-</td><td class="meta">-</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${headers.length * 3 + 1}" class="meta">No partnerships yet</td></tr>`}
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
  const centuryRows = centuriesComparison(match);
  const headers = match.innings.map((i) => inningsSubTabLabel(match, i.number));
  wrap.innerHTML = `
    <div class="card">
      <h3>Half-Centuries across Innings</h3>
      <p class="meta">50-run milestones, compared across every innings played so far.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Runs</th>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>
            ${rows.map((r) => `<tr><td>${r.milestone}</td>${r.cells.map((c) => `<td>${c ? `${c.overs} ov (RR ${fmtRR(c.runRate)})` : '-'}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${headers.length + 1}" class="meta">No milestones reached yet</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <h3>Centuries across innings</h3>
      <p class="meta">100-run milestones, compared across every innings played so far.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Runs</th>${headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>
            ${centuryRows.map((r) => `<tr><td>${r.milestone}</td>${r.cells.map((c) => `<td>${c ? `${c.overs} ov (RR ${fmtRR(c.runRate)})` : '-'}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${headers.length + 1}" class="meta">No centuries reached yet</td></tr>`}
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
  const curStats = overallRows.find((r) => r.day === match.currentSession.day && r.session === match.currentSession.session);

  wrap.innerHTML = `
    <div class="card">
      <h3>Current session</h3>
      <p>Day ${match.currentSession.day} - ${cap(match.currentSession.session)}${curStats ? `: ${curStats.runs} runs, ${curStats.wickets} wkts (${curStats.overs} ov, RR ${fmtRR(curStats.runRate)})` : ' - no play yet'}</p>
      <div class="btn-row">
        <button class="btn secondary" data-action="end-session-retro">End this session…</button>
      </div>
    </div>
    <div class="card">
      <h3>Session-by-session (all innings combined)</h3>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Day</th><th>Session</th><th>Runs</th><th>Wkts</th><th>Overs</th><th>RR</th></tr></thead>
          <tbody>
            ${overallRows.map((r, idx) => {
              const rowClass = `${r.day % 2 === 0 ? 'day-even' : 'day-odd'}${idx === 0 || overallRows[idx - 1].day !== r.day ? ' day-start' : ''}`;
              const rec = sessionRecord(match, r.day, r.session);
              if (rec?.lost) {
                return `<tr class="${rowClass}"><td>${r.day}</td><td>${cap(r.session)}</td><td colspan="4" class="meta">Session lost</td></tr>`;
              }
              const expected = expectedOversForSession(match, r.day, r.session);
              return `<tr class="${rowClass}"><td>${r.day}</td><td>${cap(r.session)}</td><td>${r.runs}</td><td>${r.wickets}</td><td>${r.overs} ${oversDiffSpan(r.ballsBowled, expected)}</td><td>${fmtRR(r.runRate)}</td></tr>`;
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
              return `<tr><td>${d.day}</td><td>${d.runs}</td><td>${d.wickets}</td><td>${d.overs} ${oversDiffSpan(d.ballsBowled, expected)}</td><td>${fmtRR(d.runRate)}</td></tr>`;
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
    <details class="card">
      <summary>Time lost per session</summary>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Day</th><th>Morning</th><th>Afternoon</th><th>Evening</th></tr></thead>
          <tbody>
            ${match.days.map((d) => `<tr><td>Day ${d.dayNumber}</td>${SESSIONS.map((s) => sessionTimeLostCell(d, s)).join('')}</tr>`).join('')}
          </tbody>
        </table>
      </div>
    </details>
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

  wrap.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action="end-session-retro"]');
    if (!btn) return;
    await retroactiveEndSession(match, rerender);
  });
}

/**
 * Ends the current session as of a chosen innings/over rather than "right
 * now" - for catching up on overs after the fact, when the session actually
 * ended a few overs before the scorer got around to entering them. Any
 * overs/wickets recorded past that point move to the next session.
 */
async function retroactiveEndSession(match, rerender) {
  const target = lastInnings(match);
  if (!target) { toast('No innings started yet'); return; }

  const choice = await new Promise((resolve) => {
    const defaultOver = sortedOvers(target).length;
    const html = `
      <h2>End ${cap(match.currentSession.session)} session (Day ${match.currentSession.day})</h2>
      <p class="meta">Pick the innings and last over that were actually part of this session - anything recorded after that moves to the next session.</p>
      <form id="end-session-form">
        <div class="field"><label>Innings</label>
          <select name="innings">
            ${match.innings.map((i) => `<option value="${i.number}" ${i.number === target.number ? 'selected' : ''}>${esc(inningsSubTabLabel(match, i.number))}</option>`).join('')}
          </select>
        </div>
        <div class="field"><label>Last over of this session</label><input name="lastOver" type="number" min="0" value="${defaultOver}" required /></div>
        <button type="submit" class="btn primary big">End session</button>
      </form>
    `;
    openModal(html, {
      onMount: (m) => {
        m.querySelector('#end-session-form').addEventListener('submit', (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          closeModal();
          resolve({ inningsNumber: Number(fd.get('innings')), lastOver: Number(fd.get('lastOver')) });
        });
      },
    });
  });

  const inn = getInnings(match, choice.inningsNumber);
  if (!inn) return;
  const nextSession = advanceSession(match.currentSession);
  inn.overs.forEach((o) => {
    if (o.overNumber > choice.lastOver) { o.day = nextSession.day; o.session = nextSession.session; }
  });
  inn.fallOfWickets.forEach((w) => {
    if (w.oversCompleted + 1 > choice.lastOver) { w.day = nextSession.day; w.session = nextSession.session; }
  });
  match.currentSession = nextSession;
  await persist(match);
  rerender();
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
