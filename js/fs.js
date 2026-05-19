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

export async function scanDirectory(dirHandle, path = '') {
  const entries = [];

  for await (const entry of dirHandle.values()) {
    // Skip hidden files, directories starting with '.', and node_modules
    if (entry.name.startsWith('.') || entry.name === 'node_modules') {
      continue;
    }

    const entryPath = path ? `${path}/${entry.name}` : entry.name;
    const entryData = {
      name: entry.name,
      path: entryPath,
      kind: entry.kind,
      handle: entry
    };

    if (entry.kind === 'directory') {
      entryData.children = await scanDirectory(entry, entryPath);
    }

    entries.push(entryData);
  }

  // Sort: directories first, then alphabetical by name
  entries.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === 'directory' ? -1 : 1;
    }
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
