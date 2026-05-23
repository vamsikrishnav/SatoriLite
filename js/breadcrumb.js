import { getCurrentVaultName } from './app.js';

let bar = null;

export function initBreadcrumb() {
  bar = document.getElementById('breadcrumb-bar');
  if (!bar) return;

  window.addEventListener('satorilite:file-loaded', (e) => {
    render(e.detail.path);
  });

  window.addEventListener('satorilite:content-changed', (e) => {
    if (e.detail.path) {
      render(e.detail.path);
    }
  });
}

function render(filePath) {
  if (!bar) return;
  bar.textContent = '';
  if (!filePath) return;

  const vaultName = getCurrentVaultName();
  const parts = filePath.split('/');
  const segments = vaultName ? [vaultName, ...parts] : parts;

  segments.forEach((seg, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'breadcrumb-separator';
      sep.textContent = '›';
      bar.appendChild(sep);
    }

    const el = document.createElement('span');
    el.className = 'breadcrumb-segment';
    if (i === segments.length - 1) {
      el.classList.add('current');
    } else {
      el.style.cursor = 'pointer';
      el.addEventListener('click', () => {
        const folderName = seg;
        const allFolders = document.querySelectorAll('.tree-folder-name, .tree-item-label, .tree-item');
        for (const folder of allFolders) {
          if (folder.textContent.trim() === folderName) {
            folder.click();
            folder.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            break;
          }
        }
      });
    }
    el.textContent = seg;
    bar.appendChild(el);
  });
}
