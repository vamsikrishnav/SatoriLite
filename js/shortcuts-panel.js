let backdrop = null;
let modal = null;

const isMac = navigator.platform.includes('Mac');
const mod = isMac ? '⌘' : 'Ctrl';

const shortcuts = [
  { keys: `${mod}+K`, action: 'Command palette' },
  { keys: `${mod}+P`, action: 'Quick switcher' },
  { keys: `${mod}+S`, action: 'Save file' },
  { keys: `${mod}+B`, action: 'Toggle sidebar' },
  { keys: `${mod}+Shift+F`, action: 'Search vault' },
  { keys: `${mod}+F`, action: 'Find in file' },
  { keys: `${mod}+H`, action: 'Find & replace' },
  { keys: `${mod}+Shift+E`, action: 'Editor mode' },
  { keys: `${mod}+Shift+P`, action: 'Preview mode' },
  { keys: `${mod}+Shift+S`, action: 'Split mode' },
  { keys: `${mod}+Shift+L`, action: 'AI Chat' },
  { keys: `${mod}+Shift+O`, action: 'Table of Contents' },
  { keys: `${mod}+/`, action: 'Keyboard shortcuts' },
  { keys: 'Escape', action: 'Close panel' },
];

function show() {
  backdrop.classList.remove('hidden');
  modal.focus();
}

function hide() {
  backdrop.classList.add('hidden');
}

function toggle() {
  if (backdrop.classList.contains('hidden')) show();
  else hide();
}

export function initShortcutsPanel() {
  backdrop = document.createElement('div');
  backdrop.className = 'shortcuts-backdrop hidden';
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) hide();
  });

  modal = document.createElement('div');
  modal.className = 'shortcuts-modal';
  modal.tabIndex = -1;

  const title = document.createElement('h3');
  title.textContent = 'Keyboard Shortcuts';
  modal.appendChild(title);

  const grid = document.createElement('div');
  grid.className = 'shortcuts-grid';

  for (const s of shortcuts) {
    const keyEl = document.createElement('span');
    keyEl.className = 'shortcuts-keys';
    const parts = s.keys.split('+');
    for (let i = 0; i < parts.length; i++) {
      const kbd = document.createElement('kbd');
      kbd.textContent = parts[i];
      keyEl.appendChild(kbd);
      if (i < parts.length - 1) {
        keyEl.appendChild(document.createTextNode(' + '));
      }
    }
    grid.appendChild(keyEl);

    const desc = document.createElement('span');
    desc.className = 'shortcuts-action';
    desc.textContent = s.action;
    grid.appendChild(desc);
  }

  modal.appendChild(grid);
  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); hide(); }
  });

  document.addEventListener('keydown', (e) => {
    const modifier = isMac ? e.metaKey : e.ctrlKey;
    if (modifier && e.key === '/') {
      e.preventDefault();
      toggle();
    }
  });
}
