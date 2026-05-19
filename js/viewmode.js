/**
 * View Mode Toggle Module
 * Manages split/editor/preview modes with keyboard shortcuts and persistence.
 */

let currentMode = 'split';

const STORAGE_KEY = 'satorilite:viewMode';
const VALID_MODES = ['split', 'editor', 'preview'];

/**
 * Set the active view mode.
 * @param {'split' | 'editor' | 'preview'} mode
 */
export function setMode(mode) {
  if (!VALID_MODES.includes(mode)) return;

  currentMode = mode;

  const editorContent = document.querySelector('.editor-content');
  if (editorContent) {
    // Remove all mode classes
    VALID_MODES.forEach(m => editorContent.classList.remove(`mode-${m}`));
    // Add current mode class
    editorContent.classList.add(`mode-${mode}`);
  }

  // Update active button state
  const buttons = document.querySelectorAll('.view-toggle-btn[data-mode]');
  buttons.forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  // Persist to localStorage
  localStorage.setItem(STORAGE_KEY, mode);
}

/**
 * Initialize view mode: restore saved mode, wire buttons and keyboard shortcuts.
 */
export function initViewMode() {
  // Restore saved mode or default to split
  const saved = localStorage.getItem(STORAGE_KEY);
  const initialMode = VALID_MODES.includes(saved) ? saved : 'split';
  setMode(initialMode);

  // Wire click handlers on toggle buttons
  const buttons = document.querySelectorAll('.view-toggle-btn[data-mode]');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      setMode(btn.dataset.mode);
    });
  });

  // Wire keyboard shortcuts: Cmd+Shift+S/E/P
  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
      switch (e.key.toUpperCase()) {
        case 'S':
          e.preventDefault();
          setMode('split');
          break;
        case 'E':
          e.preventDefault();
          setMode('editor');
          break;
        case 'P':
          e.preventDefault();
          setMode('preview');
          break;
      }
    }
  });
}
