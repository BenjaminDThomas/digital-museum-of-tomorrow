FROM pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y python3 python3-pip && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . /app

RUN pip install --no-cache-dir fastapi uvicorn diffusers transformers accelerate safetensors

EXPOSE 80

# Run FastAPI app that serves both API and static frontend
CMD ["uvicorn", "sd-server.app:app", "--host", "0.0.0.0", "--port", "80", "--workers", "1"]