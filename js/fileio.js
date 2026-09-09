// Export/import a match as a .json file. Primary path uses the File System
// Access API (Chrome/Edge on PC/ChromeOS) so the user picks their OneDrive-
// synced folder once and the app can then read/write it directly with no
// server round-trip. Safari (iPad/Mac) doesn't support that API, so it falls
// back to a plain download + <input type=file> open, which still works fine
// for saving into OneDrive via the iPadOS Files app share sheet.

import { saveFileHandle, getFileHandle } from './storage.js';
import { normalizeMatch } from './model.js';

export function hasFileSystemAccess() {
  return typeof window.showSaveFilePicker === 'function';
}

function suggestedName(match) {
  const date = (match.startDate || new Date().toISOString().slice(0, 10)).replaceAll('-', '');
  const safe = (s) => (s || 'Team').replace(/[^a-z0-9]+/gi, '');
  return `${safe(match.homeTeam)}-vs-${safe(match.awayTeam)}-${date}.json`;
}

async function writeToHandle(handle, match) {
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(match, null, 2));
  await writable.close();
}

/**
 * Save a match to disk. Reuses a previously-picked file handle when available
 * (silent save); otherwise prompts a Save-As dialog once and remembers it.
 */
export async function exportMatch(match, { forcePicker = false } = {}) {
  if (hasFileSystemAccess()) {
    let handle = forcePicker ? null : await getFileHandle(match.id);
    if (handle) {
      const perm = await handle.queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        const req = await handle.requestPermission({ mode: 'readwrite' });
        if (req !== 'granted') handle = null;
      }
    }
    if (!handle) {
      handle = await window.showSaveFilePicker({
        suggestedName: suggestedName(match),
        types: [{ description: 'Cricket match', accept: { 'application/json': ['.json'] } }],
      });
      await saveFileHandle(match.id, handle);
    }
    await writeToHandle(handle, match);
    return { method: 'filesystem', name: handle.name };
  }
  // Fallback: trigger a normal browser download. On iPad this opens the
  // share sheet / "Save to Files", where OneDrive can be chosen as the
  // destination if the OneDrive app is installed.
  const blob = new Blob([JSON.stringify(match, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName(match);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { method: 'download', name: suggestedName(match) };
}

/** Open a match from disk, either via the native picker or an <input type=file>. */
export async function importMatch() {
  if (hasFileSystemAccess()) {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: 'Cricket match', accept: { 'application/json': ['.json'] } }],
      multiple: false,
    });
    const file = await handle.getFile();
    const text = await file.text();
    const match = normalizeMatch(JSON.parse(text));
    await saveFileHandle(match.id, handle);
    return match;
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return reject(new Error('No file selected'));
      try {
        const text = await file.text();
        resolve(normalizeMatch(JSON.parse(text)));
      } catch (err) {
        reject(err);
      }
    };
    input.click();
  });
}
