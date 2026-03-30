#!/bin/bash
set -e

MODEL="${OLLAMA_MODEL:-phi3:mini}"

echo "Waiting for Ollama to be ready..."
until curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; do
  sleep 2
done
echo "Ollama is ready."

if ollama list | grep -q "^${MODEL}"; then
  echo "Model ${MODEL} already present, skipping pull."
else
  echo "Pulling model ${MODEL}..."
  ollama pull "${MODEL}"
  echo "Model ${MODEL} pulled successfully."
fi
