import { getVaultTree } from './app.js';

let modal = null;
let input = null;
let resultsList = null;
let files = [];
let filteredFiles = [];
let selectedIndex = 0;

function flattenTree(tree, prefix = '') {
  const result = [];
  if (!tree) return result;
  for (const node of tree) {
    const nodePath = prefix ? `${prefix}/${node.name}` : node.name;
    if (node.kind === 'file') {
      result.push({ name: node.name, path: node.path || nodePath, relativePath: nodePath });
    } else if (node.kind === 'directory' && node.children) {
      result.push(...flattenTree(node.children, nodePath));
    }
  }
  return result;
}

function fuzzyMatch(query, target) {
  const lowerQuery = query.toLowerCase();
  const lowerTarget = target.toLowerCase();
  const indices = [];
  let qi = 0;
  for (let ti = 0; ti < lowerTarget.length && qi < lowerQuery.length; ti++) {
    if (lowerTarget[ti] === lowerQuery[qi]) {
      indices.push(ti);
      qi++;
    }
  }
  return qi === lowerQuery.length ? indices : null;
}

function highlightMatches(name, indices) {
  const set = new Set(indices);
  const fragment = document.createDocumentFragment();
  for (let i = 0; i < name.length; i++) {
    if (set.has(i)) {
      const span = document.createElement('span');
      span.className = 'switcher-highlight';
      span.textContent = name[i];
      fragment.appendChild(span);
    } else {
      fragment.appendChild(document.createTextNode(name[i]));
    }
  }
  return fragment;
}

function filterAndRender() {
  const query = input.value.trim();
  if (!query) {
    filteredFiles = files.map(f => ({ ...f, matchIndices: null }));
  } else {
    filteredFiles = [];
    for (const file of files) {
      const indices = fuzzyMatch(query, file.name);
      if (indices) {
        filteredFiles.push({ ...file, matchIndices: indices });
      }
    }
  }
  selectedIndex = 0;
  renderResults();
}

function renderResults() {
  resultsList.replaceChildren();
  const maxShow = 20;
  const toShow = filteredFiles.slice(0, maxShow);
  for (let i = 0; i < toShow.length; i++) {
    const file = toShow[i];
    const div = document.createElement('div');
    div.className = 'switcher-result' + (i === selectedIndex ? ' selected' : '');

    const nameEl = document.createElement('div');
    nameEl.className = 'switcher-result-name';
    if (file.matchIndices) {
      nameEl.appendChild(highlightMatches(file.name, file.matchIndices));
    } else {
      nameEl.textContent = file.name;
    }

    const pathEl = document.createElement('div');
    pathEl.className = 'switcher-result-path';
    pathEl.textContent = file.relativePath;

    div.appendChild(nameEl);
    div.appendChild(pathEl);
    div.addEventListener('click', () => openSelected(i));
    resultsList.appendChild(div);
  }
  scrollSelectedIntoView();
}

function scrollSelectedIntoView() {
  const selected = resultsList.querySelector('.switcher-result.selected');
  if (selected) selected.scrollIntoView({ block: 'nearest' });
}

function openSelected(index) {
  const file = filteredFiles[index];
  if (!file) return;
  window.dispatchEvent(new CustomEvent('satorilite:file-open', { detail: { path: file.path } }));
  closeSwitcher();
}

function openSwitcher() {
  if (!modal) return;
  files = flattenTree(getVaultTree());
  filteredFiles = files.map(f => ({ ...f, matchIndices: null }));
  selectedIndex = 0;
  modal.classList.remove('hidden');
  input.value = '';
  renderResults();
  input.focus();
}

function closeSwitcher() {
  if (!modal) return;
  modal.classList.add('hidden');
  input.value = '';
}

export function initSwitcher() {
  if (modal) return;

  const backdrop = document.createElement('div');
  backdrop.className = 'switcher-backdrop hidden';
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) closeSwitcher();
  });

  const modalEl = document.createElement('div');
  modalEl.className = 'switcher-modal';

  const inputEl = document.createElement('input');
  inputEl.className = 'switcher-input';
  inputEl.type = 'text';
  inputEl.placeholder = 'Quick open file...';
  inputEl.addEventListener('input', filterAndRender);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (selectedIndex < filteredFiles.length - 1) { selectedIndex++; renderResults(); }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (selectedIndex > 0) { selectedIndex--; renderResults(); }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      openSelected(selectedIndex);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSwitcher();
    }
  });

  const resultsEl = document.createElement('div');
  resultsEl.className = 'switcher-results';

  modalEl.appendChild(inputEl);
  modalEl.appendChild(resultsEl);
  backdrop.appendChild(modalEl);
  document.body.appendChild(backdrop);

  modal = backdrop;
  input = inputEl;
  resultsList = resultsEl;

  document.addEventListener('keydown', (e) => {
    const modifier = navigator.platform.includes('Mac') ? e.metaKey : e.ctrlKey;
    if (modifier && e.key === 'p') {
      e.preventDefault();
      if (getVaultTree()) openSwitcher();
    }
  });
}
