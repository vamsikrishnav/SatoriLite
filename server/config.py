import os
from pathlib import Path

from dotenv import load_dotenv

_vault_path = os.environ.get("SATORILITE_VAULT", ".")
_env_file = Path(_vault_path) / ".satorilite" / ".env"
if _env_file.exists():
    load_dotenv(_env_file)

# Embedding
EMBED_DIM = 1024
EMBED_BATCH_SIZE = 20
TEXT_TRUNCATE_CHARS = 20000

# Chunking
MIN_CHUNK_WORDS = 50
CHUNK_OVERLAP_LINES = 3

# Search
SIMILARITY_THRESHOLD = 0.3
BM25_K1 = 1.2
BM25_B = 0.75

# AWS
AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")
BEDROCK_EMBED_MODEL = os.environ.get("BEDROCK_EMBED_MODEL", "amazon.titan-embed-text-v2:0")
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "anthropic.claude-sonnet-4-20250514")

# Server
PORT = int(os.environ.get("SATORILITE_PORT", "8000"))
VAULT_PATH = os.environ.get("SATORILITE_VAULT", ".")

# Paths (index stored inside the vault)
INDEX_DIR = str(Path(VAULT_PATH) / ".satorilite" / "index")

# Vault registry
REGISTRY_DIR = Path.home() / ".satorilite"
REGISTRY_FILE = REGISTRY_DIR / "vaults.json"

# RAG pipeline
RRF_K = 60

# Graph
GRAPH_MAX_HOPS = 2
GRAPH_HOP_WEIGHTS = {0: 1.0, 1: 0.7, 2: 0.4}


def index_dir_for_vault(vault_path: str) -> str:
    return str(Path(vault_path) / ".satorilite" / "index")
