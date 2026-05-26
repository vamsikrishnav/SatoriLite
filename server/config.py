import os
from pathlib import Path

from dotenv import load_dotenv

_vault_path = os.environ.get("SATORILITE_VAULT", ".")
_env_file = Path(_vault_path) / ".satorilite" / ".env"
if _env_file.exists():
    load_dotenv(_env_file)

# AWS / Bedrock
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "us.anthropic.claude-sonnet-4-6-v1")

# FTS (BM25)
BM25_K1 = 1.2
BM25_B = 0.75

# Server
PORT = int(os.environ.get("SATORILITE_PORT", "8000"))
VAULT_PATH = os.environ.get("SATORILITE_VAULT", ".")

# Paths
INDEX_DIR = str(Path(VAULT_PATH) / ".satorilite" / "index")

# Vault registry
REGISTRY_DIR = Path.home() / ".satorilite"
REGISTRY_FILE = REGISTRY_DIR / "vaults.json"


def index_dir_for_vault(vault_path: str) -> str:
    return str(Path(vault_path) / ".satorilite" / "index")
