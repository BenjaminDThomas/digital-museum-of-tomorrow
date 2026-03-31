# Digital Museum of Tomorrow

Digital Museum of Tomorrow is a browser-based prototype for exploring the Victoria and Albert Museum collection through a mix of public collection data, local language models, and local image generation. The project combines a static front end with a small Stable Diffusion API service for visual reimagining.

As of March 26, 2026, the live feature set in this repository includes:

- Ask the Collection: a chat interface backed by the V&A Collections API and a local Ollama model
- Discover: a recommendation experience with personalised, serendipitous, and underrepresented collection modes
- Visual Search: image-led or text-led discovery assisted by a local Ollama model
- Reimagine: text interpretation plus AI-generated visual reimagining for selected artefacts
- AI and Trust: documentation about transparency, accessibility, bias, and limitations

## Project structure

```text
digital-museum-of-tomorrow/
├── index.html
├── main.js
├── Dockerfile
├── docker-compose.yml
├── nginx.conf
├── README.md
├── css/
│   ├── main.css
│   └── tokens.css
├── pages/
│   ├── chatbot.html
│   ├── generative.html
│   ├── recommender.html
│   ├── transparency.html
│   └── visual.html
├── design/
├── desk research/
└── sd-server/
    ├── app.py
    └── Dockerfile
```

## Current architecture

The project is now unified into a single container managed by supervisord.

- One Docker image / service (`museum-app`) runs everything
- `Ollama` server runs on port `11434` (managed by supervisord)
- `FastAPI` serves the static front end from `/` plus the Stable Diffusion API under `/sdapi/v1/` on port `80` (managed by supervisord)
- Both services start automatically when the container starts

The app integrates with external services directly from the browser:

- V&A Collections API: `https://api.vam.ac.uk/v2`
- Ollama chat API: `http://localhost:11434/api/chat`

## Features

### Ask the Collection

- Uses the V&A Collections API for collection grounding
- Uses Ollama at `http://localhost:11434/api/chat`
- Current model in the codebase: `phi3:mini`
- Supports streamed responses in the chat UI
- Can suggest related collection searches from the response

### Discover

- Builds recommendations from live V&A API search results
- Supports three discovery modes:
    - Personalised
    - Serendipitous
    - Underrepresented
- Includes client-side filters for interests, materials, regions, and time period
- Adds AI-style explanation tags to recommendation cards

### Visual Search

- Accepts an uploaded image or a text description
- Uses Ollama with `phi3:mini` to propose tentative attributes and search suggestions
- Falls back to direct V&A API search when model-assisted parsing fails
- Keeps uploads in-browser only; there is no storage layer in this repository

### Reimagine

- Uses Ollama with `phi3:mini` for structured JSON interpretation output
- Generates text through interpretive lenses such as cultural, historical, material, symbolic, maker, and contemporary
- Triggers Stable Diffusion image generation in parallel with the text interpretation
- Calls the local Stable Diffusion API at `http://localhost/sdapi/v1/txt2img` when the frontend is served from a local preview server, otherwise uses same-origin `/sdapi/v1/txt2img`
- Checks Stable Diffusion readiness through `http://localhost/sdapi/v1/sd-models` when needed, otherwise same-origin `/sdapi/v1/sd-models`

### AI and Trust

- Explains the role of AI in each tool
- Documents caveats, accessibility support, and bias limitations
- Frames generated outputs as interpretation rather than authoritative museum fact

## Front-end behavior

Shared logic in `main.js` currently provides:

- responsive navigation behavior
- accessibility controls for large text and high contrast
- localStorage persistence for accessibility preferences
- V&A API request throttling and daily quota tracking in the browser
- short-lived response caching for API calls
- artefact card rendering and object detail modal behavior

## Dependencies and services

### V&A Collections API

The site uses the public V&A API for search and object detail retrieval.

Common endpoints used by the UI:

- `GET /v2/objects/search`
- `GET /v2/object/{id}`

### Ollama

The unified Docker image now includes Ollama server managed by supervisord, exposing it on port `11434`.

Ollama API endpoints:

- `http://localhost:11434/api/chat`
- `http://localhost:11434/api/tags`

Default model used by the UI:

- `phi3:mini` for chatbot, visual search, and generative interpretation

Set Ollama model in `docker-compose.yml`:

```yaml
services:
  museum-app:
    environment:
      - OLLAMA_MODEL=phi3:mini
```

Ollama is automatically started by supervisord inside the container; no separate service is needed.

### Stable Diffusion service

The unified container runs a `sd-server` FastAPI app for image generation:

- Base image: `ollama/ollama:latest` (includes Ollama + Python environment)
- Dependency: `fastapi`, `uvicorn`, `diffusers`, `transformers`, `accelerate`, `safetensors`
- FastAPI runs on port `80`
- Default SD model: `runwayml/stable-diffusion-v1-5`

Current API routes exposed by `sd-server/app.py`:

- `GET /sdapi/v1/sd-models`
- `POST /sdapi/v1/txt2img`

On first startup, the Stable Diffusion model may need to download from Hugging Face before image generation is available. During that period, the readiness endpoint will report that the model is still loading and the frontend will show a loading status instead of attempting generation.

Process management: Both Ollama and FastAPI are managed by supervisord.

## Docker setup

### One-image service in docker-compose

`docker-compose.yml` now defines:

- `museum-app`: single container running Ollama + FastAPI via supervisord

The unified container:

- builds from root `Dockerfile` using `ollama/ollama:latest` as base
- copies both frontend and `sd-server` code into `/app`
- installs Python and FastAPI dependencies in a virtual environment
- starts supervisord which manages both Ollama and FastAPI processes
- exposes port `80` (FastAPI) and `11434` (Ollama)
- supports GPU via `gpus: all`

### Start and stop

```powershell
docker-compose build
docker-compose up -d
```

Access the app:

- UI + SD API: `http://localhost/`
- Ollama API: `http://localhost:11434/api/`

Stop:

```powershell
docker-compose down
```

This repository has been verified on a Windows machine with Docker, NVIDIA runtime support, and an NVIDIA GPU available to the container.

### Rebuild after changes

```powershell
docker-compose up --build -d
```

### GPU requirements for image generation

For GPU-backed Stable Diffusion generation, you need:

- Docker Desktop or Docker Engine working on the host
- NVIDIA drivers installed on the host
- NVIDIA container runtime available to Docker
- a compatible NVIDIA GPU

If GPU access is not available, the PyTorch image may still run in CPU mode, but image generation will be much slower.

## Running without Docker

You can run the static front end without Docker using any static file server.

Examples:

```powershell
python -m http.server 8080
```

```powershell
npx serve .
```

You will still need local services for:

- Ollama on port `11434`
- FastAPI SD routes (`/sdapi/v1/*`) reachable from the same origin as the frontend, or configure equivalent routing

If you run the HTML through a dev static server such as VS Code Live Server (`127.0.0.1:5500`), the frontend now targets `http://localhost/sdapi/v1/*` automatically so requests reach the Docker container instead of the static file server.

Opening `index.html` directly in the browser may work for basic navigation, but a local server is the safer option for development and service integration.


## Accessibility

The current site includes:

- semantic page structure and ARIA labeling
- keyboard-accessible navigation and controls
- skip link for main content
- large text mode
- high contrast mode
- saved user accessibility preferences in localStorage
- status and live regions in AI-heavy interfaces

## Design system

The visual system is built around:

- `css/tokens.css` for design tokens
- `css/main.css` for shared styling
- Cormorant Garamond for display typography
- DM Sans for body typography

The current look and feel is editorial, museum-inspired, and dark-toned, with clear AI labelling and trust messaging across the interface.

## Known implementation notes

- The compose file still includes a top-level `version` key, and modern Docker Compose warns that it is obsolete and ignored. This can be removed safely.
- Both Ollama and FastAPI are managed by supervisord inside the single container.
- On first run, Ollama may take time to initialize and pull the required model.
- The Stable Diffusion model downloads on first use, so initial image generation requests may take noticeably longer.
- The Visual Search page currently uses a text model to infer search suggestions rather than true image embedding similarity.

## Verified current state

As of March 30, 2026, the repository has been updated to:

- Use a unified single-container Docker setup with supervisord managing both Ollama and FastAPI
- Build from `ollama/ollama:latest` base image
- Run Ollama on port `11434` and FastAPI on port `80`
- Expose both API endpoints from a single `museum-app` service
- Use `phi3:mini` as the default Ollama model
- Use `runwayml/stable-diffusion-v1-5` as the default SD model
- Support GPU acceleration via `gpus: all` in docker-compose.yml

## Development notes

If you change Ollama model names, update the hardcoded model values in:

- `pages/chatbot.html`
- `pages/visual.html`
- `pages/generative.html`

If you change the Stable Diffusion service location or port, update the endpoints in:

- `pages/generative.html`
- `docker-compose.yml`
- `sd-server/app.py` if the backend behavior changes
