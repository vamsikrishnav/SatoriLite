// CodeMirror 6 editor module for SatoriLite
import { readFile, writeFile, getFileHandle } from './fs.js';
import { setActiveFile } from './tree.js';
import { createLivePreview } from './live-preview.js';

// Module state
let editorView = null;
let currentFilePath = null;
let saveTimer = null;
let previewTimer = null;

// Exports
export function getEditorView() {
  return editorView;
}

export function getCurrentFilePath() {
  return currentFilePath;
}

/**
 * Create the Catppuccin editor theme
 */
function createTheme(EditorView) {
  return EditorView.theme({
    '&': { backgroundColor: 'var(--bg-primary)', color: 'var(--text-normal)', height: '100%' },
    '.cm-content': { caretColor: 'var(--accent)', fontFamily: "'Liga SFMono Nerd Font', 'SF Mono', 'Fira Code', monospace", fontSize: '12px', lineHeight: '1.1', letterSpacing: '-0.3px', padding: '16px 0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'var(--bg-surface1)' },
    '.cm-gutters': { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-faint)', borderRight: '1px solid var(--bg-surface0)', fontFamily: "'Liga SFMono Nerd Font', 'SF Mono', 'Fira Code', monospace", fontSize: '12px' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--bg-surface0)' },
    '.cm-activeLine': { backgroundColor: 'color-mix(in srgb, var(--bg-surface0) 30%, transparent)' },
    '.cm-foldPlaceholder': { backgroundColor: 'var(--bg-surface0)', color: 'var(--text-subtext0, var(--text-muted))', border: 'none' },
    '.cm-tooltip': { backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--bg-surface0)', color: 'var(--text-normal)' },
    '.cm-tooltip-autocomplete': { '& > ul > li[aria-selected]': { backgroundColor: 'var(--bg-surface1)' } },
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
    openFile(path);
  });
}

/**
 * Save the current file to disk
 */
async function saveCurrentFile() {
  if (!currentFilePath || !editorView) return;

  try {
    const content = editorView.state.doc.toString();
    const fileHandle = await getFileHandle(currentFilePath);
    await writeFile(fileHandle, content);
  } catch (err) {
    console.error('Failed to save file:', err);
  }
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

    // Replace editor content
    editorView.dispatch({
      changes: {
        from: 0,
        to: editorView.state.doc.length,
        insert: content
      }
    });

    currentFilePath = path;

    // Highlight in tree
    setActiveFile(path);

    // Dispatch file-loaded event
    window.dispatchEvent(new CustomEvent('satorilite:file-loaded', {
      detail: { path, content }
    }));
  } catch (err) {
    console.error('Failed to open file:', path, err);
  }
}
