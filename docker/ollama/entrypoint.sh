#!/bin/sh
set -e

: "${OLLAMA_MODEL:?OLLAMA_MODEL must be set}"

rm -f /tmp/model-ready

ollama serve &
SERVER_PID=$!

until ollama list >/dev/null 2>&1; do
  sleep 1
done

ollama pull "$OLLAMA_MODEL"
touch /tmp/model-ready

wait "$SERVER_PID"
