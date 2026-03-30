#!/usr/bin/env bash
set -euo pipefail

if ! command -v ollama >/dev/null 2>&1; then
  echo "Ollama is not installed."
  exit 1
fi

# Build Ollama serve args from env
OLLAMA_SERVE_ARGS="${OLLAMA_SERVE_ARGS:-}"
if [ "${OLLAMA_GPU:-}" = "0" ] || [ "${OLLAMA_GPU:-}" = "false" ]; then
  echo "Ollama GPU disabled (CPU-only mode)"
  OLLAMA_SERVE_ARGS="$OLLAMA_SERVE_ARGS --no-gpu"
elif [ -n "${OLLAMA_GPU:-}" ]; then
  echo "Ollama GPU mode: $OLLAMA_GPU"
  OLLAMA_SERVE_ARGS="$OLLAMA_SERVE_ARGS --gpus ${OLLAMA_GPU}"
fi

# Start Ollama server in background and keep PID
ollama serve --port 11434 $OLLAMA_SERVE_ARGS &
OLLAMA_PID=$!

cleanup() {
  echo "Shutting down Ollama (pid $OLLAMA_PID)..."
  kill "$OLLAMA_PID" 2>/dev/null || true
}
trap cleanup EXIT

# Optional model preload (e.g. phi3:mini)
if [ -n "${OLLAMA_MODEL:-}" ]; then
  echo "Pulling Ollama model: $OLLAMA_MODEL"
  ollama pull "$OLLAMA_MODEL" || true
fi

# Wait for Ollama to become ready
for i in {1..15}; do
  if curl -sSf http://localhost:11434/api/tags >/dev/null 2>&1; then
    break
  fi
  echo "Waiting for Ollama to start... ($i/15)"
  sleep 2
done

exec "$@"
