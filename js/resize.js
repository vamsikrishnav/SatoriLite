/**
 * Resize Module
 * Handles sidebar toggle, keyboard shortcuts, and drag-resize for right sidebar.
 */

import { showPanel } from './toc.js';

const STORAGE_KEY = 'satorilite:sidebarCollapsed';
const RIGHT_WIDTH_KEY = 'satorilite:rightSidebarWidth';

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
 * Toggle the right sidebar collapsed state
 */
export function toggleRightSidebar() {
  const sidebar = document.getElementById('sidebar-right');
  if (!sidebar) return;

  sidebar.classList.toggle('collapsed');

  if (!sidebar.classList.contains('collapsed')) {
    const stored = localStorage.getItem(RIGHT_WIDTH_KEY);
    if (stored) sidebar.style.width = stored;
  }
}

/**
 * Initialize resize: restore state, wire shortcut and button
 */
export function initResize() {
  // Restore left sidebar collapsed state
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

  // Wire chat button to show chat panel in right sidebar
  const btnChat = document.getElementById('btn-chat');
  if (btnChat) {
    btnChat.addEventListener('click', () => showPanel('chat'));
  }

  // Drag-resize for right sidebar
  const handle = document.getElementById('resize-handle-right');
  const sidebar = document.getElementById('sidebar-right');
  if (handle && sidebar) {
    let startX, startWidth;

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startX = e.clientX;
      startWidth = sidebar.offsetWidth;
      handle.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';

      function onMove(e) {
        const delta = startX - e.clientX;
        const newWidth = Math.max(180, Math.min(600, startWidth + delta));
        sidebar.style.width = newWidth + 'px';
      }

      function onUp() {
        handle.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        localStorage.setItem(RIGHT_WIDTH_KEY, sidebar.style.width);
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  // Restore right sidebar width
  const rightSidebar = document.getElementById('sidebar-right');
  const storedWidth = localStorage.getItem(RIGHT_WIDTH_KEY);
  if (rightSidebar && storedWidth) {
    rightSidebar.style.width = storedWidth;
  }
}
