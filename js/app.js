import { renderLibrary } from './ui/library.js';
import { renderNewMatch } from './ui/newMatch.js';
import { renderScorer } from './ui/scorer.js';

const view = document.getElementById('view');
const brand = document.getElementById('brand-home');

function navigate(hash) {
  if (location.hash === hash) {
    route(); // same hash, e.g. re-clicking a tab - force re-render
  } else {
    location.hash = hash;
  }
}

function parseHash() {
  const hash = location.hash.replace(/^#\/?/, '');
  const parts = hash.split('/').filter(Boolean);
  return parts;
}

async function route() {
  const parts = parseHash();
  view.scrollTo?.(0, 0);
  if (parts.length === 0) {
    document.title = 'Test Cricket Scorer';
    await renderLibrary(view, navigate);
    return;
  }
  if (parts[0] === 'new') {
    document.title = 'New Match - Test Cricket Scorer';
    renderNewMatch(view, navigate);
    return;
  }
  if (parts[0] === 'match' && parts[1]) {
    const matchId = parts[1];
    const tab = parts[2] || 'score';
    document.title = 'Test Cricket Scorer';
    await renderScorer(view, navigate, matchId, tab);
    return;
  }
  await renderLibrary(view, navigate);
}

window.addEventListener('hashchange', route);
brand.addEventListener('click', () => navigate('#/'));

route();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // Offline support just won't be available this session - non-fatal.
    });
  });
}
