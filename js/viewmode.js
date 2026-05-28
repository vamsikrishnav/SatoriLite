/**
 * View Mode Toggle Module
 * Manages split/editor/preview modes with keyboard shortcuts and persistence.
 */

let currentMode = 'split';

const STORAGE_KEY = 'satorilite:viewMode';
const VALID_MODES = ['preview', 'editor', 'split'];

function updateIcon() {
  const icons = {
    split: document.getElementById('icon-view-split'),
    editor: document.getElementById('icon-view-editor'),
    preview: document.getElementById('icon-view-preview'),
  };
  for (const [mode, el] of Object.entries(icons)) {
    if (el) el.style.display = mode === currentMode ? '' : 'none';
  }
}

/**
 * Set the active view mode.
 * @param {'split' | 'editor' | 'preview'} mode
 */
export function setMode(mode) {
  if (!VALID_MODES.includes(mode)) return;

  currentMode = mode;

  const editorContent = document.querySelector('.editor-content');
  if (editorContent) {
    VALID_MODES.forEach(m => editorContent.classList.remove(`mode-${m}`));
    editorContent.classList.add(`mode-${mode}`);
  }

  updateIcon();
  localStorage.setItem(STORAGE_KEY, mode);
}

function cycleMode() {
  const idx = VALID_MODES.indexOf(currentMode);
  const next = VALID_MODES[(idx + 1) % VALID_MODES.length];
  setMode(next);
}

/**
 * Initialize view mode: restore saved mode, wire button and keyboard shortcuts.
 */
export function initViewMode() {
  const saved = localStorage.getItem(STORAGE_KEY);
  const initialMode = VALID_MODES.includes(saved) ? saved : 'preview';
  setMode(initialMode);

  const cycleBtn = document.getElementById('btn-view-cycle');
  if (cycleBtn) {
    cycleBtn.addEventListener('click', cycleMode);
  }

  window.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
      switch (e.key.toUpperCase()) {
        case 'V':
          e.preventDefault();
          cycleMode();
          break;
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
