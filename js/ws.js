import { getRootHandle } from './fs.js';
import { getCurrentFilePath, openFile } from './editor.js';

let socket = null;
let reconnectAttempts = 0;
let reconnectTimer = null;
let treeRefreshTimer = null;
let fileReloadTimers = new Map();

const MAX_RECONNECT_ATTEMPTS = 10;
const MAX_BACKOFF_MS = 30000;
const TREE_DEBOUNCE_MS = 300;
const FILE_RELOAD_DEBOUNCE_MS = 500;

export function initWebSocket() {
  connect();
}

export function disconnectWebSocket() {
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  reconnectAttempts = 0;
  if (socket) {
    socket.onclose = null;
    socket.close();
    socket = null;
  }
  setStatus(false);
}

function setStatus(connected) {
  const dot = document.getElementById('ws-status-dot');
  if (dot) {
    dot.classList.toggle('connected', connected);
    dot.title = connected ? 'Live reload connected' : 'Live reload disconnected';
  }
}

function connect() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${protocol}//${window.location.host}/ws`;

  try {
    socket = new WebSocket(url);
  } catch (err) {
    scheduleReconnect();
    return;
  }

  socket.onopen = () => {
    reconnectAttempts = 0;
    setStatus(true);
  };

  socket.onmessage = (event) => {
    handleMessage(event.data);
  };

  socket.onclose = () => {
    setStatus(false);
    scheduleReconnect();
  };

  socket.onerror = () => {
    setStatus(false);
  };
}

function scheduleReconnect() {
  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
  const delay = Math.min(2000 * Math.pow(2, reconnectAttempts), MAX_BACKOFF_MS);
  reconnectAttempts++;
  reconnectTimer = setTimeout(connect, delay);
}

function handleMessage(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch (err) {
    return;
  }

  const { type, path, isDirectory, status } = msg;

  if (type === 'indexing') {
    const dot = document.getElementById('ws-status-dot');
    if (dot) {
      dot.classList.toggle('indexing', status === 'busy');
    }
    return;
  }

  switch (type) {
    case 'created':
    case 'deleted':
    case 'moved':
      debouncedTreeRefresh();
      break;
    case 'modified':
      if (!isDirectory) {
        debouncedTreeRefresh();
        debouncedFileReload(path);
      }
      break;
  }
}

function debouncedTreeRefresh() {
  clearTimeout(treeRefreshTimer);
  treeRefreshTimer = setTimeout(() => {
    const rootHandle = getRootHandle();
    if (rootHandle) {
      window.dispatchEvent(new CustomEvent('satorilite:tree-refresh'));
    }
  }, TREE_DEBOUNCE_MS);
}

function debouncedFileReload(changedPath) {
  const currentPath = getCurrentFilePath();
  if (!currentPath) return;

  if (!changedPath.endsWith(currentPath)) return;

  if (fileReloadTimers.has(currentPath)) {
    clearTimeout(fileReloadTimers.get(currentPath));
  }

  const timer = setTimeout(() => {
    fileReloadTimers.delete(currentPath);
    if (getCurrentFilePath() === currentPath) {
      openFile(currentPath);
    }
  }, FILE_RELOAD_DEBOUNCE_MS);

  fileReloadTimers.set(currentPath, timer);
}
