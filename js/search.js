import MiniSearch from 'minisearch';
import { getVaultTree } from './app.js';
import { readFile, getFileHandle } from './fs.js';

// Module state
let miniSearch = null;
let indexedPaths = [];

/**
 * Flatten the vault tree into an array of file entries
 * @param {Array} tree - Vault tree structure
 * @param {Array} result - Accumulator
 * @returns {Array} Flat list of file entries with {name, path}
 */
function flattenTree(tree, result = []) {
  if (!tree) return result;
  for (const entry of tree) {
    if (entry.kind === 'file') {
      result.push({ name: entry.name, path: entry.path });
    } else if (entry.kind === 'directory' && entry.children) {
      flattenTree(entry.children, result);
    }
  }
  return result;
}

/**
 * Build the MiniSearch index from vault tree
 * Reads all .md files and indexes name + content
 */
export async function buildIndex() {
  const tree = getVaultTree();
  const files = flattenTree(tree);
  const mdFiles = files.filter(f => f.name.endsWith('.md'));

  miniSearch = new MiniSearch({
    fields: ['name', 'content'],
    storeFields: ['name', 'path'],
    searchOptions: {
      boost: { name: 3 },
      fuzzy: 0.2,
      prefix: true,
    }
  });

  const docs = [];
  indexedPaths = [];

  for (const file of mdFiles) {
    try {
      const handle = await getFileHandle(file.path);
      const content = await readFile(handle);
      docs.push({
        id: file.path,
        name: file.name.replace(/\.md$/, ''),
        path: file.path,
        content
      });
      indexedPaths.push(file.path);
    } catch (err) {
      console.warn('Failed to index file:', file.path, err);
    }
  }

  miniSearch.addAll(docs);
}

/**
 * Search the vault index
 * @param {string} query - Search query
 * @returns {Array} Top 20 results with {id, name, path, score}
 */
export function searchVault(query) {
  if (!miniSearch || !query.trim()) return [];
  return miniSearch.search(query).slice(0, 20);
}

/**
 * Get all indexed file paths (for link autocomplete)
 * @returns {Array<string>}
 */
export function getFilePaths() {
  return indexedPaths;
}

/**
 * Add a document to the index
 * @param {{id: string, name: string, path: string, content: string}} doc
 */
export function addToIndex(doc) {
  if (!miniSearch) return;
  try {
    miniSearch.add(doc);
    if (!indexedPaths.includes(doc.path)) {
      indexedPaths.push(doc.path);
    }
  } catch (err) {
    console.warn('Failed to add to index:', doc.path, err);
  }
}

/**
 * Remove a document from the index by path
 * @param {string} path - File path (used as id)
 */
export function removeFromIndex(path) {
  if (!miniSearch) return;
  try {
    miniSearch.discard(path);
    indexedPaths = indexedPaths.filter(p => p !== path);
  } catch (err) {
    console.warn('Failed to remove from index:', path, err);
  }
}

/**
 * Initialize the search modal UI and keyboard shortcuts
 */
export function initSearch() {
  buildIndex();
  createSearchModal();
  wireKeyboardShortcuts();
  wireSearchButton();
}

// ——— Private UI functions ———

let backdropEl = null;
let inputEl = null;
let resultsEl = null;
let selectedIndex = -1;
let currentResults = [];
let debounceTimer = null;

function createSearchModal() {
  // Backdrop
  backdropEl = document.createElement('div');
  backdropEl.className = 'search-backdrop hidden';

  // Modal container
  const modal = document.createElement('div');
  modal.className = 'search-modal';

  // Input
  inputEl = document.createElement('input');
  inputEl.className = 'search-input';
  inputEl.type = 'text';
  inputEl.placeholder = 'Search vault...';

  // Results container
  resultsEl = document.createElement('div');
  resultsEl.className = 'search-results';

  modal.appendChild(inputEl);
  modal.appendChild(resultsEl);
  backdropEl.appendChild(modal);
  document.body.appendChild(backdropEl);

  // Wire events
  backdropEl.addEventListener('click', (e) => {
    if (e.target === backdropEl) {
      closeModal();
    }
  });

  inputEl.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      performSearch(inputEl.value);
    }, 150);
  });

  inputEl.addEventListener('keydown', handleInputKeydown);
}

function wireKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Cmd+Shift+F to open search
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'f') {
      e.preventDefault();
      openModal();
      return;
    }
    // Also handle uppercase F
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'F') {
      e.preventDefault();
      openModal();
      return;
    }
    // Escape to close
    if (e.key === 'Escape' && !backdropEl.classList.contains('hidden')) {
      e.preventDefault();
      closeModal();
    }
  });
}

function wireSearchButton() {
  const btnFind = document.getElementById('btn-find');
  if (btnFind) {
    btnFind.addEventListener('click', () => {
      openModal();
    });
  }
}

function openModal() {
  backdropEl.classList.remove('hidden');
  inputEl.value = '';
  resultsEl.textContent = '';
  selectedIndex = -1;
  currentResults = [];
  inputEl.focus();
}

function closeModal() {
  backdropEl.classList.add('hidden');
  inputEl.value = '';
  resultsEl.textContent = '';
  selectedIndex = -1;
  currentResults = [];
}

function performSearch(query) {
  currentResults = searchVault(query);
  selectedIndex = -1;
  renderResults();
}

function renderResults() {
  resultsEl.textContent = '';

  if (currentResults.length === 0 && inputEl.value.trim()) {
    const empty = document.createElement('div');
    empty.className = 'search-empty';
    empty.textContent = 'No results found';
    resultsEl.appendChild(empty);
    return;
  }

  currentResults.forEach((result, index) => {
    const item = document.createElement('div');
    item.className = 'search-result';
    if (index === selectedIndex) {
      item.classList.add('selected');
    }

    const nameEl = document.createElement('div');
    nameEl.className = 'search-result-name';
    nameEl.textContent = result.name;

    const pathEl = document.createElement('div');
    pathEl.className = 'search-result-path';
    pathEl.textContent = result.path;

    item.appendChild(nameEl);
    item.appendChild(pathEl);

    item.addEventListener('click', () => {
      openResult(result);
    });

    resultsEl.appendChild(item);
  });
}

function handleInputKeydown(e) {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (currentResults.length > 0) {
      selectedIndex = Math.min(selectedIndex + 1, currentResults.length - 1);
      updateSelection();
    }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (currentResults.length > 0) {
      selectedIndex = Math.max(selectedIndex - 1, 0);
      updateSelection();
    }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    if (selectedIndex >= 0 && selectedIndex < currentResults.length) {
      openResult(currentResults[selectedIndex]);
    } else if (currentResults.length > 0) {
      openResult(currentResults[0]);
    }
  }
}

function updateSelection() {
  const items = resultsEl.querySelectorAll('.search-result');
  items.forEach((item, index) => {
    if (index === selectedIndex) {
      item.classList.add('selected');
      item.scrollIntoView({ block: 'nearest' });
    } else {
      item.classList.remove('selected');
    }
  });
}

function openResult(result) {
  closeModal();
  const event = new CustomEvent('satorilite:file-open', {
    detail: { path: result.path, name: result.name }
  });
  window.dispatchEvent(event);
}
