# Digital Museum of Tomorrow

Digital Museum of Tomorrow is a web app for exploring V&A collection content with local AI services.

This README is deployment-focused and explains:

- how to deploy with Docker
- how to run with NVIDIA GPU acceleration
- how to run in CPU-only mode when no NVIDIA GPU is available

## Deployment architecture

The repository runs as one container service, `museum-app`, managed by Docker Compose.

Inside the container:

- `ollama serve` runs on port `11434`
- FastAPI serves both the static front end and Stable Diffusion API routes on port `80`
- `supervisord` starts and monitors both processes

Public endpoints:

- App UI: `http://localhost/`
- Stable Diffusion API: `http://localhost/sdapi/v1/*`
- Ollama API: `http://localhost:11434/api/*`

## Prerequisites

- Docker Desktop (Windows/macOS) or Docker Engine (Linux)
- Docker Compose v2 (`docker compose`)
- Internet access for first-time model downloads

Optional for GPU mode:

- NVIDIA GPU
- Current NVIDIA driver
- NVIDIA Container Toolkit/runtime available to Docker

## Quick deploy (GPU mode)

Use this mode if you have a supported NVIDIA GPU and container runtime.

```powershell
docker compose build
docker compose up -d
```

Then open:

- `http://localhost/`

Check service status:

```powershell
docker compose ps
docker compose logs -f museum-app
```

Stop:

```powershell
docker compose down
```

## CPU-only deployment (no NVIDIA GPU)

Use the dedicated CPU compose file (already included in this repository): `docker-compose.cpu.yml`.

Start CPU mode:

```powershell
docker compose -f docker-compose.cpu.yml up -d --build
```

Stop CPU mode:

```powershell
docker compose -f docker-compose.cpu.yml down
```

Important notes for CPU mode:

- The app works without NVIDIA hardware.
- Stable Diffusion image generation is significantly slower on CPU.
- Ollama model responses may also be slower depending on your CPU/RAM.

How to confirm CPU mode is active:

- `docker compose -f docker-compose.cpu.yml ps` shows container is running.
- No NVIDIA runtime errors appear in `docker compose -f docker-compose.cpu.yml logs museum-app`.
- The app loads at `http://localhost/` and `/sdapi/v1/sd-models` returns model metadata.

Quick mode switch summary:

- GPU mode: `docker compose up -d --build`
- CPU mode: `docker compose -f docker-compose.cpu.yml up -d --build`

## Configuration

Main environment variables in `docker-compose.yml`:

- `OLLAMA_MODEL` (default: `phi3:mini`)
- `MODEL_ID` for Stable Diffusion (default: `runwayml/stable-diffusion-v1-5`)

Example:

```yaml
environment:
  - OLLAMA_MODEL=phi3:mini
  - MODEL_ID=runwayml/stable-diffusion-v1-5
```

Rebuild after changes:

```powershell
docker compose up -d --build
```

## First-start behavior

On first deployment:

- Ollama may pull the configured model before chat features are usable.
- Stable Diffusion downloads model weights from Hugging Face on first load.

During warm-up, generation endpoints can briefly return `503` until the model is ready.

## Deploying to a server

For a VM or on-prem host:

1. Install Docker + Compose.
2. Clone this repository.
3. Choose mode:
- NVIDIA host: run the default `docker-compose.yml`.
- CPU-only host: run `docker-compose.cpu.yml`.
4. Run `docker compose up -d --build`.
5. Expose ports `80` and `11434` only as needed.

Recommended production hardening:

- Put a reverse proxy/TLS terminator in front of port `80`.
- Restrict public access to port `11434` (Ollama API).
- Add monitoring for container health and disk usage (models can be large).

## Troubleshooting deployment

`Error response from daemon: could not select device driver "" with capabilities: [[gpu]]`

- Cause: GPU mode enabled on a non-NVIDIA or non-configured host.
- Fix: run CPU mode with `docker compose -f docker-compose.cpu.yml up -d --build`.

`Stable Diffusion model is still loading`

- Cause: first-time model download/warm-up.
- Fix: wait and retry; monitor logs with `docker compose logs -f museum-app`.

`Ollama model not found`

- Cause: model pull still in progress or failed.
- Fix: check logs and confirm `OLLAMA_MODEL` value.

## Local development notes

- Front-end files are served from the same FastAPI container as `/`.
- Stable Diffusion routes are available at `/sdapi/v1/*`.
- If you change model names/endpoints, update both environment values and any hardcoded front-end model references.
