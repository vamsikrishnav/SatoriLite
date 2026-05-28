// CodeMirror 6 editor module for SatoriLite
import { readFile, writeFile, getFileHandle } from './fs.js';
import { setActiveFile } from './tree.js';
import { createLivePreview } from './live-preview.js';

// Module state
let editorView = null;
let currentFilePath = null;
let saveTimer = null;
let previewTimer = null;
let lastSaveTime = 0;
const scrollPositions = new Map(); // path -> { editor: number, preview: number }

// Exports
export function getEditorView() {
  return editorView;
}

export function getContent() {
  return editorView ? editorView.state.doc.toString() : '';
}

export function getCurrentFilePath() {
  return currentFilePath;
}

/**
 * Create the Catppuccin editor theme
 */
function createTheme(EditorView) {
  return EditorView.theme({
    '&': { backgroundColor: '#3d3552', color: '#b8a8a0', height: '100%' },
    '.cm-content': { caretColor: '#c66b6b', fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace", fontSize: '13px', lineHeight: '1.8', padding: '20px 24px' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#c66b6b' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'rgba(139, 115, 144, 0.25)' },
    '.cm-gutters': { backgroundColor: 'transparent', color: '#7a6b72', borderRight: 'none', fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace", fontSize: '12px' },
    '.cm-activeLineGutter': { backgroundColor: 'transparent' },
    '.cm-activeLine': { backgroundColor: 'rgba(255, 255, 255, 0.02)' },
    '.cm-foldPlaceholder': { backgroundColor: 'rgba(74, 64, 96, 0.5)', color: '#b8a8a0', border: 'none' },
    '.cm-tooltip': { backgroundColor: 'rgba(61, 53, 82, 0.95)', border: '1px solid rgba(255, 255, 255, 0.08)', color: '#f0e6dc', backdropFilter: 'blur(12px)' },
    '.cm-tooltip-autocomplete': { '& > ul > li[aria-selected]': { backgroundColor: 'rgba(198, 107, 107, 0.15)' } },
  }, { dark: true });
}

/**
 * Initialize the CodeMirror editor
 */
export async function initEditor() {
  const {
    EditorState, EditorView, basicSetup, markdown,
    LanguageDescription, javascript, python, json, yaml,
    html, css, cpp, go, rust, java, sql, php, xml,
    syntaxHighlighting, HighlightStyle, tags, keymap,
    StateField, Decoration, WidgetType
  } = await import('codemirror-bundle');

  // Create Catppuccin highlight style
  const catppuccinHighlight = HighlightStyle.define([
    { tag: tags.heading1, color: 'var(--syn-h1)', fontWeight: 'bold', fontSize: '1.5em' },
    { tag: tags.heading2, color: 'var(--syn-h2)', fontWeight: 'bold', fontSize: '1.3em' },
    { tag: tags.heading3, color: 'var(--syn-h3)', fontWeight: 'bold', fontSize: '1.1em' },
    { tag: tags.heading4, color: 'var(--syn-h4)', fontWeight: 'bold' },
    { tag: tags.heading5, color: 'var(--syn-h5)', fontWeight: 'bold' },
    { tag: tags.heading6, color: 'var(--syn-h6)', fontWeight: 'bold' },
    { tag: tags.link, color: 'var(--syn-link)', textDecoration: 'underline' },
    { tag: tags.url, color: 'var(--text-faint)' },
    { tag: tags.emphasis, color: 'var(--syn-emphasis)', fontStyle: 'italic' },
    { tag: tags.strong, color: 'var(--syn-strong)', fontWeight: 'bold' },
    { tag: tags.strikethrough, textDecoration: 'line-through', color: 'var(--text-faint)' },
    { tag: tags.monospace, color: 'var(--syn-string)' },
    { tag: tags.processingInstruction, color: 'var(--syn-meta)' },
    { tag: tags.keyword, color: 'var(--syn-keyword)' },
    { tag: tags.operator, color: 'var(--syn-operator)' },
    { tag: tags.string, color: 'var(--syn-string)' },
    { tag: tags.special(tags.string), color: 'var(--syn-string)' },
    { tag: tags.comment, color: 'var(--syn-comment)', fontStyle: 'italic' },
    { tag: tags.lineComment, color: 'var(--syn-comment)', fontStyle: 'italic' },
    { tag: tags.number, color: 'var(--syn-number)' },
    { tag: tags.integer, color: 'var(--syn-number)' },
    { tag: tags.float, color: 'var(--syn-number)' },
    { tag: tags.bool, color: 'var(--syn-number)' },
    { tag: tags.null, color: 'var(--syn-number)' },
    { tag: tags.atom, color: 'var(--syn-number)' },
    { tag: tags.variableName, color: 'var(--text-normal)' },
    { tag: tags.function(tags.variableName), color: 'var(--syn-function)' },
    { tag: tags.typeName, color: 'var(--syn-type)' },
    { tag: tags.meta, color: 'var(--syn-meta)' },
    { tag: tags.definition(tags.propertyName), color: 'var(--syn-meta)' },
    { tag: tags.propertyName, color: 'var(--syn-property)' },
    { tag: tags.attributeValue, color: 'var(--syn-string)' },
    { tag: tags.labelName, color: 'var(--syn-type)' },
    { tag: tags.className, color: 'var(--syn-type)' },
    { tag: tags.tagName, color: 'var(--syn-tag)' },
    { tag: tags.attributeName, color: 'var(--syn-attribute)' },
  ]);

  // Theme
  const satoriTheme = createTheme(EditorView);

  // Save keymap (Cmd+S / Ctrl+S)
  const saveKeymap = keymap.of([{
    key: 'Mod-s',
    run: () => {
      saveCurrentFile();
      return true;
    }
  }]);

  // Update listener for auto-save and preview
  const updateListener = EditorView.updateListener.of((update) => {
    if (!update.docChanged) return;

    const content = update.state.doc.toString();

    // Auto-save with 1s debounce
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (currentFilePath) {
        saveCurrentFile();
      }
    }, 1000);

    // Preview update with 300ms debounce
    if (previewTimer) clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      window.dispatchEvent(new CustomEvent('satorilite:content-changed', {
        detail: { content, path: currentFilePath }
      }));
    }, 300);
  });

  // Create editor view
  const editorPane = document.getElementById('editor-pane');
  if (!editorPane) {
    console.error('Editor pane element not found');
    return;
  }

  // Live preview StateField
  const livePreviewField = createLivePreview(StateField, Decoration, WidgetType, EditorView);

  const state = EditorState.create({
    doc: '',
    extensions: [
      basicSetup,
      EditorView.lineWrapping,
      markdown({ codeLanguages: [
        LanguageDescription.of({ name: 'javascript', alias: ['js', 'jsx', 'ts', 'tsx', 'typescript'], support: javascript() }),
        LanguageDescription.of({ name: 'python', alias: ['py'], support: python() }),
        LanguageDescription.of({ name: 'json', alias: ['jsonc'], support: json() }),
        LanguageDescription.of({ name: 'yaml', alias: ['yml'], support: yaml() }),
        LanguageDescription.of({ name: 'html', alias: ['htm'], support: html() }),
        LanguageDescription.of({ name: 'css', alias: ['scss', 'less'], support: css() }),
        LanguageDescription.of({ name: 'c', alias: ['cpp', 'c++', 'cc', 'cxx', 'h', 'hpp', 'objc'], support: cpp() }),
        LanguageDescription.of({ name: 'go', alias: ['golang'], support: go() }),
        LanguageDescription.of({ name: 'rust', alias: ['rs'], support: rust() }),
        LanguageDescription.of({ name: 'java', alias: ['kotlin'], support: java() }),
        LanguageDescription.of({ name: 'sql', alias: ['mysql', 'postgresql', 'sqlite'], support: sql() }),
        LanguageDescription.of({ name: 'php', support: php() }),
        LanguageDescription.of({ name: 'xml', alias: ['svg', 'xsl', 'xhtml'], support: xml() }),
      ]}),
      satoriTheme,
      syntaxHighlighting(catppuccinHighlight),
      livePreviewField,
      saveKeymap,
      updateListener,
    ]
  });

  editorView = new EditorView({
    state,
    parent: editorPane,
  });

  // Listen for file-open events from tree
  window.addEventListener('satorilite:file-open', (e) => {
    const { path } = e.detail;
    const emptyState = document.getElementById('editor-empty-state');
    if (emptyState) emptyState.classList.add('hidden');
    openFile(path);
  });

  // Listen for file-open-content events (from chat sources — content provided directly)
  window.addEventListener('satorilite:file-open-content', (e) => {
    const { path, content } = e.detail;
    if (!editorView) return;
    // Suppress auto-save for server-loaded content
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    currentFilePath = null;
    editorView.dispatch({
      changes: { from: 0, to: editorView.state.doc.length, insert: content }
    });
    currentFilePath = '__readonly__:' + path;
    window.dispatchEvent(new CustomEvent('satorilite:file-loaded', { detail: { path, content } }));
  });
}

/**
 * Save the current file to disk
 */
async function saveCurrentFile() {
  if (!currentFilePath || !editorView || currentFilePath.startsWith('__readonly__:')) return;

  try {
    const content = editorView.state.doc.toString();
    const fileHandle = await getFileHandle(currentFilePath);
    await writeFile(fileHandle, content);
    lastSaveTime = Date.now();
  } catch (err) {
    console.error('Failed to save file:', err);
  }
}

export function getLastSaveTime() {
  return lastSaveTime;
}

/**
 * Open a file in the editor
 * @param {string} path - Relative path within the vault
 */
export async function openFile(path) {
  if (!editorView) {
    console.error('Editor not initialized');
    return;
  }

  // Clear pending timers from previous file
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }

  try {
    const fileHandle = await getFileHandle(path);
    const content = await readFile(fileHandle);

    const preview = document.getElementById('preview-pane');
    const isReload = currentFilePath === path;

    // Save scroll position of the file we're leaving
    if (currentFilePath && !isReload) {
      scrollPositions.set(currentFilePath, {
        editor: editorView.scrollDOM.scrollTop,
        preview: preview ? preview.scrollTop : 0,
      });
    }

    // Capture current scroll before replacing content (for same-file reload)
    const prevEditorScroll = editorView.scrollDOM.scrollTop;
    const prevPreviewScroll = preview ? preview.scrollTop : 0;

    // Replace editor content
    editorView.dispatch({
      changes: {
        from: 0,
        to: editorView.state.doc.length,
        insert: content
      },
    });

    currentFilePath = path;

    // Restore scroll position
    if (isReload) {
      editorView.scrollDOM.scrollTop = prevEditorScroll;
      if (preview) preview.scrollTop = prevPreviewScroll;
    } else {
      const saved = scrollPositions.get(path);
      if (saved) {
        editorView.scrollDOM.scrollTop = saved.editor;
        if (preview) preview.scrollTop = saved.preview;
      } else {
        editorView.dispatch({ selection: { anchor: 0 }, scrollIntoView: true });
        if (preview) preview.scrollTop = 0;
      }
    }

    // Highlight in tree
    setActiveFile(path);

    // Persist for restore on refresh
    localStorage.setItem('satorilite-last-file', path);

    if (isReload) {
      // Re-render preview without resetting scroll
      const previewEl = document.getElementById('preview-pane');
      window.dispatchEvent(new CustomEvent('satorilite:content-changed', {
        detail: { path, content }
      }));
      // Restore preview scroll after render
      requestAnimationFrame(() => {
        editorView.scrollDOM.scrollTop = prevEditorScroll;
        if (previewEl) previewEl.scrollTop = prevPreviewScroll;
      });
    } else {
      window.dispatchEvent(new CustomEvent('satorilite:file-loaded', {
        detail: { path, content }
      }));
    }
  } catch (err) {
    console.error('Failed to open file:', path, err);
  }
}
