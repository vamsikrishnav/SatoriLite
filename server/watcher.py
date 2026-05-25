"""File system watcher using watchdog. Monitors vault directories and pushes
change events to connected WebSocket clients."""

import asyncio
import json
import os
import time
from pathlib import Path
from typing import Any

from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileSystemEvent


class VaultEventHandler(FileSystemEventHandler):
    """Handles filesystem events and queues them for WebSocket broadcast."""

    def __init__(self, queue: asyncio.Queue, loop: asyncio.AbstractEventLoop):
        super().__init__()
        self._queue = queue
        self._loop = loop
        self._last_mtime: dict[str, float] = {}

    def _enqueue(self, event_type: str, path: str, is_directory: bool) -> None:
        payload = json.dumps({
            "type": event_type,
            "path": path,
            "isDirectory": is_directory,
        })
        self._loop.call_soon_threadsafe(self._queue.put_nowait, payload)

    def _mtime_changed(self, path: str) -> bool:
        """Only fire if the file's mtime actually changed (filters metadata-only events)."""
        try:
            mtime = os.path.getmtime(path)
        except OSError:
            return True
        prev = self._last_mtime.get(path)
        if prev is not None and mtime == prev:
            return False
        self._last_mtime[path] = mtime
        return True

    def on_created(self, event: FileSystemEvent) -> None:
        if not event.is_directory:
            self._last_mtime[event.src_path] = time.time()
        self._enqueue("created", event.src_path, event.is_directory)

    def on_modified(self, event: FileSystemEvent) -> None:
        if event.is_directory:
            return
        if not self._mtime_changed(event.src_path):
            return
        self._enqueue("modified", event.src_path, event.is_directory)

    def on_deleted(self, event: FileSystemEvent) -> None:
        self._last_mtime.pop(event.src_path, None)
        self._enqueue("deleted", event.src_path, event.is_directory)

    def on_moved(self, event: FileSystemEvent) -> None:
        self._last_mtime.pop(event.src_path, None)
        self._enqueue("moved", event.dest_path, event.is_directory)


class VaultWatcher:
    """Manages watchdog observers for vault directories."""

    def __init__(self, queue: asyncio.Queue, loop: asyncio.AbstractEventLoop):
        self._queue = queue
        self._loop = loop
        self._observers: dict[str, Any] = {}

    def watch(self, vault_path: str) -> None:
        """Start watching a vault directory. Idempotent for a given path."""
        real_path = str(Path(vault_path).resolve())
        if real_path in self._observers:
            return
        if not Path(real_path).is_dir():
            return

        handler = VaultEventHandler(self._queue, self._loop)
        observer = Observer()
        observer.schedule(handler, real_path, recursive=True)
        observer.daemon = True
        observer.start()
        self._observers[real_path] = observer

    def unwatch(self, vault_path: str) -> None:
        """Stop watching a vault directory."""
        real_path = str(Path(vault_path).resolve())
        observer = self._observers.pop(real_path, None)
        if observer:
            observer.stop()
            observer.join(timeout=2)

    def stop_all(self) -> None:
        """Stop all observers."""
        for observer in self._observers.values():
            observer.stop()
        for observer in self._observers.values():
            observer.join(timeout=2)
        self._observers.clear()
