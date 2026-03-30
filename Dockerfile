FROM ollama/ollama:latest

# Install Python, supervisor, curl, and create virtual environment
RUN apt-get update && apt-get install -y python3 python3-pip python3-venv supervisor curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Create virtual environment
RUN python3 -m venv /app/venv

# Activate virtual environment and install packages
ENV PATH="/app/venv/bin:$PATH"
RUN pip install --no-cache-dir fastapi uvicorn diffusers transformers accelerate safetensors

COPY . /app

# Strip Windows CRLF line endings and make executable
RUN sed -i 's/\r//' /app/pull-model.sh && chmod +x /app/pull-model.sh

# Configure supervisor to run both Ollama and FastAPI
COPY supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# Override the default Ollama entrypoint
ENTRYPOINT []
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisord.conf"]

EXPOSE 80 11434