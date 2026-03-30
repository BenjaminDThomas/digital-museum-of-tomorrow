FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y python3 python3-pip curl && rm -rf /var/lib/apt/lists/*

# Install Ollama CLI
RUN set -ex \
    && curl -L "https://github.com/ollama/ollama/releases/latest/download/ollama_1.14.0_linux_amd64.tar.gz" -o /tmp/ollama.tar.gz \
    && tar -xzf /tmp/ollama.tar.gz -C /tmp \
    && mv /tmp/ollama /usr/local/bin/ollama \
    && chmod +x /usr/local/bin/ollama \
    && rm /tmp/ollama.tar.gz

WORKDIR /app

COPY . /app

RUN pip install --no-cache-dir fastapi uvicorn diffusers transformers accelerate safetensors

# Entrypoint script starts Ollama + FastAPI
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 80
EXPOSE 11434

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["uvicorn", "sd-server.app:app", "--host", "0.0.0.0", "--port", "80", "--workers", "1"]