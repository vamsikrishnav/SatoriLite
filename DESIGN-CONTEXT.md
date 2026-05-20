# SatoriLite — Design Context

## What This Is

A new offline-first PWA markdown editor. Takes Satori's polished visual design (CSS, layout, themes) but runs entirely in the browser — no server, no build step, open `index.html` and it works.

## Decided So Far

### Storage: File System Access API
- Chromium-only (Chrome, Edge, Arc, Brave)
- Reads/writes real `.md` files on disk (git-friendly, accessible by other tools)
- Rejected OPFS (files trapped in browser sandbox, risk of data loss on "clear browsing data")

### Features
1. **Full markdown editor** — CodeMirror 6, syntax highlighting, live preview
2. **Satori's visual design** — Catppuccin themes (Tokyo Night dark, Latte light), split view, sidebar, command palette look
3. **File tree** — browse the opened folder
4. **File operations** — move, rename, delete files from the UI
5. **Inter-note link autocomplete** — type `[` and get fuzzy file search to insert markdown links
6. **Offline PWA** — Service Worker for caching, works without network

### NOT in scope (for now)
- No AI / RAG / embeddings / Bedrock
- No server
- No sync protocol (future project)
- No build system — vanilla JS, importmaps for dependencies

### Tech Stack
- Vanilla JS (ES modules, importmaps)
- CSS copied/adapted from Satori (`frontend/css/satori.css`)
- CodeMirror 6 (via bundled JS or ESM CDN)
- marked.js for markdown rendering
- mermaid.js for diagrams
- KaTeX for math

### Inspiration
- [zakirullin/files.md](https://github.com/zakirullin/files.md) — offline-first, PWA, file ops, link autocomplete, hash-based sync
- Satori — visual design, editor UX, themes

### Architecture (tentative)
```
SatoriLite/
  index.html          Entry point
  sw.js               Service Worker for offline caching
  manifest.json       PWA manifest
  css/
    satori.css        Themes and layout (from Satori)
  js/
    app.js            Main app initialization
    fs.js             File System Access API abstraction
    tree.js           File tree rendering
    editor.js         CodeMirror setup
    preview.js        Markdown preview rendering
    file-ops.js       Move, rename, delete operations
    link-complete.js  [ autocomplete for inter-note links
    search.js         Client-side text search
    themes.js         Theme switching
  lib/
    codemirror-bundle.js   CodeMirror (pre-bundled)
```

### Resolved Decisions

| Question | Decision | Rationale |
|----------|----------|-----------|
| CodeMirror | Local bundle in `lib/` (esbuild output) | Offline-first contract — must work without network from first open |
| Mermaid + KaTeX | Local bundle in `lib/`, lazy-initialize on first use | Same offline-first reason. ~1.1MB storage cost but zero parse cost until a note needs it |
| File tree | Full scan on folder open | Enables immediate search, link resolution, orphan detection. Acceptable for target vault sizes |
| Search | MiniSearch (always, unconditionally) | 7KB, ESM, zero deps, incremental index updates, prefix + fuzzy + auto-suggest. Also powers `[` link autocomplete. Upgrade path: add vector search alongside for hybrid RAG later |
| Folder picker UX | Welcome screen with "Open Folder" + "Recent Vaults" list | First launch: welcome page with picker. Return visits: same screen with recent vaults from IndexedDB for one-click reopen |

### Future (out of scope now, compatible with current decisions)
- Hybrid search: add embedding model + vector store alongside MiniSearch, fuse with RRF
- NotebookLM-style Q&A: user brings API key, LLM synthesizes answers from retrieved chunks
- Sync protocol: future project, current file-on-disk approach is git-friendly
