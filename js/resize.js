/**
 * Resize Module
 * Handles sidebar toggle and keyboard shortcut.
 */

const STORAGE_KEY = 'satorilite:sidebarCollapsed';

/**
 * Toggle the left sidebar collapsed state
 */
export function toggleLeftSidebar() {
  const appLayout = document.querySelector('.app-layout');
  if (!appLayout) return;

  appLayout.classList.toggle('sidebar-collapsed');
  const collapsed = appLayout.classList.contains('sidebar-collapsed');
  localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
}

/**
 * Initialize resize: restore state, wire shortcut and button
 */
export function initResize() {
  // Restore collapsed state from localStorage
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === '1') {
    const appLayout = document.querySelector('.app-layout');
    if (appLayout) {
      appLayout.classList.add('sidebar-collapsed');
    }
  }

  // Wire Cmd+B / Ctrl+B keyboard shortcut
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
      e.preventDefault();
      toggleLeftSidebar();
    }
  });

  // Wire sidebar toggle button if it exists
  const btnSidebar = document.getElementById('btn-sidebar');
  if (btnSidebar) {
    btnSidebar.addEventListener('click', toggleLeftSidebar);
  }
}
