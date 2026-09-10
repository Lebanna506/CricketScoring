// Small shared DOM helpers: toasts, modals, escaping.

export function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function toast(message, ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

export function openModal(innerHtml, { onMount } = {}) {
  const root = document.getElementById('modal-root');
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `<div class="modal">${innerHtml}</div>`;
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeModal();
  });
  root.appendChild(backdrop);
  if (onMount) onMount(backdrop.querySelector('.modal'));
  return backdrop;
}

export function closeModal() {
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
}

/**
 * A confirm() replacement that uses the app's own modal instead of the
 * browser's native dialog - which always shows the page's URL ("localhost
 * says...") and can't be restyled or given meaningful button labels.
 * Resolves true/false; clicking the backdrop counts as Cancel.
 */
export function confirmAction(message, { okLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      closeModal();
      resolve(result);
    };
    const html = `
      <p>${esc(message)}</p>
      <div class="btn-row" style="justify-content:flex-end; margin-top:14px;">
        <button type="button" class="btn ghost" data-confirm="cancel">${esc(cancelLabel)}</button>
        <button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-confirm="ok">${esc(okLabel)}</button>
      </div>
    `;
    const backdrop = openModal(html, {
      onMount: (m) => {
        m.querySelector('[data-confirm="ok"]').addEventListener('click', () => finish(true));
        m.querySelector('[data-confirm="cancel"]').addEventListener('click', () => finish(false));
      },
    });
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) finish(false);
    });
  });
}

export function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

export function fmtRR(rr) {
  if (rr === null || rr === undefined || Number.isNaN(rr)) return '-';
  return rr.toFixed(2);
}
