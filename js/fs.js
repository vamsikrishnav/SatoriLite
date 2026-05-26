// File System Access API abstraction
let rootHandle = null;

export function getRootHandle() {
  return rootHandle;
}

export function setRootHandle(handle) {
  rootHandle = handle;
}

export async function pickDirectory() {
  const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
  rootHandle = handle;
  return handle;
}

const NOTES_FOLDERS = new Set(['wiki', 'notes', 'docs']);

export async function scanDirectory(dirHandle, path = '', isNotesRoot = false) {
  const entries = [];

  // Detect if the vault root itself is a notes folder
  if (path === '' && !isNotesRoot) {
    isNotesRoot = NOTES_FOLDERS.has(dirHandle.name.toLowerCase());
  }

  for await (const entry of dirHandle.values()) {
    if (entry.name.startsWith('.') || entry.name.toLowerCase() === 'claude.md') continue;

    // At root of a project folder, only enter wiki/notes/docs subfolders
    if (path === '' && !isNotesRoot && entry.kind === 'directory' && !NOTES_FOLDERS.has(entry.name.toLowerCase())) {
      continue;
    }

    const entryPath = path ? `${path}/${entry.name}` : entry.name;

    if (entry.kind === 'directory') {
      const children = await scanDirectory(entry, entryPath);
      entries.push({ name: entry.name, path: entryPath, kind: 'directory', handle: entry, children });
    } else if (entry.name.endsWith('.md')) {
      entries.push({ name: entry.name, path: entryPath, kind: 'file', handle: entry });
    }
  }

  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return entries;
}

export async function readFile(fileHandle) {
  const file = await fileHandle.getFile();
  return await file.text();
}

export async function writeFile(fileHandle, content) {
  const writable = await fileHandle.createWritable();
  await writable.write(content);
  await writable.close();
}

export async function getFileHandle(path) {
  if (!rootHandle) {
    throw new Error('No root directory handle set');
  }

  const parts = path.split('/');
  let handle = rootHandle;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const isLast = i === parts.length - 1;

    if (isLast) {
      handle = await handle.getFileHandle(part);
    } else {
      handle = await handle.getDirectoryHandle(part);
    }
  }

  return handle;
}

export async function createFile(dirHandle, name) {
  return await dirHandle.getFileHandle(name, { create: true });
}

export async function createDirectory(parentHandle, name) {
  return await parentHandle.getDirectoryHandle(name, { create: true });
}

export async function deleteEntry(parentHandle, name) {
  await parentHandle.removeEntry(name, { recursive: true });
}

export async function renameEntry(oldParentHandle, oldName, newParentHandle, newName) {
  // Read old file content
  const oldHandle = await oldParentHandle.getFileHandle(oldName);
  const content = await readFile(oldHandle);

  // Create new file
  const newHandle = await createFile(newParentHandle, newName);
  await writeFile(newHandle, content);

  // Delete old file
  await deleteEntry(oldParentHandle, oldName);

  return newHandle;
}
