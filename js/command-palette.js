/**
 * Command Palette Module
 * Provides a Cmd+K searchable command palette for quick actions.
 */

import { toggleLeftSidebar } from './resize.js';
import { toggleThemePanel } from './themes.js';
import { setMode } from './viewmode.js';
import { createNewFile } from './file-ops.js';

const COMMANDS = [
  { label: 'Toggle Sidebar', hint: 'Cmd+B', action: () => toggleLeftSidebar() },
  { label: 'Theme Picker', hint: 'Cmd+Shift+T', action: () => toggleThemePanel() },
  {
    label: 'Search Vault', hint: 'Cmd+Shift+F', action: () => {
      document.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'F', code: 'KeyF', metaKey: true, shiftKey: true, bubbles: true
      }));
    }
  },
  {
    label: 'New File', hint: 'Cmd+N', action: () => {
      const name = prompt('Filename:');
      if (name) createNewFile('', name);
    }
  },
  { label: 'Split View', hint: 'Cmd+Shift+S', action: () => setMode('split') },
  { label: 'Editor Only', hint: 'Cmd+Shift+E', action: () => setMode('editor') },
  { label: 'Preview Only', hint: 'Cmd+Shift+P', action: () => setMode('preview') },
];

let backdrop;
let input;
let results;
let selectedIndex = 0;
let filtered = [];

/**
 * Render commands matching the query into the results container.
 * @param {string} query
 */
function renderCommands(query) {
  const q = query.toLowerCase().trim();
  filtered = q
    ? COMMANDS.filter(cmd => cmd.label.toLowerCase().includes(q))
    : [...COMMANDS];

  selectedIndex = 0;
  results.textContent = '';

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'palette-empty';
    empty.textContent = 'No matching commands';
    results.appendChild(empty);
    return;
  }

  filtered.forEach((cmd, i) => {
    const item = document.createElement('div');
    item.className = 'palette-item' + (i === 0 ? ' selected' : '');
    item.dataset.index = i;

    const label = document.createElement('span');
    label.className = 'palette-item-label';
    label.textContent = cmd.label;

    const hint = document.createElement('span');
    hint.className = 'palette-item-hint';
    hint.textContent = cmd.hint;

    item.appendChild(label);
    item.appendChild(hint);

    item.addEventListener('click', () => {
      executeCommand(i);
    });

    results.appendChild(item);
  });
}

/**
 * Update the visual selection highlight.
 */
function updateSelection() {
  const items = results.querySelectorAll('.palette-item');
  items.forEach((el, i) => {
    el.classList.toggle('selected', i === selectedIndex);
  });

  // Scroll selected into view
  const selected = results.querySelector('.palette-item.selected');
  if (selected) {
    selected.scrollIntoView({ block: 'nearest' });
  }
}

/**
 * Execute the command at the given index and close the palette.
 * @param {number} index
 */
function executeCommand(index) {
  const cmd = filtered[index];
  if (!cmd) return;
  closePalette();
  cmd.action();
}

/**
 * Open the command palette.
 */
function openPalette() {
  backdrop.classList.remove('hidden');
  input.value = '';
  renderCommands('');
  input.focus();
}

/**
 * Close the command palette.
 */
function closePalette() {
  backdrop.classList.add('hidden');
}

/**
 * Initialize the command palette: create DOM, wire shortcuts.
 */
export function initCommandPalette() {
  // Create backdrop
  backdrop = document.createElement('div');
  backdrop.className = 'palette-backdrop hidden';

  // Create modal
  const modal = document.createElement('div');
  modal.className = 'palette-modal';

  // Create input
  input = document.createElement('input');
  input.className = 'palette-input';
  input.type = 'text';
  input.placeholder = 'Type a command…';

  // Create results container
  results = document.createElement('div');
  results.className = 'palette-results';

  modal.appendChild(input);
  modal.appendChild(results);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  // Input filtering
  input.addEventListener('input', () => {
    renderCommands(input.value);
  });

  // Keyboard navigation inside the palette
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (filtered.length > 0) {
        selectedIndex = (selectedIndex + 1) % filtered.length;
        updateSelection();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (filtered.length > 0) {
        selectedIndex = (selectedIndex - 1 + filtered.length) % filtered.length;
        updateSelection();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      executeCommand(selectedIndex);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closePalette();
    }
  });

  // Backdrop click to close
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      closePalette();
    }
  });

  // Global shortcut: Cmd+K / Ctrl+K
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      if (backdrop.classList.contains('hidden')) {
        openPalette();
      } else {
        closePalette();
      }
    }
  });
}
