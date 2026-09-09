import { newMatch, newInnings } from '../model.js';
import { saveMatch } from '../storage.js';
import { toast } from './common.js';

export function renderNewMatch(container, navigate) {
  const root = document.createElement('div');
  root.innerHTML = `
    <div class="card">
      <h2>New Test Match</h2>
      <form id="new-match-form">
        <div class="grid cols-2">
          <div class="field">
            <label>Home team</label>
            <input name="homeTeam" required placeholder="e.g. Australia" />
          </div>
          <div class="field">
            <label>Away team</label>
            <input name="awayTeam" required placeholder="e.g. England" />
          </div>
        </div>
        <div class="grid cols-2">
          <div class="field">
            <label>Venue</label>
            <input name="venue" placeholder="e.g. The Gabba, Brisbane" />
          </div>
          <div class="field">
            <label>Start date</label>
            <input type="date" name="startDate" />
          </div>
        </div>
        <div class="field">
          <label>Scheduled length (days)</label>
          <select name="scheduledDays">
            <option value="5" selected>5 days</option>
            <option value="4">4 days</option>
            <option value="3">3 days</option>
            <option value="2">2 days</option>
            <option value="1">1 day</option>
          </select>
        </div>
        <h3>Toss</h3>
        <div class="grid cols-2">
          <div class="field">
            <label>Won by</label>
            <select name="tossWonBy">
              <option value="home">Home team</option>
              <option value="away">Away team</option>
            </select>
          </div>
          <div class="field">
            <label>Elected to</label>
            <select name="tossDecision">
              <option value="bat">Bat</option>
              <option value="bowl">Bowl</option>
            </select>
          </div>
        </div>
        <h3>Line-ups (optional, one name per line)</h3>
        <div class="grid cols-2">
          <div class="field">
            <label id="home-lineup-label">Home line-up</label>
            <textarea name="homeLineup" placeholder="1. Opener&#10;2. Opener&#10;..."></textarea>
          </div>
          <div class="field">
            <label id="away-lineup-label">Away line-up</label>
            <textarea name="awayLineup" placeholder="1. Opener&#10;2. Opener&#10;..."></textarea>
          </div>
        </div>
        <div class="btn-row">
          <button type="submit" class="btn primary big">Start Match</button>
          <button type="button" class="btn ghost" data-action="cancel">Cancel</button>
        </div>
      </form>
    </div>
  `;
  container.replaceChildren(root);

  const form = root.querySelector('#new-match-form');
  const homeInput = form.homeTeam;
  const awayInput = form.awayTeam;
  homeInput.addEventListener('input', () => {
    root.querySelector('#home-lineup-label').textContent = `${homeInput.value || 'Home'} line-up`;
  });
  awayInput.addEventListener('input', () => {
    root.querySelector('#away-lineup-label').textContent = `${awayInput.value || 'Away'} line-up`;
  });

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-action="cancel"]')) navigate('#/');
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const match = newMatch({
      homeTeam: fd.get('homeTeam').trim(),
      awayTeam: fd.get('awayTeam').trim(),
      venue: fd.get('venue').trim(),
      startDate: fd.get('startDate') || null,
      scheduledDays: Number(fd.get('scheduledDays')),
    });
    match.toss = { wonBy: fd.get('tossWonBy'), decision: fd.get('tossDecision') };
    match.lineups.home = (fd.get('homeLineup') || '').split('\n').map((s) => s.trim()).filter(Boolean);
    match.lineups.away = (fd.get('awayLineup') || '').split('\n').map((s) => s.trim()).filter(Boolean);
    match.innings.push(newInnings(match, 1));
    await saveMatch(match);
    toast('Match created');
    navigate(`#/match/${match.id}/score`);
  });
}
