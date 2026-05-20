/**
 * Backlinks panel — shows files that link to the current file.
 * Displayed in the right sidebar below the TOC.
 */

import { getVaultTree } from './app.js';
import { readFile } from './fs.js';
import { getCurrentFilePath } from './editor.js';

let container = null;
let backlinkTimer = null;

export function initBacklinks() {
  container = document.getElementById('backlinks-list');
  if (!container) return;

  window.addEventListener('satorilite:file-loaded', () => {
    scheduleUpdate();
  });
}

function scheduleUpdate() {
  if (backlinkTimer) clearTimeout(backlinkTimer);
  backlinkTimer = setTimeout(() => findBacklinks(), 200);
}

async function findBacklinks() {
  if (!container) return;
  container.textContent = '';

  const currentPath = getCurrentFilePath();
  if (!currentPath) return;

  const currentName = currentPath.split('/').pop().replace(/\.md$/, '');
  const allFiles = collectMarkdownFiles(getVaultTree());
  const backlinks = [];

  for (const file of allFiles) {
    if (file.path === currentPath) continue;

    try {
      const content = await readFile(file.handle);
      if (hasLinkTo(content, currentPath, currentName)) {
        backlinks.push(file);
      }
    } catch {
      // skip unreadable files
    }
  }

  renderBacklinks(backlinks);
}

function collectMarkdownFiles(tree) {
  const files = [];
  if (!tree) return files;

  for (const entry of tree) {
    if (entry.kind === 'file' && entry.name.endsWith('.md')) {
      files.push(entry);
    } else if (entry.kind === 'directory' && entry.children) {
      files.push(...collectMarkdownFiles(entry.children));
    }
  }
  return files;
}

function hasLinkTo(content, fullPath, name) {
  // Match [[wikilinks]] and [text](path) style links
  const wikiPattern = new RegExp(`\\[\\[${escapeRegex(name)}(\\|[^\\]]*)?\\]\\]`);
  if (wikiPattern.test(content)) return true;

  // Match markdown links referencing the path
  if (content.includes(fullPath)) return true;
  if (content.includes(name + '.md')) return true;
  if (content.includes(name + ')')) return true;

  return false;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderBacklinks(backlinks) {
  if (!container) return;
  container.textContent = '';

  if (backlinks.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'backlinks-empty';
    empty.textContent = 'No backlinks';
    container.appendChild(empty);
    return;
  }

  backlinks.forEach((file) => {
    const btn = document.createElement('button');
    btn.className = 'backlink-item';
    btn.textContent = file.name.replace(/\.md$/, '');
    btn.title = file.path;
    btn.addEventListener('click', () => {
      window.dispatchEvent(new CustomEvent('satorilite:file-open', {
        detail: { path: file.path }
      }));
    });
    container.appendChild(btn);
  });
}
