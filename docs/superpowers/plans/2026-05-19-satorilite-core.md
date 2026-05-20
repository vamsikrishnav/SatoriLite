# SatoriLite Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build a fully functional offline-first PWA markdown editor that reuses Satori's visual design and runs entirely in the browser with no server.

**Architecture:** Single-page app using vanilla JS ES modules with importmaps. File System Access API provides direct filesystem read/write. CodeMirror 6 handles editing. MiniSearch handles search and link autocomplete. Service Worker + Cache API enables offline. IndexedDB stores recent vault references.

**Tech Stack:** Vanilla JS (ES modules), CodeMirror 6 (local bundle), marked.js, MiniSearch, Mermaid (lazy-init), KaTeX (lazy-init), File System Access API, Service Worker, IndexedDB, CSS custom properties (Catppuccin themes from Satori).

**UI Reference:** All UI patterns, CSS, and component structure are sourced from `/Users/I342929/projects/Satori/frontend/`. When in doubt about layout, spacing, icons, or interaction patterns, refer to Satori's implementation. SatoriLite should look and feel identical minus server-dependent features (AI chat, sync, WebSocket).

---

## File Structure

```
SatoriLite/
  index.html                 Entry point, app shell, importmap
  manifest.json              PWA manifest
  sw.js                      Service Worker for offline caching
  llms.txt                   LLM context file (already exists)
  DESIGN-CONTEXT.md          Design decisions (already exists)
  css/
    satori.css               Full stylesheet (adapted from Satori)
  js/
    app.js                   Main init, vault open, module orchestration
    fs.js                    File System Access API abstraction
    vault-db.js              IndexedDB for recent vaults
    tree.js                  File tree sidebar rendering
    editor.js                CodeMirror 6 setup + theme
    renderer.js              Markdown preview (marked + mermaid + katex)
    search.js                MiniSearch index + vault search modal
    link-complete.js         [ autocomplete for inter-note links
    file-ops.js              Create, rename, move, delete operations
    tabs.js                  Tab bar for open files
    viewmode.js              Split/editor/preview mode toggle
    themes.js                Theme definitions + switcher
    status-bar.js            Bottom status bar (path, word count)
    resize.js                Sidebar resize + toggle
    command-palette.js       Cmd+K command palette
  lib/
    codemirror-bundle.js     CodeMirror 6 pre-built (from Satori)
    marked.esm.js            marked.js ESM build
    minisearch.esm.js        MiniSearch ESM build
    mermaid.esm.min.js       Mermaid (lazy-loaded at runtime)
    katex/                   KaTeX CSS + JS (lazy-loaded at runtime)
      katex.min.js
      katex.min.css
      fonts/                 KaTeX fonts
```

---

## Task 1: Project Skeleton and PWA Shell

**Files:**
- Create: `index.html`
- Create: `manifest.json`
- Create: `sw.js`
- Create: `css/satori.css` (initial subset)

**UI Reference:** Satori `frontend/index.html` for HTML structure, `frontend/css/satori.css` lines 1-704 for base styles, vault chooser, and app layout.

- [ ] Step 1: Create `manifest.json` with PWA metadata (name: SatoriLite, display: standalone, theme_color: #cba6f7, bg: #11111b)
- [ ] Step 2: Create `sw.js` with cache-first strategy. Precache all app JS/CSS/lib files. Skip non-GET requests.
- [ ] Step 3: Create `css/satori.css` — copy from Satori lines 1-704 (root vars, reset, scrollbars, utility, buttons, vault chooser, app layout). Remove AI/RAG/WebSocket styles.
- [ ] Step 4: Create `index.html` — vault chooser with "Open Folder" button + recent vaults list, app layout (sidebar + editor area with view toggle toolbar + tab bar + editor/preview panes + status bar). Register SW. Load app.js as module. Use importmap for codemirror-bundle, marked, minisearch.
- [ ] Step 5: Serve with `python3 -m http.server 8080`, verify vault chooser renders in Chrome with Catppuccin dark theme, no console errors.
- [ ] Step 6: `git init && git add . && git commit -m "feat: project skeleton with PWA shell and vault chooser UI"`

---

## Task 2: File System Access API Abstraction

**Files:**
- Create: `js/fs.js`
- Create: `js/vault-db.js`

- [ ] Step 1: Create `js/vault-db.js` — IndexedDB wrapper (db: satorilite, store: vaults, keyPath: name). Exports: `getRecentVaults()`, `saveVault(name, dirHandle)`, `removeVault(name)`. Store dirHandle + lastOpened timestamp.
- [ ] Step 2: Create `js/fs.js` — exports: `getRootHandle()`, `setRootHandle(handle)`, `pickDirectory()` (showDirectoryPicker with readwrite mode), `scanDirectory(dirHandle, path)` (recursive, skip dotfiles and node_modules, sort folders first then alpha), `readFile(handle)`, `writeFile(handle, content)`, `getFileHandle(path)`, `createFile(dirHandle, name)`, `createDirectory(parentHandle, name)`, `deleteEntry(parentHandle, name)`, `renameEntry(oldParent, oldName, newParent, newName)`.
- [ ] Step 3: Create minimal `js/app.js` that imports both modules, logs "Modules loaded OK". Verify in browser.
- [ ] Step 4: Commit: `git add js/ && git commit -m "feat: File System Access API abstraction and IndexedDB vault storage"`

---

## Task 3: Vault Picker and App Init

**Files:**
- Modify: `js/app.js`

**UI Reference:** Satori `frontend/js/vault.js` for vault list rendering, `frontend/js/app.js` for init orchestration pattern.

- [ ] Step 1: Implement app.js — `renderRecentVaults()` reads from IndexedDB, renders vault-item divs (DOM API, no innerHTML) with name + delete button. Clicking vault-item requests permission then calls `openVault()`. Delete button removes from DB and re-renders.
- [ ] Step 2: Implement `openVault(name, dirHandle)` — sets root handle, saves to DB, scans directory tree, hides vault-chooser, shows app-layout, dispatches `satorilite:vault-open` event with tree data.
- [ ] Step 3: Wire "Open Folder" button to `pickDirectory()` then `openVault()`.
- [ ] Step 4: Test: click Open Folder, select folder, confirm chooser hides and app layout shows. Refresh, confirm vault in recent list.
- [ ] Step 5: Commit: `git commit -am "feat: vault picker with recent vaults and folder open flow"`

---

## Task 4: File Tree Sidebar

**Files:**
- Create: `js/tree.js`
- Modify: `css/satori.css`

**UI Reference:** Satori `frontend/js/tree.js` for icons, rendering, expand/collapse. Satori CSS lines 706-975 for tree styles.

- [ ] Step 1: Add File Tree CSS section from Satori (lines 706-975) to satori.css.
- [ ] Step 2: Create `js/tree.js` — file/folder SVG icons (same as Satori), expand/collapse with chevrons, session-persisted expandedPaths set, `renderTree()` builds DOM elements (no innerHTML for user-content — use textContent for filenames). Click file dispatches `satorilite:file-open` event. Click folder toggles expand. `setActiveFile(path)` highlights active. `initTree()` listens for vault-open and tree-refresh events.
- [ ] Step 3: Wire into app.js — import and call `initTree()` before `init()`.
- [ ] Step 4: Test: open vault, tree renders, folders expand/collapse, state persists on reload.
- [ ] Step 5: Commit: `git add js/tree.js css/satori.css js/app.js && git commit -m "feat: file tree sidebar with expand/collapse"`

---

## Task 5: CodeMirror Editor Setup

**Files:**
- Create: `js/editor.js`
- Copy: `lib/codemirror-bundle.js`

**UI Reference:** Satori `frontend/js/editor.js` for theme definition (createTheme function) and extension list. Satori CSS lines 1145-1222 for editor styles.

- [ ] Step 1: Copy Satori's codemirror-bundle.js to `lib/`.
- [ ] Step 2: Create `js/editor.js` — createTheme() matching Satori's Catppuccin CM6 theme (bg-primary, accent caret, surface1 selection, etc). initEditor() dynamically imports codemirror-bundle, creates EditorState with: lineNumbers, highlightActiveLine, highlightActiveLineGutter, foldGutter, history, indentOnInput, bracketMatching, closeBrackets, syntaxHighlighting, markdown mode, theme, keymaps, updateListener for auto-save (1s debounce) and live preview (300ms debounce via `satorilite:content-changed` event).
- [ ] Step 3: Implement `openFile(path, handle)` — reads file, dispatches content to editor, sets active in tree, dispatches `satorilite:file-loaded` event. Listen for `satorilite:file-open` events.
- [ ] Step 4: Add Editor CSS from Satori (lines 1145-1222) to satori.css.
- [ ] Step 5: Wire into app.js — call `await initEditor()` inside openVault().
- [ ] Step 6: Test: open vault, click .md file, editor renders with syntax highlighting, auto-save works.
- [ ] Step 7: Commit: `git add js/editor.js lib/codemirror-bundle.js css/satori.css js/app.js && git commit -m "feat: CodeMirror 6 editor with auto-save and Catppuccin theme"`

---

## Task 6: Markdown Preview

**Files:**
- Create: `js/renderer.js`
- Download: `lib/marked.esm.js`

**UI Reference:** Satori `frontend/js/renderer.js` for rendering approach. Satori CSS lines 1345-1574 for preview typography.

- [ ] Step 1: Download marked.js ESM: `curl -L -o lib/marked.esm.js "https://cdn.jsdelivr.net/npm/marked@15.0.4/lib/marked.esm.js"`
- [ ] Step 2: Create `js/renderer.js` — `stripFrontmatter()`, lazy-load marked, `renderPreview(content)` parses markdown and sets preview-pane content. Mermaid: detect code blocks with language-mermaid class, lazy-import /lib/mermaid.esm.min.js, render SVG diagrams. KaTeX: detect $ patterns, lazy-load /lib/katex/katex.min.js + CSS, render math using DOM walker (not regex on innerHTML). `initRenderer()` listens for file-loaded and content-changed events.
- [ ] Step 3: Add Preview Pane Typography CSS from Satori (lines 1345-1574).
- [ ] Step 4: Wire into app.js — call `initRenderer()` inside openVault() before initEditor().
- [ ] Step 5: Test: open .md file, preview shows rendered HTML, frontmatter stripped, edit updates preview within 300ms.
- [ ] Step 6: Commit: `git add js/renderer.js lib/marked.esm.js css/satori.css js/app.js && git commit -m "feat: markdown preview with live update and lazy mermaid/katex"`

---

## Task 7: View Mode Toggle

**Files:**
- Create: `js/viewmode.js`

**UI Reference:** Satori `frontend/js/viewmode.js` for mode switching. CSS mode classes should be in App Layout section already.

- [ ] Step 1: Create `js/viewmode.js` — tracks currentMode (split/editor/preview), `setMode(mode)` updates .editor-content class and active button, persists to localStorage. Keyboard shortcuts: Cmd+Shift+S/E/P. `initViewMode()` restores saved mode and wires buttons + keys.
- [ ] Step 2: Wire into app.js inside openVault().
- [ ] Step 3: Verify CSS has `.editor-content.mode-split/mode-editor/mode-preview` rules (from App Layout). If missing, add them.
- [ ] Step 4: Test: buttons switch modes, keyboard shortcuts work, persists on reload.
- [ ] Step 5: Commit: `git add js/viewmode.js js/app.js && git commit -m "feat: view mode toggle with keyboard shortcuts"`

---

## Task 8: Search with MiniSearch

**Files:**
- Create: `js/search.js`
- Download: `lib/minisearch.esm.js`
- Modify: `css/satori.css`

**UI Reference:** Satori `frontend/js/search.js` for modal UI. Satori CSS lines 1727-1857 for search modal styles.

- [ ] Step 1: Download MiniSearch: `curl -L -o lib/minisearch.esm.js "https://cdn.jsdelivr.net/npm/minisearch@7.2.0/dist/es/index.js"`
- [ ] Step 2: Create `js/search.js` — `buildIndex()` flattens tree, reads all .md files, builds MiniSearch index (fields: name+content, boost name 3x, fuzzy 0.2, prefix true). `searchVault(query)` returns top 20 results. `getFilePaths()` returns all indexed files. `addToIndex(doc)` / `removeFromIndex(path)` for incremental updates. `initSearch()` builds modal via DOM API (no innerHTML for user content), wires Cmd+Shift+F, search button, backdrop close, Escape close, result click opens file.
- [ ] Step 3: Add Search Modal CSS from Satori (lines 1727-1857).
- [ ] Step 4: Wire into app.js — call `initSearch()` before init().
- [ ] Step 5: Test: Cmd+Shift+F opens modal, typing shows fuzzy results, clicking opens file, Escape closes.
- [ ] Step 6: Commit: `git add js/search.js lib/minisearch.esm.js css/satori.css js/app.js && git commit -m "feat: vault-wide search with MiniSearch"`

---

## Task 9: Theme Switcher

**Files:**
- Create: `js/themes.js`
- Modify: `css/satori.css`

**UI Reference:** Satori `frontend/js/themes.js` — copy the entire THEMES object (all color maps). Satori CSS lines 2550-2625 for theme panel styles.

- [ ] Step 1: Create `js/themes.js` — copy full THEMES object from Satori (catppuccin-mocha, macchiato, frappe, tokyo-night, nord, gruvbox, and any light themes). `applyTheme(id)` sets CSS custom properties on documentElement, persists to localStorage. `initThemeChooser()` builds panel via DOM API with swatch + name per theme, wires Cmd+Shift+T and theme button. `toggleThemePanel()` exported for command palette.
- [ ] Step 2: Add Theme Panel CSS from Satori (lines 2550-2625).
- [ ] Step 3: Wire into app.js — call `initThemeChooser()` at top level (before vault open, so theme applies to chooser).
- [ ] Step 4: Test: Cmd+Shift+T opens panel, clicking theme changes colors immediately, persists on reload, works on vault chooser screen.
- [ ] Step 5: Commit: `git add js/themes.js css/satori.css js/app.js && git commit -m "feat: theme switcher with all Catppuccin variants + Tokyo Night + Nord + Gruvbox"`

---

## Task 10: Status Bar and Sidebar Resize

**Files:**
- Create: `js/status-bar.js`
- Create: `js/resize.js`
- Modify: `css/satori.css`

**UI Reference:** Satori `frontend/js/status-bar.js`, `frontend/js/resize.js`. Satori CSS lines 2251-2328 for status bar.

- [ ] Step 1: Create `js/status-bar.js` — `initStatusBar()` listens for file-loaded and content-changed events, updates path/word/char count DOM elements via textContent.
- [ ] Step 2: Create `js/resize.js` — `toggleLeftSidebar()` toggles collapsed class, persists to localStorage. `initResize()` restores state, wires sidebar button and Cmd+B.
- [ ] Step 3: Add Status Bar CSS from Satori (lines 2251-2328).
- [ ] Step 4: Wire into app.js inside openVault().
- [ ] Step 5: Test: status bar shows path + word/char count updating on edit, Cmd+B toggles sidebar, state persists.
- [ ] Step 6: Commit: `git add js/status-bar.js js/resize.js css/satori.css js/app.js && git commit -m "feat: status bar and sidebar toggle"`

---

## Task 11: Tabs

**Files:**
- Create: `js/tabs.js`
- Modify: `css/satori.css` (if tab styles missing)

**UI Reference:** Satori `frontend/js/tabs.js` for tab management.

- [ ] Step 1: Create `js/tabs.js` — tracks openTabs array and activeTab. `initTabs()` wires tab-bar click delegation (click tab = switch, click close = remove). Listens for `satorilite:file-open` to add/activate tabs. Renders tabs via DOM API (textContent for filenames).
- [ ] Step 2: Ensure tab-bar CSS exists in satori.css (from App Layout section). If not, add .tab-bar, .tab, .tab-active, .tab-close styles.
- [ ] Step 3: Wire into app.js inside openVault().
- [ ] Step 4: Test: opening files creates tabs, clicking switches, X closes, closing active switches to previous.
- [ ] Step 5: Commit: `git add js/tabs.js css/satori.css js/app.js && git commit -m "feat: tab bar for open files"`

---

## Task 12: File Operations

**Files:**
- Create: `js/file-ops.js`

- [ ] Step 1: Create `js/file-ops.js` — `createNewFile(folderPath, fileName)` creates file with initial H1 heading, adds to search index, dispatches tree-refresh and file-open. `createNewFolder(parentPath, name)`. `deleteFileOrFolder(path)` removes entry and from index. `renameFile(oldPath, newName)` copies content to new file, deletes old, updates index. `initFileOps()` wires Cmd+N to prompt for filename.
- [ ] Step 2: Wire into app.js inside openVault().
- [ ] Step 3: Test: Cmd+N creates file, tree refreshes, search finds it immediately.
- [ ] Step 4: Commit: `git add js/file-ops.js js/app.js && git commit -m "feat: file operations with search index sync"`

---

## Task 13: Link Autocomplete

**Files:**
- Create: `js/link-complete.js`
- Modify: `js/editor.js`

**UI Reference:** Satori `frontend/js/editor.js` for CM autocomplete integration.

- [ ] Step 1: Create `js/link-complete.js` — builds separate MiniSearch index of file paths/names. `searchLinks(query)` returns top 10 matches. `initLinkComplete()` rebuilds index on vault-open and tree-refresh events.
- [ ] Step 2: In `js/editor.js`, add `linkCompletionSource(context)` — triggers on `[` character (matchBefore /\[[^\]]*$/), returns completions that insert `[Name](path.md)` format. Add `autocompletion({ override: [linkCompletionSource] })` to editor extensions.
- [ ] Step 3: Wire initLinkComplete() in app.js before init().
- [ ] Step 4: Test: type `[` then characters, dropdown shows matching files, selecting inserts markdown link.
- [ ] Step 5: Commit: `git add js/link-complete.js js/editor.js js/app.js && git commit -m "feat: inter-note link autocomplete"`

---

## Task 14: Command Palette

**Files:**
- Create: `js/command-palette.js`
- Modify: `css/satori.css`

**UI Reference:** Satori `frontend/js/command-palette.js`. Satori CSS lines 2627-2748 for palette styles.

- [ ] Step 1: Create `js/command-palette.js` — COMMANDS array (Toggle Sidebar, Theme Panel, Search Vault, New File, Split/Editor/Preview). `initCommandPalette()` builds modal via DOM API, filters commands on input, executes on click/Enter, closes on Escape/backdrop. Wires Cmd+K.
- [ ] Step 2: Add Command Palette CSS from Satori (lines 2627-2748).
- [ ] Step 3: Wire into app.js at top level.
- [ ] Step 4: Test: Cmd+K opens, typing filters, Enter/click executes, Escape closes.
- [ ] Step 5: Commit: `git add js/command-palette.js css/satori.css js/app.js && git commit -m "feat: command palette (Cmd+K)"`

---

## Task 15: Mermaid and KaTeX Local Bundles

**Files:**
- Download: `lib/mermaid.esm.min.js`
- Download: `lib/katex/`
- Modify: `sw.js`

- [ ] Step 1: Download Mermaid ESM: `curl -L -o lib/mermaid.esm.min.js "https://cdn.jsdelivr.net/npm/mermaid@11.14.0/dist/mermaid.esm.min.mjs"`
- [ ] Step 2: Download KaTeX JS, CSS, and woff2 fonts (20 font files) to `lib/katex/` and `lib/katex/fonts/`.
- [ ] Step 3: Add mermaid and katex to sw.js PRECACHE_URLS.
- [ ] Step 4: Test mermaid: create note with mermaid code block, verify diagram renders in preview.
- [ ] Step 5: Test KaTeX: create note with $inline$ and $$block$$ math, verify renders.
- [ ] Step 6: Commit: `git add lib/mermaid.esm.min.js lib/katex/ sw.js && git commit -m "feat: local Mermaid and KaTeX for offline rendering"`

---

## Task 16: Final Integration and PWA Verification

**Files:**
- Modify: `sw.js` (final precache list)
- Modify: `js/app.js` (final init order)

- [ ] Step 1: Finalize `js/app.js` init order — top-level: initThemeChooser, initTree, initSearch, initLinkComplete, initCommandPalette, init(). Inside openVault: initRenderer, initViewMode, initTabs, await initEditor, initStatusBar, initResize, initFileOps.
- [ ] Step 2: Update sw.js PRECACHE_URLS with every JS, CSS, and lib file.
- [ ] Step 3: Full manual test — open vault, browse tree, open files, edit, search, switch themes, switch view modes, create file, link autocomplete, command palette, tabs.
- [ ] Step 4: Offline test — enable offline in DevTools Network tab, reload, confirm app loads and all features work (except new vault open which needs file picker permission).
- [ ] Step 5: Lighthouse PWA audit — target all checks passing.
- [ ] Step 6: Commit: `git add . && git commit -m "feat: final integration - complete offline PWA"`

---

## Satori Source Reference

All tasks that copy CSS or UI patterns from Satori reference `/Users/I342929/projects/Satori/frontend/`. The implementation agent must:
1. Read specified line ranges from Satori CSS
2. Remove server-dependent code (fetch to /api/, WebSocket refs)
3. Remove AI sections (AI Chat lines 1859-2157, RAG lines 2158-2249, AI Actions lines 2510-2549)
4. Keep all CSS custom property references intact
5. Use DOM API (createElement, textContent, appendChild) instead of innerHTML for user-generated content
6. Preserve icon SVGs, spacing, and interaction patterns exactly as Satori has them
