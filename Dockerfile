FROM ollama/ollama:latest

# Install Python, supervisor, and create virtual environment
RUN apt-get update && apt-get install -y python3 python3-pip python3-venv supervisor && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create virtual environment
RUN python3 -m venv /app/venv

# Activate virtual environment and install packages
ENV PATH="/app/venv/bin:$PATH"
RUN pip install --no-cache-dir fastapi uvicorn diffusers transformers accelerate safetensors

COPY . /app

# Configure supervisor to run both Ollama and FastAPI
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Override the default Ollama entrypoint
ENTRYPOINT []
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]

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