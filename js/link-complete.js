// Link autocomplete for SatoriLite
// Provides a dropdown suggesting file paths when typing [
import { getEditorView } from './editor.js';
import { getFilePaths } from './search.js';

// Module state
let dropdownEl = null;
let filePaths = [];
let selectedIdx = 0;
let isActive = false;
let startPos = -1; // position right after the opening [
let listenerAttached = false;

/**
 * Initialize link autocomplete
 * Listens for vault/tree events and attaches editor listeners
 */
export function initLinkComplete() {
  window.addEventListener('satorilite:vault-open', rebuildPaths);
  window.addEventListener('satorilite:tree-refresh', rebuildPaths);
  window.addEventListener('satorilite:file-loaded', attachListener);
  createDropdown();
}

/**
 * Rebuild file paths from search index
 */
function rebuildPaths() {
  filePaths = getFilePaths();
}

/**
 * Create the dropdown element (hidden by default)
 */
function createDropdown() {
  dropdownEl = document.createElement('div');
  dropdownEl.className = 'link-complete-dropdown hidden';
  document.body.appendChild(dropdownEl);
}

/**
 * Attach keyup/keydown listeners to the CM content element
 */
function attachListener() {
  if (listenerAttached) return;
  const view = getEditorView();
  if (!view) return;

  const cmContent = view.dom.querySelector('.cm-content');
  if (!cmContent) return;

  cmContent.addEventListener('keydown', handleKeydown);
  cmContent.addEventListener('input', handleInput);
  // Dismiss on blur or click outside
  document.addEventListener('click', handleDocumentClick);
  listenerAttached = true;
}

/**
 * Handle input events to detect [ and filter matches
 */
function handleInput() {
  const view = getEditorView();
  if (!view) return;

  const state = view.state;
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const textBefore = line.text.slice(0, head - line.from);

  // Find the last unclosed [ on this line
  const lastOpen = textBefore.lastIndexOf('[');
  const lastClose = textBefore.lastIndexOf(']');

  if (lastOpen >= 0 && lastOpen > lastClose) {
    // We're inside an unclosed [
    const query = textBefore.slice(lastOpen + 1);

    // Don't activate if it looks like a markdown link already (has ](
    if (query.includes('](')) {
      dismiss();
      return;
    }

    startPos = line.from + lastOpen;
    const matches = filterPaths(query);

    if (matches.length > 0) {
      showDropdown(matches, head);
    } else {
      dismiss();
    }
  } else {
    dismiss();
  }
}

/**
 * Handle keydown for navigation within the dropdown
 */
function handleKeydown(e) {
  if (!isActive) return;

  if (e.key === 'ArrowDown') {
    e.preventDefault();
    e.stopPropagation();
    selectedIdx = Math.min(selectedIdx + 1, dropdownEl.children.length - 1);
    updateSelection();
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    e.stopPropagation();
    selectedIdx = Math.max(selectedIdx - 1, 0);
    updateSelection();
  } else if (e.key === 'Enter' && isActive) {
    e.preventDefault();
    e.stopPropagation();
    selectItem(selectedIdx);
  } else if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    dismiss();
  }
}

/**
 * Dismiss if user clicks outside the dropdown
 */
function handleDocumentClick(e) {
  if (!isActive) return;
  if (!dropdownEl.contains(e.target)) {
    dismiss();
  }
}

/**
 * Filter file paths by fuzzy matching query
 * @param {string} query
 * @returns {Array<{path: string, display: string}>}
 */
function filterPaths(query) {
  if (!filePaths.length) {
    rebuildPaths();
  }

  const q = query.toLowerCase();
  const results = [];

  for (const path of filePaths) {
    const display = path.replace(/\.md$/, '');
    const lower = display.toLowerCase();

    if (!q) {
      // Show all (limited) when no query typed yet
      results.push({ path, display, score: 0 });
    } else if (lower.includes(q)) {
      // Substring match — prefer start-of-name matches
      const filename = lower.split('/').pop();
      const score = filename.startsWith(q) ? 2 : (lower.startsWith(q) ? 1 : 0);
      results.push({ path, display, score });
    } else if (fuzzyMatch(q, lower)) {
      results.push({ path, display, score: -1 });
    }
  }

  // Sort: higher score first, then alphabetical
  results.sort((a, b) => b.score - a.score || a.display.localeCompare(b.display));
  return results.slice(0, 10);
}

/**
 * Simple fuzzy match: all query chars appear in order in target
 */
function fuzzyMatch(query, target) {
  let qi = 0;
  for (let ti = 0; ti < target.length && qi < query.length; ti++) {
    if (target[ti] === query[qi]) qi++;
  }
  return qi === query.length;
}

/**
 * Show the dropdown below the cursor
 */
function showDropdown(matches, cursorPos) {
  const view = getEditorView();
  if (!view) return;

  const coords = view.coordsAtPos(cursorPos);
  if (!coords) return;

  dropdownEl.textContent = '';
  selectedIdx = 0;
  isActive = true;

  matches.forEach((match, idx) => {
    const item = document.createElement('div');
    item.className = 'link-complete-item';
    if (idx === 0) item.classList.add('selected');
    item.textContent = match.display;
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      selectItem(idx);
    });
    dropdownEl.appendChild(item);
  });

  // Position below cursor
  dropdownEl.style.top = (coords.bottom + 4) + 'px';
  dropdownEl.style.left = coords.left + 'px';
  dropdownEl.classList.remove('hidden');
}

/**
 * Select an item and insert the link
 */
function selectItem(idx) {
  const items = dropdownEl.querySelectorAll('.link-complete-item');
  if (idx < 0 || idx >= items.length) return;

  const display = items[idx].textContent;
  const path = filePaths.find(p => p.replace(/\.md$/, '') === display) || display + '.md';

  const view = getEditorView();
  if (!view) return;

  // Replace from [ to current cursor with [Display](path)
  const head = view.state.selection.main.head;
  const linkText = `[${display}](${path})`;

  view.dispatch({
    changes: { from: startPos, to: head, insert: linkText },
    selection: { anchor: startPos + linkText.length }
  });

  view.focus();
  dismiss();
}

/**
 * Update visual selection in dropdown
 */
function updateSelection() {
  const items = dropdownEl.querySelectorAll('.link-complete-item');
  items.forEach((item, idx) => {
    if (idx === selectedIdx) {
      item.classList.add('selected');
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.classList.remove('selected');
    }
  });
}

/**
 * Dismiss the dropdown
 */
function dismiss() {
  if (!isActive) return;
  isActive = false;
  selectedIdx = 0;
  startPos = -1;
  if (dropdownEl) {
    dropdownEl.classList.add('hidden');
    dropdownEl.textContent = '';
  }
}
