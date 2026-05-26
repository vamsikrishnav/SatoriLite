"""Vault registry — manages known vault paths in ~/.satorilite/vaults.json."""

import json
import logging
from pathlib import Path

from server.config import REGISTRY_DIR, REGISTRY_FILE, index_dir_for_vault

logger = logging.getLogger("satorilite.registry")


def _ensure_registry():
    REGISTRY_DIR.mkdir(parents=True, exist_ok=True)
    if not REGISTRY_FILE.exists():
        REGISTRY_FILE.write_text("[]", encoding="utf-8")


def list_vaults() -> list[dict]:
    """Return all registered vaults with index status."""
    _ensure_registry()
    try:
        vaults = json.loads(REGISTRY_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return []

    results = []
    for v in vaults:
        path = v.get("path", "")
        index_dir = index_dir_for_vault(path)
        has_index = Path(index_dir).exists() and (Path(index_dir) / "index.faiss").exists()
        md_count = sum(1 for _ in Path(path).rglob("*.md")) if Path(path).is_dir() else 0
        results.append({
            "name": v.get("name", Path(path).name),
            "path": path,
            "has_index": has_index,
            "md_files": md_count,
        })
    return results


def add_vault(name: str, path: str) -> dict:
    """Register a new vault. Returns the vault entry."""
    _ensure_registry()
    abs_path = str(Path(path).expanduser().resolve())

    if not Path(abs_path).is_dir():
        raise ValueError(f"Not a valid directory: {abs_path}")

    vaults = json.loads(REGISTRY_FILE.read_text(encoding="utf-8"))

    # Don't add duplicates
    for v in vaults:
        if v["path"] == abs_path:
            return {"name": v["name"], "path": abs_path, "status": "already_registered"}

    entry = {"name": name or Path(abs_path).name, "path": abs_path}
    vaults.append(entry)
    REGISTRY_FILE.write_text(json.dumps(vaults, indent=2), encoding="utf-8")
    logger.info("Registered vault: %s at %s", entry["name"], abs_path)
    return {"name": entry["name"], "path": abs_path, "status": "added"}


def remove_vault(path: str) -> bool:
    """Unregister a vault by path. Returns True if removed."""
    _ensure_registry()
    abs_path = str(Path(path).expanduser().resolve())

    vaults = json.loads(REGISTRY_FILE.read_text(encoding="utf-8"))
    original_len = len(vaults)
    vaults = [v for v in vaults if v["path"] != abs_path]

    if len(vaults) < original_len:
        REGISTRY_FILE.write_text(json.dumps(vaults, indent=2), encoding="utf-8")
        return True
    return False


_ACTIVE_FILE = REGISTRY_DIR / "active_vault"


def get_last_active_vault() -> str | None:
    """Return the path of the last active vault, or None."""
    if _ACTIVE_FILE.exists():
        path = _ACTIVE_FILE.read_text(encoding="utf-8").strip()
        if path and Path(path).is_dir():
            return path
    return None


def set_last_active_vault(vault_path: str) -> None:
    """Persist the currently active vault path."""
    _ensure_registry()
    _ACTIVE_FILE.write_text(vault_path, encoding="utf-8")
