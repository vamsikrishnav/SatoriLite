/**
 * SatoriLite Theme Switcher
 * Provides theme management with a floating panel UI and keyboard shortcut.
 */

const THEMES = {
  'catppuccin-mocha': {
    name: 'Catppuccin Mocha',
    dark: true,
    vars: {
      '--bg-primary': '#1e1e2e',
      '--bg-secondary': '#181825',
      '--bg-tertiary': '#11111b',
      '--bg-surface0': '#313244',
      '--bg-surface1': '#45475a',
      '--bg-surface2': '#585b70',
      '--text-normal': '#cdd6f4',
      '--text-muted': '#bac2de',
      '--text-faint': '#6c7086',
      '--text-subtext0': '#a6adc8',
      '--accent': '#cba6f7',
      '--accent-hover': '#b48bf2',
      '--color-red': '#f38ba8',
      '--color-green': '#a6e3a1',
      '--color-yellow': '#f9e2af',
      '--color-blue': '#89b4fa',
      '--color-purple': '#cba6f7',
      '--color-peach': '#fab387',
      '--color-teal': '#94e2d5',
      '--color-sky': '#89dceb',
      '--color-lavender': '#b4befe',
      '--color-pink': '#f5c2e7',
      '--border': '#45475a',
      '--border-focus': '#585b70',
      '--syn-h1': '#f38ba8',
      '--syn-h2': '#fab387',
      '--syn-h3': '#a6e3a1',
      '--syn-h4': '#94e2d5',
      '--syn-h5': '#b4befe',
      '--syn-h6': '#cba6f7',
      '--syn-keyword': '#cba6f7',
      '--syn-string': '#a6e3a1',
      '--syn-comment': '#6c7086',
      '--syn-number': '#fab387',
      '--syn-function': '#89b4fa',
      '--syn-type': '#f9e2af',
      '--syn-operator': '#89dceb',
      '--syn-property': '#89b4fa',
      '--syn-tag': '#cba6f7',
      '--syn-attribute': '#89b4fa',
      '--syn-meta': '#f38ba8',
      '--syn-link': '#cba6f7',
      '--syn-emphasis': '#f5c2e7',
      '--syn-strong': '#f38ba8',
    },
  },
  'catppuccin-macchiato': {
    name: 'Catppuccin Macchiato',
    dark: true,
    vars: {
      '--bg-primary': '#24273a',
      '--bg-secondary': '#1e2030',
      '--bg-tertiary': '#181926',
      '--bg-surface0': '#363a4f',
      '--bg-surface1': '#494d64',
      '--bg-surface2': '#5b6078',
      '--text-normal': '#cad3f5',
      '--text-muted': '#b8c0e0',
      '--text-faint': '#6e738d',
      '--text-subtext0': '#a5adcb',
      '--accent': '#c6a0f6',
      '--accent-hover': '#b07ef0',
      '--color-red': '#ed8796',
      '--color-green': '#a6da95',
      '--color-yellow': '#eed49f',
      '--color-blue': '#8aadf4',
      '--color-purple': '#c6a0f6',
      '--color-peach': '#f5a97f',
      '--color-teal': '#8bd5ca',
      '--color-sky': '#91d7e3',
      '--color-lavender': '#b7bdf8',
      '--color-pink': '#f5bde6',
      '--border': '#494d64',
      '--border-focus': '#5b6078',
      '--syn-h1': '#ed8796',
      '--syn-h2': '#f5a97f',
      '--syn-h3': '#a6da95',
      '--syn-h4': '#8bd5ca',
      '--syn-h5': '#b7bdf8',
      '--syn-h6': '#c6a0f6',
      '--syn-keyword': '#c6a0f6',
      '--syn-string': '#a6da95',
      '--syn-comment': '#6e738d',
      '--syn-number': '#f5a97f',
      '--syn-function': '#8aadf4',
      '--syn-type': '#eed49f',
      '--syn-operator': '#91d7e3',
      '--syn-property': '#8aadf4',
      '--syn-tag': '#c6a0f6',
      '--syn-attribute': '#8aadf4',
      '--syn-meta': '#ed8796',
      '--syn-link': '#c6a0f6',
      '--syn-emphasis': '#f5bde6',
      '--syn-strong': '#ed8796',
    },
  },
  'catppuccin-frappe': {
    name: 'Catppuccin Frappé',
    dark: true,
    vars: {
      '--bg-primary': '#303446',
      '--bg-secondary': '#292c3c',
      '--bg-tertiary': '#232634',
      '--bg-surface0': '#414559',
      '--bg-surface1': '#51576d',
      '--bg-surface2': '#626880',
      '--text-normal': '#c6d0f5',
      '--text-muted': '#b5bfe2',
      '--text-faint': '#737994',
      '--text-subtext0': '#a5adce',
      '--accent': '#ca9ee6',
      '--accent-hover': '#b57ee0',
      '--color-red': '#e78284',
      '--color-green': '#a6d189',
      '--color-yellow': '#e5c890',
      '--color-blue': '#8caaee',
      '--color-purple': '#ca9ee6',
      '--color-peach': '#ef9f76',
      '--color-teal': '#81c8be',
      '--color-sky': '#99d1db',
      '--color-lavender': '#babbf1',
      '--color-pink': '#f4b8e4',
      '--border': '#51576d',
      '--border-focus': '#626880',
      '--syn-h1': '#e78284',
      '--syn-h2': '#ef9f76',
      '--syn-h3': '#a6d189',
      '--syn-h4': '#81c8be',
      '--syn-h5': '#babbf1',
      '--syn-h6': '#ca9ee6',
      '--syn-keyword': '#ca9ee6',
      '--syn-string': '#a6d189',
      '--syn-comment': '#737994',
      '--syn-number': '#ef9f76',
      '--syn-function': '#8caaee',
      '--syn-type': '#e5c890',
      '--syn-operator': '#99d1db',
      '--syn-property': '#8caaee',
      '--syn-tag': '#ca9ee6',
      '--syn-attribute': '#8caaee',
      '--syn-meta': '#e78284',
      '--syn-link': '#ca9ee6',
      '--syn-emphasis': '#f4b8e4',
      '--syn-strong': '#e78284',
    },
  },
  'tokyo-night': {
    name: 'Tokyo Night',
    dark: true,
    vars: {
      '--bg-primary': '#1a1b26',
      '--bg-secondary': '#16161e',
      '--bg-tertiary': '#13131a',
      '--bg-surface0': '#292e42',
      '--bg-surface1': '#3b4261',
      '--bg-surface2': '#545c7e',
      '--text-normal': '#c0caf5',
      '--text-muted': '#a9b1d6',
      '--text-faint': '#565f89',
      '--text-subtext0': '#9aa5ce',
      '--accent': '#7aa2f7',
      '--accent-hover': '#5d8bf7',
      '--color-red': '#f7768e',
      '--color-green': '#9ece6a',
      '--color-yellow': '#e0af68',
      '--color-blue': '#7aa2f7',
      '--color-purple': '#bb9af7',
      '--color-peach': '#ff9e64',
      '--color-teal': '#73daca',
      '--color-sky': '#7dcfff',
      '--color-lavender': '#7aa2f7',
      '--color-pink': '#ff007c',
      '--border': '#3b4261',
      '--border-focus': '#545c7e',
      '--syn-h1': '#f7768e',
      '--syn-h2': '#ff9e64',
      '--syn-h3': '#9ece6a',
      '--syn-h4': '#73daca',
      '--syn-h5': '#7aa2f7',
      '--syn-h6': '#bb9af7',
      '--syn-keyword': '#bb9af7',
      '--syn-string': '#9ece6a',
      '--syn-comment': '#565f89',
      '--syn-number': '#ff9e64',
      '--syn-function': '#7aa2f7',
      '--syn-type': '#e0af68',
      '--syn-operator': '#7dcfff',
      '--syn-property': '#7aa2f7',
      '--syn-tag': '#bb9af7',
      '--syn-attribute': '#7aa2f7',
      '--syn-meta': '#f7768e',
      '--syn-link': '#7aa2f7',
      '--syn-emphasis': '#ff007c',
      '--syn-strong': '#f7768e',
    },
  },
  'nord': {
    name: 'Nord',
    dark: true,
    vars: {
      '--bg-primary': '#2e3440',
      '--bg-secondary': '#2a2f3a',
      '--bg-tertiary': '#242933',
      '--bg-surface0': '#3b4252',
      '--bg-surface1': '#434c5e',
      '--bg-surface2': '#4c566a',
      '--text-normal': '#eceff4',
      '--text-muted': '#d8dee9',
      '--text-faint': '#7b88a1',
      '--text-subtext0': '#b0b8cc',
      '--accent': '#88c0d0',
      '--accent-hover': '#6fb8ca',
      '--color-red': '#bf616a',
      '--color-green': '#a3be8c',
      '--color-yellow': '#ebcb8b',
      '--color-blue': '#81a1c1',
      '--color-purple': '#b48ead',
      '--color-peach': '#d08770',
      '--color-teal': '#8fbcbb',
      '--color-sky': '#88c0d0',
      '--color-lavender': '#81a1c1',
      '--color-pink': '#b48ead',
      '--border': '#434c5e',
      '--border-focus': '#4c566a',
      '--syn-h1': '#bf616a',
      '--syn-h2': '#d08770',
      '--syn-h3': '#a3be8c',
      '--syn-h4': '#8fbcbb',
      '--syn-h5': '#81a1c1',
      '--syn-h6': '#b48ead',
      '--syn-keyword': '#81a1c1',
      '--syn-string': '#a3be8c',
      '--syn-comment': '#7b88a1',
      '--syn-number': '#d08770',
      '--syn-function': '#88c0d0',
      '--syn-type': '#ebcb8b',
      '--syn-operator': '#81a1c1',
      '--syn-property': '#88c0d0',
      '--syn-tag': '#81a1c1',
      '--syn-attribute': '#88c0d0',
      '--syn-meta': '#bf616a',
      '--syn-link': '#88c0d0',
      '--syn-emphasis': '#b48ead',
      '--syn-strong': '#bf616a',
    },
  },
  'gruvbox': {
    name: 'Gruvbox Dark',
    dark: true,
    vars: {
      '--bg-primary': '#282828',
      '--bg-secondary': '#1d2021',
      '--bg-tertiary': '#171717',
      '--bg-surface0': '#3c3836',
      '--bg-surface1': '#504945',
      '--bg-surface2': '#665c54',
      '--text-normal': '#ebdbb2',
      '--text-muted': '#d5c4a1',
      '--text-faint': '#928374',
      '--text-subtext0': '#a89984',
      '--accent': '#d3869b',
      '--accent-hover': '#c57090',
      '--color-red': '#fb4934',
      '--color-green': '#b8bb26',
      '--color-yellow': '#fabd2f',
      '--color-blue': '#83a598',
      '--color-purple': '#d3869b',
      '--color-peach': '#fe8019',
      '--color-teal': '#8ec07c',
      '--color-sky': '#83a598',
      '--color-lavender': '#83a598',
      '--color-pink': '#d3869b',
      '--border': '#504945',
      '--border-focus': '#665c54',
      '--syn-h1': '#fb4934',
      '--syn-h2': '#fe8019',
      '--syn-h3': '#b8bb26',
      '--syn-h4': '#8ec07c',
      '--syn-h5': '#83a598',
      '--syn-h6': '#d3869b',
      '--syn-keyword': '#fb4934',
      '--syn-string': '#b8bb26',
      '--syn-comment': '#928374',
      '--syn-number': '#d3869b',
      '--syn-function': '#fabd2f',
      '--syn-type': '#fabd2f',
      '--syn-operator': '#8ec07c',
      '--syn-property': '#83a598',
      '--syn-tag': '#fb4934',
      '--syn-attribute': '#fabd2f',
      '--syn-meta': '#fe8019',
      '--syn-link': '#83a598',
      '--syn-emphasis': '#d3869b',
      '--syn-strong': '#fb4934',
    },
  },
  'rose-pine': {
    name: 'Rosé Pine',
    dark: true,
    vars: {
      '--bg-primary': '#191724',
      '--bg-secondary': '#1f1d2e',
      '--bg-tertiary': '#16141f',
      '--bg-surface0': '#26233a',
      '--bg-surface1': '#2a2837',
      '--bg-surface2': '#393552',
      '--text-normal': '#e0def4',
      '--text-muted': '#c4a7e7',
      '--text-faint': '#6e6a86',
      '--text-subtext0': '#908caa',
      '--accent': '#c4a7e7',
      '--accent-hover': '#b091e0',
      '--color-red': '#eb6f92',
      '--color-green': '#31748f',
      '--color-yellow': '#f6c177',
      '--color-blue': '#9ccfd8',
      '--color-purple': '#c4a7e7',
      '--color-peach': '#ebbcba',
      '--color-teal': '#31748f',
      '--color-sky': '#9ccfd8',
      '--color-lavender': '#9ccfd8',
      '--color-pink': '#eb6f92',
      '--border': '#393552',
      '--border-focus': '#524f67',
      '--syn-h1': '#eb6f92',
      '--syn-h2': '#ebbcba',
      '--syn-h3': '#31748f',
      '--syn-h4': '#9ccfd8',
      '--syn-h5': '#c4a7e7',
      '--syn-h6': '#c4a7e7',
      '--syn-keyword': '#c4a7e7',
      '--syn-string': '#f6c177',
      '--syn-comment': '#6e6a86',
      '--syn-number': '#ebbcba',
      '--syn-function': '#9ccfd8',
      '--syn-type': '#f6c177',
      '--syn-operator': '#908caa',
      '--syn-property': '#9ccfd8',
      '--syn-tag': '#c4a7e7',
      '--syn-attribute': '#9ccfd8',
      '--syn-meta': '#eb6f92',
      '--syn-link': '#9ccfd8',
      '--syn-emphasis': '#eb6f92',
      '--syn-strong': '#eb6f92',
    },
  },
};

const STORAGE_KEY = 'satorilite:theme';
const DEFAULT_THEME = 'catppuccin-mocha';

let currentThemeId = null;
let panelEl = null;

/**
 * Apply a theme by ID. Sets CSS custom properties on :root,
 * saves preference to localStorage, and dispatches a change event.
 * @param {string} id - Theme key from THEMES
 */
function applyTheme(id) {
  const theme = THEMES[id];
  if (!theme) return;

  const root = document.documentElement;
  for (const [prop, value] of Object.entries(theme.vars)) {
    root.style.setProperty(prop, value);
  }

  currentThemeId = id;
  localStorage.setItem(STORAGE_KEY, id);

  window.dispatchEvent(new CustomEvent('satorilite:theme-changed', {
    detail: { id, theme },
  }));
}

/**
 * Toggle the theme panel open/closed.
 */
function toggleThemePanel() {
  if (panelEl) {
    closePanel();
    return;
  }
  openPanel();
}

function openPanel() {
  panelEl = document.createElement('div');
  panelEl.className = 'theme-panel';

  // Header
  const header = document.createElement('div');
  header.className = 'theme-panel-header';
  header.textContent = 'Theme';
  panelEl.appendChild(header);

  // List
  const list = document.createElement('div');
  list.className = 'theme-panel-list';

  for (const [id, theme] of Object.entries(THEMES)) {
    const item = document.createElement('div');
    item.className = 'theme-panel-item';
    if (id === currentThemeId) item.classList.add('active');

    // Swatch
    const swatch = document.createElement('div');
    swatch.className = 'theme-swatch';
    swatch.style.backgroundColor = theme.vars['--accent'];
    swatch.style.borderColor = theme.vars['--bg-surface1'];

    // Name
    const name = document.createElement('div');
    name.className = 'theme-panel-name';
    name.textContent = theme.name;

    item.appendChild(swatch);
    item.appendChild(name);

    item.addEventListener('click', () => {
      applyTheme(id);
      // Update active state
      list.querySelectorAll('.theme-panel-item').forEach(el => el.classList.remove('active'));
      item.classList.add('active');
    });

    list.appendChild(item);
  }

  panelEl.appendChild(list);
  document.body.appendChild(panelEl);

  // Close on outside click (next tick to avoid immediate close)
  requestAnimationFrame(() => {
    document.addEventListener('click', handleOutsideClick);
  });
}

function closePanel() {
  if (panelEl) {
    panelEl.remove();
    panelEl = null;
  }
  document.removeEventListener('click', handleOutsideClick);
}

function handleOutsideClick(e) {
  if (panelEl && !panelEl.contains(e.target)) {
    closePanel();
  }
}

/**
 * Initialize the theme chooser. Restores saved theme, registers keyboard
 * shortcut (Cmd+Shift+T / Ctrl+Shift+T), and wires btn-theme button.
 */
export function initThemeChooser() {
  // Restore saved theme or apply default
  const saved = localStorage.getItem(STORAGE_KEY) || DEFAULT_THEME;
  applyTheme(saved);

  // Keyboard shortcut: Cmd+Shift+T (Mac) / Ctrl+Shift+T (other)
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'T') {
      e.preventDefault();
      toggleThemePanel();
    }
  });

  // Wire btn-theme button if it exists
  const btn = document.getElementById('btn-theme');
  if (btn) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleThemePanel();
    });
  }
}

export { toggleThemePanel };
