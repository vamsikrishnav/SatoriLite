import { pickDirectory, scanDirectory, setRootHandle } from './fs.js';
import { getRecentVaults, saveVault, removeVault } from './vault-db.js';
import { initTree } from './tree.js';
import { initEditor } from './editor.js';
import { initRenderer } from './renderer.js';
import { initViewMode } from './viewmode.js';
import { initSearch } from './search.js';
import { initThemeChooser } from './themes.js';
import { initStatusBar } from './status-bar.js';
import { initResize } from './resize.js';
import { initTabs } from './tabs.js';
import { initFileOps } from './file-ops.js';
import { initLinkComplete } from './link-complete.js';
import { initCommandPalette } from './command-palette.js';
import { initSyncScroll } from './sync-scroll.js';
import { initLinkPreview } from './link-preview.js';
import { initTOC } from './toc.js';
import { initBacklinks } from './backlinks.js';
import { initChat } from './chat.js';
import { initAIActions } from './ai-actions.js';

// Module state
let vaultTree = null;
let currentVaultName = null;

// Exports
export function getVaultTree() {
  return vaultTree;
}

export function getCurrentVaultName() {
  return currentVaultName;
}

// DOM elements
let vaultChooserEl;
let vaultListEl;
let btnOpenFolderEl;
let appLayoutEl;

/**
 * Initialize the app on page load
 */
function init() {
  // Get DOM elements
  vaultChooserEl = document.getElementById('vault-chooser');
  vaultListEl = document.getElementById('vault-list');
  btnOpenFolderEl = document.getElementById('btn-open-folder');
  appLayoutEl = document.getElementById('app-layout');

  if (!vaultChooserEl || !vaultListEl || !btnOpenFolderEl || !appLayoutEl) {
    console.error('Required DOM elements not found');
    return;
  }

  // Render recent vaults
  renderRecentVaults();

  // Wire "Open Folder" button
  btnOpenFolderEl.addEventListener('click', handleOpenFolder);

  // Wire open-folder event from sidebar
  window.addEventListener('satorilite:open-folder', handleOpenFolder);

  // Wire vault switch from sidebar list
  window.addEventListener('satorilite:switch-vault', async (e) => {
    const vault = e.detail;
    try {
      const permission = await vault.dirHandle.requestPermission({ mode: 'readwrite' });
      if (permission === 'granted') {
        await openVault(vault.name, vault.dirHandle);
      }
    } catch (err) {
      console.error('Failed to switch vault:', err);
    }
  });
}

/**
 * Render the list of recent vaults from IndexedDB
 */
async function renderRecentVaults() {
  try {
    const vaults = await getRecentVaults();

    // Clear the list
    vaultListEl.textContent = '';

    // Create vault items
    vaults.forEach(vault => {
      const vaultItem = createVaultItem(vault);
      vaultListEl.appendChild(vaultItem);
    });
  } catch (err) {
    console.error('Failed to render recent vaults:', err);
  }
}

/**
 * Create a vault item DOM element
 * @param {Object} vault - Vault object with name and dirHandle
 * @returns {HTMLElement}
 */
function createVaultItem(vault) {
  const vaultItem = document.createElement('div');
  vaultItem.className = 'vault-item';
  vaultItem.addEventListener('click', () => handleVaultClick(vault));

  const vaultItemInfo = document.createElement('div');
  vaultItemInfo.className = 'vault-item-info';

  const vaultItemName = document.createElement('div');
  vaultItemName.className = 'vault-item-name';
  vaultItemName.textContent = vault.name;

  vaultItemInfo.appendChild(vaultItemName);

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'vault-item-delete';
  deleteBtn.textContent = '×';
  deleteBtn.title = 'Remove from recents';
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    handleVaultDelete(vault.name);
  });

  vaultItem.appendChild(vaultItemInfo);
  vaultItem.appendChild(deleteBtn);

  return vaultItem;
}

/**
 * Handle clicking on a vault item
 */
async function handleVaultClick(vault) {
  try {
    // Request permission on the stored directory handle
    const permissionStatus = await vault.dirHandle.requestPermission({ mode: 'readwrite' });

    if (permissionStatus === 'granted') {
      await openVault(vault.name, vault.dirHandle);
    } else {
      console.warn('Permission denied for vault:', vault.name);
    }
  } catch (err) {
    console.error('Failed to open vault:', err);
  }
}

/**
 * Handle deleting a vault from recent list
 */
async function handleVaultDelete(vaultName) {
  try {
    await removeVault(vaultName);
    await renderRecentVaults();
  } catch (err) {
    console.error('Failed to delete vault:', err);
  }
}

/**
 * Handle "Open Folder" button click
 */
async function handleOpenFolder() {
  try {
    const dirHandle = await pickDirectory();
    await openVault(dirHandle.name, dirHandle);
  } catch (err) {
    // User cancelled - silently ignore AbortError
    if (err.name === 'AbortError') {
      return;
    }
    console.error('Failed to pick directory:', err);
  }
}

/**
 * Open a vault: scan, save, and show the app
 * @param {string} name - Vault name
 * @param {FileSystemDirectoryHandle} dirHandle - Directory handle
 */
async function openVault(name, dirHandle) {
  try {
    currentVaultName = name;
    setRootHandle(dirHandle);

    // Save to IndexedDB
    await saveVault(name, dirHandle);

    // Scan the directory
    vaultTree = await scanDirectory(dirHandle);

    // Hide vault chooser, show app layout
    vaultChooserEl.classList.add('hidden');
    appLayoutEl.classList.remove('hidden');

    // Dispatch custom event
    const event = new CustomEvent('satorilite:vault-open', {
      detail: {
        name,
        tree: vaultTree
      }
    });
    window.dispatchEvent(event);

    // Initialize the preview renderer, view mode, and editor
    initRenderer();
    initViewMode();
    await initEditor();
    initSearch();
    initLinkComplete();
    initTabs();
    initFileOps();
    initStatusBar();
    initResize();
    initSyncScroll();
    initLinkPreview();
    initTOC();
    initBacklinks();
    initChat();
    initAIActions();
  } catch (err) {
    console.error('Failed to open vault:', err);
  }
}

// Initialize on page load
initThemeChooser();
initCommandPalette();
initTree();
init();
