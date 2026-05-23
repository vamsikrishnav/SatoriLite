#!/bin/sh
exec python -m server --vault "${SATORILITE_VAULT:-.}" --port 8000 --host 0.0.0.0
