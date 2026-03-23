# V&A AI Collection Explorer

A multi-tool AI-powered interface for exploring the Victoria & Albert Museum's collection of 2.3 million objects, designed with transparency, inclusion, and cultural sensitivity at its core.

## Tools

| Tool | Purpose |
|------|---------|
| **Ask the Collection** | Conversational AI chatbot powered by V&A API + local Ollama phi3 |
| **Discover** | Bias-aware personalised recommender with serendipity and underrepresented modes |
| **Visual Search** | Upload or describe an image to find visually similar artefacts |
| **Reimagine** | Generative AI interpretations through cultural, historical, and thematic lenses |
| **AI & Trust** | Full transparency page covering principles, bias, accessibility, and FAQs |

## Running with Docker

### Prerequisites
- Docker and Docker Compose installed

### Quick start

```bash
# Clone / copy the project directory
cd museum-ai

# Build and run
docker-compose up --build -d

# Access at http://localhost:8080
```

### Stop
```bash
docker-compose down
```

### Rebuild after changes
```bash
docker-compose up --build -d
```

## Running without Docker

Simply open `index.html` in a browser, or serve with any static file server:

```bash
# Python
python3 -m http.server 8080

# Node.js
npx serve .

# VS Code Live Server — right-click index.html > Open with Live Server
```

## API Notes

### V&A Collections API
All artefact data is fetched live from the free, public [V&A Collections API v2](https://api.vam.ac.uk/v2/). No API key required.

Key endpoints used:
- `GET /v2/objects/search` — search with filters (material, technique, place, person, etc.)
- `GET /v2/object/{id}` — fetch single object detail

### Local Ollama (phi3)
The chatbot, visual analysis, and generative tools call a local Ollama container via `http://localhost:11434/api/chat` using model `phi3`.

If your UI runs inside Docker and Ollama runs on the host, update the endpoint to a reachable host name for your setup (for example `http://host.docker.internal:11434/api/chat` when supported).

## Design System

The project uses a token-based CSS design system (`css/tokens.css`) with:
- **Fonts:** Cormorant Garamond (display) + DM Sans (body)
- **Palette:** Warm dark editorial — charcoal backgrounds, amber/gold accent
- **Accessibility:** WCAG 2.1 AA compliant contrast ratios throughout

## Accessibility Features
- Semantic HTML5 with ARIA landmarks
- Full keyboard navigation
- Screen reader compatible
- Skip-to-content link
- Built-in large text mode (bottom-right toolbar)
- Built-in high contrast mode (bottom-right toolbar)
- Preferences saved to localStorage
- Reduced motion support via `prefers-reduced-motion`

## Design Decisions (from persona research)

Based on the Steve Johnson persona (digital researcher, overwhelmed by large collections, curious about connections, concerned about AI trust):

- **Discovery over search:** All tools emphasise exploration rather than requiring users to know what to search for
- **Transparency everywhere:** AI content is clearly labelled; reasoning shown; sources cited
- **Bias acknowledgement:** Explicit bias notices and an underrepresented collections mode
- **Trust building:** Full AI & Trust page; caveats inline; links to authoritative V&A records
- **No filter bubbles:** Serendipitous and underrepresented discovery modes

## File Structure

```
museum-ai/
├── index.html              # Homepage
├── Dockerfile
├── docker-compose.yml
├── nginx.conf
├── css/
│   ├── tokens.css          # Design tokens
│   └── main.css            # All styles
├── js/
│   └── main.js             # Shared utilities, V&A API helpers, modal
└── pages/
    ├── chatbot.html         # Ask the Collection
    ├── recommender.html     # Discover
    ├── visual.html          # Visual Search
    ├── generative.html      # Reimagine
    └── transparency.html    # AI & Trust
```
