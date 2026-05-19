/**
 * tree.js — File tree sidebar component for SatoriLite.
 * Renders vault files/folders with expand/collapse and click-to-open.
 */

import { getVaultTree } from './app.js';

// Module state
let activeFilePath = null;
let expandedPaths = new Set(JSON.parse(sessionStorage.getItem('satorilite:expandedPaths') || '[]'));

function persistExpandedPaths() {
  sessionStorage.setItem('satorilite:expandedPaths', JSON.stringify([...expandedPaths]));
}

// SVG icon constants (trusted, hardcoded strings)
const FILE_ICONS = {
  '.md': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/><line x1="9" y1="9" x2="10" y2="9"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>`,
  '.png': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M20 15l-5-5L5 20"/></svg>`,
  '.jpg': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M20 15l-5-5L5 20"/></svg>`,
  '.jpeg': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M20 15l-5-5L5 20"/></svg>`,
  '.gif': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M20 15l-5-5L5 20"/></svg>`,
  '.svg': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M20 15l-5-5L5 20"/></svg>`,
  '.pdf': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/></svg>`,
  '.json': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4a2 2 0 0 0-2 2v3a2 3 0 0 1-2 3 2 3 0 0 1 2 3v3a2 2 0 0 0 2 2"/><path d="M17 4a2 2 0 0 1 2 2v3a2 3 0 0 0 2 3 2 3 0 0 0-2 3v3a2 2 0 0 1-2 2"/></svg>`,
  '.yaml': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
  '.yml': `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>`,
};

const FOLDER_ICON_OPEN = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;
const FOLDER_ICON_CLOSED = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/></svg>`;
const DEFAULT_FILE_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3v4a1 1 0 0 0 1 1h4"/><path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2z"/></svg>`;
const CHEVRON_RIGHT = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
const CHEVRON_DOWN = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;

/**
 * Helper to safely insert trusted SVG icon markup.
 * SVG icons are hardcoded constants above, not user content.
 * @param {HTMLElement} element - Target element
 * @param {string} svgMarkup - Trusted SVG string
 */
function setSvgIcon(element, svgMarkup) {
  element.innerHTML = svgMarkup;
}

/**
 * Get the icon SVG for a file based on its extension.
 * @param {string} filename - The filename
 * @returns {string} SVG markup
 */
function getIcon(filename) {
  const ext = filename.lastIndexOf('.') !== -1 ? filename.slice(filename.lastIndexOf('.')) : '';
  return FILE_ICONS[ext.toLowerCase()] || DEFAULT_FILE_ICON;
}

/**
 * Sort tree entries: directories first, then files, both alphabetical.
 * @param {Array} entries - Array of entry objects
 * @returns {Array} Sorted entries
 */
function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    if (a.kind === 'directory' && b.kind !== 'directory') return -1;
    if (a.kind !== 'directory' && b.kind === 'directory') return 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

/**
 * Recursively render tree entries into a container.
 * @param {Array} entries - Array of entry objects {name, path, kind, handle, children?}
 * @param {HTMLElement} container - Parent container element
 * @param {number} depth - Current depth level
 */
function renderTree(entries, container, depth) {
  const sorted = sortEntries(entries);

  for (const entry of sorted) {
    if (entry.kind === 'directory') {
      renderDirectory(entry, container, depth);
    } else {
      renderFile(entry, container, depth);
    }
  }
}

/**
 * Render a directory entry with expand/collapse.
 * @param {Object} entry - Directory entry object
 * @param {HTMLElement} parentEl - Parent element
 * @param {number} depth - Depth level
 */
function renderDirectory(entry, parentEl, depth) {
  const item = document.createElement('div');
  item.className = 'tree-item tree-item-folder';
  item.style.paddingLeft = `${12 + depth * 16}px`;

  // Chevron toggle
  const chevron = document.createElement('span');
  chevron.className = 'tree-folder-toggle';

  // Folder icon
  const icon = document.createElement('span');
  icon.className = 'tree-folder-icon';

  // Label
  const label = document.createElement('span');
  label.className = 'tree-item-label';
  label.textContent = entry.name;

  item.appendChild(chevron);
  item.appendChild(icon);
  item.appendChild(label);
  parentEl.appendChild(item);

  // Children container
  const childrenContainer = document.createElement('div');
  childrenContainer.className = 'tree-children';
  parentEl.appendChild(childrenContainer);

  // Expand/collapse state
  let expanded = expandedPaths.has(entry.path);
  setSvgIcon(chevron, expanded ? CHEVRON_DOWN : CHEVRON_RIGHT);
  setSvgIcon(icon, expanded ? FOLDER_ICON_OPEN : FOLDER_ICON_CLOSED);

  if (!expanded) {
    childrenContainer.classList.add('hidden');
  } else if (entry.children && entry.children.length > 0) {
    renderTree(entry.children, childrenContainer, depth + 1);
  }

  // Click handler
  item.addEventListener('click', (e) => {
    e.stopPropagation();
    expanded = !expanded;

    if (expanded) {
      expandedPaths.add(entry.path);
      setSvgIcon(chevron, CHEVRON_DOWN);
      setSvgIcon(icon, FOLDER_ICON_OPEN);
      childrenContainer.classList.remove('hidden');

      // Render children if not yet rendered
      if (entry.children && entry.children.length > 0 && childrenContainer.children.length === 0) {
        renderTree(entry.children, childrenContainer, depth + 1);
      }
    } else {
      expandedPaths.delete(entry.path);
      setSvgIcon(chevron, CHEVRON_RIGHT);
      setSvgIcon(icon, FOLDER_ICON_CLOSED);
      childrenContainer.classList.add('hidden');
    }

    persistExpandedPaths();
  });
}

/**
 * Render a file entry.
 * @param {Object} entry - File entry object
 * @param {HTMLElement} parentEl - Parent element
 * @param {number} depth - Depth level
 */
function renderFile(entry, parentEl, depth) {
  const item = document.createElement('div');
  item.className = 'tree-item tree-item-file';
  item.style.paddingLeft = `${12 + depth * 16}px`;
  item.dataset.path = entry.path;

  if (entry.path === activeFilePath) {
    item.classList.add('active');
  }

  // Empty chevron spacer
  const chevronSpacer = document.createElement('span');
  chevronSpacer.className = 'tree-folder-toggle';
  chevronSpacer.style.visibility = 'hidden';

  // File icon
  const icon = document.createElement('span');
  icon.className = 'tree-file-icon';
  setSvgIcon(icon, getIcon(entry.name));

  // Label
  const label = document.createElement('span');
  label.className = 'tree-item-label';
  label.textContent = entry.name;

  item.appendChild(chevronSpacer);
  item.appendChild(icon);
  item.appendChild(label);
  parentEl.appendChild(item);

  // Click handler
  item.addEventListener('click', (e) => {
    e.stopPropagation();

    // Remove active class from previous item
    const prevActive = document.querySelector('.tree-item.active');
    if (prevActive) {
      prevActive.classList.remove('active');
    }

    // Add active class to this item
    item.classList.add('active');
    activeFilePath = entry.path;

    // Dispatch file-open event
    window.dispatchEvent(new CustomEvent('satorilite:file-open', {
      detail: {
        path: entry.path,
        handle: entry.handle
      }
    }));
  });
}

/**
 * Render the full tree in the sidebar.
 */
function renderFullTree() {
  const sidebar = document.getElementById('sidebar-left');
  if (!sidebar) {
    console.error('Sidebar element not found');
    return;
  }

  // Clear sidebar
  sidebar.textContent = '';

  // Brand element
  const brand = document.createElement('div');
  brand.className = 'tree-brand';

  const kanji = document.createElement('span');
  kanji.className = 'tree-brand-kanji';
  kanji.textContent = '悟';

  const name = document.createElement('span');
  name.className = 'tree-brand-name';
  name.textContent = 'SatoriLite';

  brand.appendChild(kanji);
  brand.appendChild(name);
  sidebar.appendChild(brand);

  // Scroll container
  const scrollContainer = document.createElement('div');
  scrollContainer.className = 'tree-scroll';
  sidebar.appendChild(scrollContainer);

  // Get tree from app module
  const tree = getVaultTree();
  if (tree && tree.length > 0) {
    renderTree(tree, scrollContainer, 0);
  }
}

/**
 * Set the active file in the tree.
 * @param {string} path - File path
 */
export function setActiveFile(path) {
  activeFilePath = path;

  // Update UI if tree is rendered
  const prevActive = document.querySelector('.tree-item.active');
  if (prevActive) {
    prevActive.classList.remove('active');
  }

  const newActive = document.querySelector(`.tree-item-file[data-path="${path}"]`);
  if (newActive) {
    newActive.classList.add('active');
  }
}

/**
 * Initialize the tree module.
 * Sets up event listeners for vault-open and tree-refresh.
 */
export function initTree() {
  // Listen for vault-open event
  window.addEventListener('satorilite:vault-open', () => {
    renderFullTree();
  });

  // Listen for tree-refresh event (for future use)
  window.addEventListener('satorilite:tree-refresh', () => {
    renderFullTree();
  });
}
