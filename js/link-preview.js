import { getFileHandle, readFile } from './fs.js';
import { getCurrentFilePath } from './editor.js';
import { marked } from 'marked';

let popup = null;
let arrow = null;
let showTimer = null;
let hideTimer = null;
let currentTarget = null;

function createPopup() {
  popup = document.createElement('div');
  popup.className = 'link-preview-popup';
  popup.style.display = 'none';

  arrow = document.createElement('div');
  arrow.className = 'preview-arrow';
  popup.appendChild(arrow);

  const body = document.createElement('div');
  body.className = 'preview-body';
  popup.appendChild(body);

  document.body.appendChild(popup);

  popup.addEventListener('mouseenter', () => {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  });
  popup.addEventListener('mouseleave', () => {
    scheduleHide();
  });
}

function stripFrontmatter(content) {
  if (!content.startsWith('---')) return content;
  const end = content.indexOf('\n---', 3);
  if (end === -1) return content;
  return content.slice(end + 4).trimStart();
}

function normalizePath(path) {
  try { path = decodeURIComponent(path); } catch {}
  const parts = path.split('/');
  const resolved = [];
  for (const part of parts) {
    if (part === '..') {
      resolved.pop();
    } else if (part && part !== '.') {
      resolved.push(part);
    }
  }
  return resolved.join('/');
}

function resolvePath(href) {
  if (href.startsWith('/')) return normalizePath(href.slice(1));
  const current = getCurrentFilePath();
  if (current) {
    const dir = current.substring(0, current.lastIndexOf('/'));
    const full = dir ? `${dir}/${href}` : href;
    return normalizePath(full);
  }
  return normalizePath(href);
}

async function fetchAndRender(path) {
  path = resolvePath(path);
  if (!path.endsWith('.md')) path += '.md';
  try {
    const handle = await getFileHandle(path);
    const content = await readFile(handle);
    const stripped = stripFrontmatter(content);
    const lines = stripped.split('\n').slice(0, 30).join('\n');
    // Content comes from the user's own local vault files (trusted source)
    return marked(lines);
  } catch {
    return null;
  }
}

function positionPopup(anchor) {
  const rect = anchor.getBoundingClientRect();
  const popupWidth = 420;
  const popupMaxHeight = 320;

  let left = rect.left + rect.width / 2 - popupWidth / 2;
  if (left < 8) left = 8;
  if (left + popupWidth > window.innerWidth - 8) left = window.innerWidth - popupWidth - 8;

  let top = rect.bottom + 8;
  if (top + popupMaxHeight > window.innerHeight - 8) {
    top = rect.top - popupMaxHeight - 8;
  }

  popup.style.left = `${left}px`;
  popup.style.top = `${top}px`;

  const arrowLeft = rect.left + rect.width / 2 - left;
  arrow.style.left = `${Math.max(12, Math.min(arrowLeft, popupWidth - 12))}px`;
}

function scheduleHide() {
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    popup.style.display = 'none';
    currentTarget = null;
  }, 300);
}

function handleMouseOver(e) {
  const link = e.target.closest('a[data-internal="true"]');
  const treeItem = e.target.closest('.tree-item-file[data-path]');
  const anchor = link || treeItem;
  if (!anchor) return;

  if (anchor === currentTarget) {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    return;
  }

  if (showTimer) { clearTimeout(showTimer); showTimer = null; }

  showTimer = setTimeout(async () => {
    let path;
    if (link) {
      path = link.getAttribute('href') || '';
    } else {
      path = treeItem.getAttribute('data-path') || '';
    }

    if (!path) return;

    const html = await fetchAndRender(path);
    if (!html) return;

    const body = popup.querySelector('.preview-body');
    // Safe: content rendered from user's own local vault files via marked.js
    body.innerHTML = html;
    popup.style.display = 'block';
    currentTarget = anchor;
    positionPopup(anchor);
  }, 300);
}

function handleMouseOut(e) {
  const link = e.target.closest('a[data-internal="true"]');
  const treeItem = e.target.closest('.tree-item-file[data-path]');
  if (!link && !treeItem) return;

  if (showTimer) { clearTimeout(showTimer); showTimer = null; }
  scheduleHide();
}

export function initLinkPreview() {
  createPopup();

  const previewPane = document.getElementById('preview-pane');
  if (previewPane) {
    previewPane.addEventListener('mouseover', handleMouseOver);
    previewPane.addEventListener('mouseout', handleMouseOut);
  }

  const sidebar = document.getElementById('sidebar-left');
  if (sidebar) {
    sidebar.addEventListener('mouseover', handleMouseOver);
    sidebar.addEventListener('mouseout', handleMouseOut);
  }
}
