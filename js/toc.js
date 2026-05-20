/**
 * Table of Contents sidebar
 * Extracts headings from the current file and renders a clickable TOC
 * in the right sidebar. Clicking a heading scrolls the editor to that line.
 */

import { getEditorView } from './editor.js';

let tocContainer = null;
let headings = [];
let tocTimer = null;

export function initTOC() {
  tocContainer = document.getElementById('toc-list');
  if (!tocContainer) return;

  tocContainer.addEventListener('click', handleTOCClick);

  const toggleBtn = document.getElementById('btn-toc');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', toggleRightSidebar);
  }

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'o') {
      e.preventDefault();
      toggleRightSidebar();
    }
  });

  window.addEventListener('satorilite:content-changed', (e) => {
    if (tocTimer) clearTimeout(tocTimer);
    tocTimer = setTimeout(() => updateTOC(e.detail.content), 1000);
  });

  window.addEventListener('satorilite:file-loaded', (e) => {
    updateTOC(e.detail.content);
  });
}

function toggleRightSidebar() {
  const sidebar = document.getElementById('sidebar-right');
  if (!sidebar) return;
  sidebar.classList.toggle('collapsed');
}

function updateTOC(content) {
  if (!tocContainer || !content) {
    if (tocContainer) tocContainer.textContent = '';
    return;
  }

  headings = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.+)/);
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].replace(/[*_`~\[\]]/g, ''),
        line: i
      });
    }
  }

  renderTOC();
}

function renderTOC() {
  if (!tocContainer) return;
  tocContainer.textContent = '';

  if (headings.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'toc-empty';
    empty.textContent = 'No headings';
    tocContainer.appendChild(empty);
    return;
  }

  headings.forEach((h, idx) => {
    const btn = document.createElement('button');
    btn.className = `toc-item toc-level-${h.level}`;
    btn.style.paddingLeft = `${8 + (h.level - 1) * 12}px`;
    btn.dataset.idx = idx;
    btn.textContent = h.text;
    tocContainer.appendChild(btn);
  });
}

function handleTOCClick(e) {
  const btn = e.target.closest('.toc-item');
  if (!btn) return;

  const idx = parseInt(btn.dataset.idx, 10);
  const heading = headings[idx];
  if (!heading) return;

  const view = getEditorView();
  if (!view) return;

  const lineNum = heading.line + 1;
  if (lineNum > view.state.doc.lines) return;

  const line = view.state.doc.line(lineNum);
  const editorContent = document.querySelector('.editor-content');
  const isEditorVisible = editorContent && !editorContent.classList.contains('mode-preview');

  if (isEditorVisible) {
    view.focus();
    view.dispatch({ selection: { anchor: line.from, head: line.from } });
    requestAnimationFrame(() => {
      const coords = view.coordsAtPos(line.from);
      if (coords) {
        const scrollerRect = view.scrollDOM.getBoundingClientRect();
        view.scrollDOM.scrollTop += coords.top - scrollerRect.top - 8;
      }
    });
  }

  // Always scroll preview if it's visible
  const previewPane = document.getElementById('preview-pane');
  const isPreviewVisible = editorContent && !editorContent.classList.contains('mode-editor');
  if (isPreviewVisible && previewPane) {
    const previewHeadings = previewPane.querySelectorAll('h1, h2, h3, h4, h5, h6');
    if (previewHeadings[idx]) {
      previewHeadings[idx].scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}
