import { getRootHandle, getFileHandle, readFile, writeFile, createFile, createDirectory, deleteEntry } from './fs.js';
import { addToIndex, removeFromIndex } from './search.js';

/**
 * Resolve a directory handle from a path relative to root.
 * Returns rootHandle if path is empty or '/'.
 */
async function resolveDirHandle(folderPath) {
  const root = getRootHandle();
  if (!root) throw new Error('No vault open');
  if (!folderPath || folderPath === '/') return root;

  const parts = folderPath.split('/').filter(Boolean);
  let handle = root;
  for (const part of parts) {
    handle = await handle.getDirectoryHandle(part);
  }
  return handle;
}

/**
 * Generate frontmatter + H1 heading for a new file.
 */
function generateInitialContent(fileName) {
  const now = new Date().toISOString();
  const title = fileName.replace(/\.md$/, '');
  return `---
created: ${now}
modified: ${now}
---
# ${title}
`;
}

/**
 * Create a new markdown file in the specified folder.
 * @param {string} folderPath - Folder path relative to vault root (empty for root)
 * @param {string} fileName - Name of the file to create (should end with .md)
 */
export async function createNewFile(folderPath, fileName) {
  if (!fileName) return;
  if (!fileName.endsWith('.md')) {
    fileName += '.md';
  }

  const dirHandle = await resolveDirHandle(folderPath);
  const fileHandle = await createFile(dirHandle, fileName);

  const content = generateInitialContent(fileName);
  await writeFile(fileHandle, content);

  const filePath = folderPath ? `${folderPath}/${fileName}` : fileName;

  // Update search index
  addToIndex({
    id: filePath,
    name: fileName.replace(/\.md$/, ''),
    path: filePath,
    content
  });

  // Dispatch events
  window.dispatchEvent(new CustomEvent('satorilite:tree-refresh'));
  window.dispatchEvent(new CustomEvent('satorilite:file-open', {
    detail: { path: filePath, name: fileName }
  }));
}

/**
 * Create a new folder inside the given parent path.
 * @param {string} parentPath - Parent directory path (empty for root)
 * @param {string} name - Folder name
 */
export async function createNewFolder(parentPath, name) {
  if (!name) return;

  const parentHandle = await resolveDirHandle(parentPath);
  await createDirectory(parentHandle, name);

  window.dispatchEvent(new CustomEvent('satorilite:tree-refresh'));
}

/**
 * Delete a file or folder at the given path.
 * @param {string} path - Full path relative to vault root
 */
export async function deleteFileOrFolder(path) {
  if (!path) return;

  const parts = path.split('/');
  const entryName = parts.pop();
  const parentPath = parts.join('/');

  const parentHandle = await resolveDirHandle(parentPath);
  await deleteEntry(parentHandle, entryName);

  // Remove from search index (works for files; no-op if not indexed)
  removeFromIndex(path);

  window.dispatchEvent(new CustomEvent('satorilite:tree-refresh'));
}

/**
 * Rename a file. Implemented as read-old, create-new, delete-old.
 * Updates the H1 heading if the first content line is a heading.
 * @param {string} oldPath - Current file path
 * @param {string} newName - New file name (should end with .md)
 */
export async function renameFile(oldPath, newName) {
  if (!oldPath || !newName) return;
  if (!newName.endsWith('.md')) {
    newName += '.md';
  }

  // Read old content
  const oldHandle = await getFileHandle(oldPath);
  let content = await readFile(oldHandle);

  // Update H1 heading if present (after frontmatter)
  const newTitle = newName.replace(/\.md$/, '');
  const lines = content.split('\n');
  let headingUpdated = false;

  for (let i = 0; i < lines.length; i++) {
    // Skip frontmatter
    if (i === 0 && lines[i].trim() === '---') {
      const closeIdx = lines.indexOf('---', 1);
      if (closeIdx > 0) {
        i = closeIdx;
        continue;
      }
    }
    // Find first H1
    if (lines[i].startsWith('# ')) {
      lines[i] = `# ${newTitle}`;
      headingUpdated = true;
      break;
    }
  }

  if (headingUpdated) {
    content = lines.join('\n');
  }

  // Determine parent path
  const parts = oldPath.split('/');
  const oldName = parts.pop();
  const parentPath = parts.join('/');

  const parentHandle = await resolveDirHandle(parentPath);

  // Create new file and write content
  const newHandle = await createFile(parentHandle, newName);
  await writeFile(newHandle, content);

  // Delete old file
  await deleteEntry(parentHandle, oldName);

  const newPath = parentPath ? `${parentPath}/${newName}` : newName;

  // Update search index
  removeFromIndex(oldPath);
  addToIndex({
    id: newPath,
    name: newName.replace(/\.md$/, ''),
    path: newPath,
    content
  });

  // Dispatch events
  window.dispatchEvent(new CustomEvent('satorilite:tree-refresh'));
  window.dispatchEvent(new CustomEvent('satorilite:file-open', {
    detail: { path: newPath, name: newName }
  }));
}

/**
 * Initialize file operations keyboard shortcuts.
 * Cmd+N prompts for a filename and creates in vault root.
 */
export function initFileOps() {
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
      e.preventDefault();
      const fileName = prompt('New file name:');
      if (fileName) {
        createNewFile('', fileName);
      }
    }
  });
}
