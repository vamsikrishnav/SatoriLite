/**
 * tabs.js — Tab bar for open files in SatoriLite
 */

// Module state
let openTabs = [];   // Array of { path, name }
let activeTab = null; // path of the active tab

/** @type {HTMLElement} */
let tabBarEl;

/**
 * Extract the filename from a path
 * @param {string} path
 * @returns {string}
 */
function basename(path) {
  const parts = path.split('/');
  return parts[parts.length - 1];
}

/**
 * Render all tabs into the tab bar
 */
function renderTabs() {
  tabBarEl.textContent = '';

  for (const tab of openTabs) {
    const el = document.createElement('div');
    el.className = 'tab-item' + (tab.path === activeTab ? ' active' : '');
    el.dataset.path = tab.path;

    const nameSpan = document.createElement('span');
    nameSpan.className = 'tab-item-name';
    nameSpan.textContent = tab.name;

    const closeSpan = document.createElement('span');
    closeSpan.className = 'tab-item-close';
    closeSpan.textContent = '×';

    el.appendChild(nameSpan);
    el.appendChild(closeSpan);
    tabBarEl.appendChild(el);
  }
}

/**
 * Close a tab by path
 * @param {string} path
 */
function closeTab(path) {
  const idx = openTabs.findIndex(t => t.path === path);
  if (idx === -1) return;

  openTabs.splice(idx, 1);

  if (activeTab === path) {
    if (openTabs.length > 0) {
      // Activate previous tab, or next if it was the first
      const newIdx = idx > 0 ? idx - 1 : 0;
      activeTab = openTabs[newIdx].path;
      renderTabs();
      // Dispatch file-open to load the new active file
      window.dispatchEvent(new CustomEvent('satorilite:file-open', {
        detail: { path: activeTab }
      }));
    } else {
      activeTab = null;
      renderTabs();
    }
  } else {
    renderTabs();
  }
}

/**
 * Initialize the tab bar
 */
export function initTabs() {
  tabBarEl = document.getElementById('tab-bar');
  if (!tabBarEl) return;

  // Click delegation on tab bar
  tabBarEl.addEventListener('click', (e) => {
    const closeEl = e.target.closest('.tab-item-close');
    if (closeEl) {
      const tabEl = closeEl.closest('.tab-item');
      if (tabEl) {
        closeTab(tabEl.dataset.path);
      }
      return;
    }

    const tabEl = e.target.closest('.tab-item');
    if (tabEl) {
      const path = tabEl.dataset.path;
      // Only dispatch if switching to a different tab
      if (path && path !== activeTab) {
        activeTab = path;
        renderTabs();
        window.dispatchEvent(new CustomEvent('satorilite:file-open', {
          detail: { path }
        }));
      }
    }
  });

  // Listen for file-loaded to add/activate tab
  window.addEventListener('satorilite:file-loaded', (e) => {
    const { path } = e.detail;
    if (!path) return;

    const name = basename(path);

    // Add tab if not already open
    if (!openTabs.find(t => t.path === path)) {
      openTabs.push({ path, name });
    }

    activeTab = path;
    renderTabs();
  });
}
