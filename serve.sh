#!/bin/sh
# Start PWA static server
python3 -m http.server 8000 &

# RAG server starts only if vault path is set or current dir contains .md files
if [ -n "$SATORILITE_VAULT" ] || find . -maxdepth 1 -name "*.md" -print -quit 2>/dev/null | grep -q .; then
  python3 -m server --vault "${SATORILITE_VAULT:-.}" --port 8787 &
fi

open "http://localhost:8000" 2>/dev/null
wait
