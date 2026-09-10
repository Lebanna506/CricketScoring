import { listMatches, deleteMatch, saveMatch } from '../storage.js';
import { matchStatusText } from '../calc.js';
import { esc, fmtDate, toast, confirmAction } from './common.js';
import { importMatch } from '../fileio.js';

export async function renderLibrary(container, navigate) {
  const matches = await listMatches();

  const root = document.createElement('div');
  root.innerHTML = `
    <div class="btn-row" style="margin-bottom:16px;">
      <button class="btn primary big" data-action="new-match" style="flex:1;">+ New Match</button>
      <button class="btn secondary" data-action="open-file">Open from file…</button>
    </div>
    ${matches.length === 0 ? `
      <div class="empty-state card">
        <h2>No matches yet</h2>
        <p>Start a new Test match, or open a previously saved match file (e.g. from your OneDrive folder).</p>
      </div>
    ` : `
      <h3>Your matches</h3>
      <div id="match-list"></div>
    `}
  `;
  container.replaceChildren(root);

  const listEl = root.querySelector('#match-list');
  if (listEl) {
    for (const m of matches) {
      const row = document.createElement('div');
      row.className = 'match-list-item';
      row.dataset.id = m.id;
      let status = 'Not started';
      try { status = matchStatusText(m); } catch { /* ignore malformed */ }
      row.innerHTML = `
        <div class="info">
          <div class="teams">${esc(m.homeTeam)} vs ${esc(m.awayTeam)}</div>
          <div class="status">${esc(status)}</div>
          <div class="status">${m.venue ? esc(m.venue) + ' · ' : ''}${fmtDate(m.startDate)} · updated ${fmtDate(m.updatedAt)}</div>
        </div>
        <div class="btn-row">
          <button class="btn secondary" data-action="open" data-id="${m.id}">Open</button>
          <button class="btn ghost" data-action="export" data-id="${m.id}">Export</button>
          <button class="btn danger" data-action="delete" data-id="${m.id}">Delete</button>
        </div>
      `;
      listEl.appendChild(row);
    }
  }

  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'new-match') navigate('#/new');
    if (action === 'open') navigate(`#/match/${btn.dataset.id}/innings`);
    if (action === 'delete') {
      if (await confirmAction('Delete this match from this device? (Export it first if you want to keep a copy.)', { okLabel: 'Delete', danger: true })) {
        await deleteMatch(btn.dataset.id);
        renderLibrary(container, navigate);
      }
    }
    if (action === 'export') {
      const match = matches.find((m) => m.id === btn.dataset.id);
      const { exportMatch } = await import('../fileio.js');
      try {
        await exportMatch(match, { forcePicker: true });
        toast('Match exported');
      } catch (err) {
        if (err?.name !== 'AbortError') toast('Export failed: ' + err.message);
      }
    }
    if (action === 'open-file') {
      try {
        const match = await importMatch();
        await saveMatch(match);
        toast('Match imported');
        navigate(`#/match/${match.id}/innings`);
      } catch (err) {
        if (err?.name !== 'AbortError') toast('Import failed: ' + err.message);
      }
    }
  });
}
