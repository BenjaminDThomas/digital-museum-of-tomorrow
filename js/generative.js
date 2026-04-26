'use strict';

// Generative page controller (legacy standalone version). Handles artefact search,
// lens selection, JSON-formatted Ollama requests, and Stable Diffusion image output.
// The reimagine-page.js version supersedes this with streamed responses and history.
function initGenerativePage() {
  const lensGrid = document.getElementById('lens-grid');
  if (!lensGrid) return;

  // Interpretive lenses the user can pick to frame the AI response.
  const lenses = [
    { id: 'cultural', icon: '\uD83C\uDF0D', title: 'Cultural connections', desc: 'How does this object connect to similar traditions in other cultures?' },
    { id: 'historical', icon: '\u23F3', title: 'Through time', desc: 'How would this object have been understood in different time periods?' },
    { id: 'material', icon: '\uD83D\uDD2C', title: 'Material stories', desc: 'What journeys did the materials take to become this object?' },
    { id: 'maker', icon: '\uD83E\uDD32', title: 'The maker\'s hand', desc: 'Who made this and what was their world like?' },
    { id: 'symbol', icon: '\u2736', title: 'Symbols and meaning', desc: 'What symbols, motifs, or hidden meanings does this carry?' },
    { id: 'contemporary', icon: '\uD83C\uDF31', title: 'Contemporary resonance', desc: 'How does this object speak to contemporary issues?' },
  ];
  const generativeSystem = `You are a thoughtful, imaginative museum educator at A2BC. Your role is to create engaging, accurate, and culturally sensitive interpretations of museum artefacts from specific perspectives.

When given an artefact and an interpretive lens, you:
1. Write a poetic, evocative opening passage (2-3 sentences) about the artefact from that lens
2. Provide a substantive cultural/historical analysis (3-4 paragraphs) that is educational and nuanced
3. Surface 3-4 specific connections to other A2BC objects or broader cultural movements as search suggestions
4. Always acknowledge limitations and areas where interpretation is uncertain

Format your response as JSON:
{
  "opening": "Poetic opening passage",
  "analysis": "Full educational analysis text",
  "connections": [
    {"label": "Connection title", "search": "V&A API search term", "reason": "Why this connects"},
    ...
  ],
  "caveats": "Any important caveats about the interpretation"
}

Be culturally sensitive, avoid stereotypes, and acknowledge when historical accounts were written from a colonial or limited perspective. This content will be clearly labelled as AI interpretation.`;
  const ollamaChatUrl = 'http://localhost:11434/api/chat';
  const ollamaTagsUrl = 'http://localhost:11434/api/tags';
  const isLocalPreviewHost = ['127.0.0.1', 'localhost'].includes(window.location.hostname)
    && window.location.port
    && window.location.port !== '80';
  const sdApiBaseUrl = isLocalPreviewHost ? 'http://localhost' : window.location.origin;
  const sdTxt2ImgUrl = `${sdApiBaseUrl}/sdapi/v1/txt2img`;
  const sdModelsUrl = `${sdApiBaseUrl}/sdapi/v1/sd-models`;
  // Stable Diffusion style keywords mapped to each interpretive lens.
  const sdLensPrompts = {
    cultural: 'cross-cultural artistic fusion, world art traditions, multicultural decorative motifs',
    historical: 'historical period art style, period-accurate aesthetic, art history reimagining',
    material: 'rich material texture detail, artisan craftsmanship, raw materials close-up',
    maker: 'handcraft workshop aesthetic, traditional making technique, artisan detail',
    symbol: 'ornate symbolic iconography, decorative motifs, sacred geometry patterns',
    contemporary: 'contemporary modern art reinterpretation, minimalist redesign, modern aesthetic',
  };

  let selectedArtefact = null;
  let selectedLens = null;
  let ollamaChecked = false;
  let sdStatusPollId = null;

  // Ping the Ollama tags endpoint to confirm the server is reachable before sending requests.
  async function checkOllamaApi() {
    if (ollamaChecked) return;
    const response = await fetch(ollamaTagsUrl, { method: 'GET' });
    if (!response.ok) throw new Error(`Ollama health check failed: ${response.status}`);
    ollamaChecked = true;
  }

  // Send a non-streaming JSON format request to Ollama and parse the response.
  async function callOllamaJson(systemPrompt, userPrompt) {
    await checkOllamaApi();
    const response = await fetch(ollamaChatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'phi3:mini',
        format: 'json',
        stream: false,
        options: { num_predict: 1000 },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });
    if (!response.ok) throw new Error(`Ollama request failed: ${response.status}`);

    const data = await response.json();
    const text = (data.message?.content || '').replace(/```json|```/g, '').trim();
    try {
      return JSON.parse(text);
    } catch (_) {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Text model did not return valid JSON.');
      return JSON.parse(jsonMatch[0]);
    }
  }

  // Update the SD status badge with a ready, loading, error, missing, or offline state.
  function setSdStatusBadge(state, message = '') {
    if (state === 'ready') {
      sdStatusBadge.textContent = '\u25cf Stable Diffusion ready';
      sdStatusBadge.className = 'sd-status-badge sd-status-badge--online';
      return;
    }
    if (state === 'loading') {
      sdStatusBadge.textContent = '\u25cf Stable Diffusion loading model - first run may take several minutes';
      sdStatusBadge.className = 'sd-status-badge sd-status-badge--offline';
      return;
    }
    if (state === 'error') {
      sdStatusBadge.textContent = `\u25cf Stable Diffusion failed: ${message || 'startup error'}`;
      sdStatusBadge.className = 'sd-status-badge sd-status-badge--offline';
      return;
    }
    if (state === 'missing') {
      sdStatusBadge.textContent = '\u25cf Stable Diffusion unavailable';
      sdStatusBadge.className = 'sd-status-badge sd-status-badge--offline';
      return;
    }
    sdStatusBadge.textContent = '\u25cf Stable Diffusion offline';
    sdStatusBadge.className = 'sd-status-badge sd-status-badge--offline';
  }

  // Poll the SD API every 10 seconds until it reports ready or a terminal error.
  function startSdStatusPolling() {
    if (sdStatusPollId) return;
    sdStatusPollId = window.setInterval(async () => {
      const status = await checkSdApi();
      if (status.ready || status.error) {
        window.clearInterval(sdStatusPollId);
        sdStatusPollId = null;
      }
    }, 10000);
  }

  // Enable or disable the Generate button depending on whether an artefact and lens are chosen.
  function updateGenerateButton() {
    document.getElementById('generate-btn').disabled = !(selectedArtefact && selectedLens);
  }

  lenses.forEach(lens => {
    const card = document.createElement('button');
    card.className = 'lens-card';
    card.type = 'button';
    card.setAttribute('aria-pressed', 'false');
    card.dataset.id = lens.id;
    card.innerHTML = `
      <div class="lens-card__icon" aria-hidden="true">${lens.icon}</div>
      <div class="lens-card__title">${lens.title}</div>
      <div class="lens-card__desc">${lens.desc}</div>
    `;
    card.addEventListener('click', () => {
      document.querySelectorAll('.lens-card').forEach(item => {
        item.classList.remove('selected');
        item.setAttribute('aria-pressed', 'false');
      });
      card.classList.add('selected');
      card.setAttribute('aria-pressed', 'true');
      selectedLens = lens;
      updateGenerateButton();
    });
    lensGrid.appendChild(card);
  });

  const artefactSearch = document.getElementById('artefact-search');
  const dropdown = document.getElementById('search-dropdown');
  const sdStatusBadge = document.getElementById('sd-status-badge');
  let searchTimeout;

  // Search the collection as the user types, showing results in a dropdown.
  artefactSearch.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const value = artefactSearch.value.trim();
    if (value.length < 3) {
      dropdown.classList.remove('open');
      return;
    }
    searchTimeout = setTimeout(() => doArtefactSearch(value), 400);
  });

  artefactSearch.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      dropdown.classList.remove('open');
      artefactSearch.focus();
    }
    if (event.key === 'ArrowDown') {
      const first = dropdown.querySelector('.dropdown-item');
      if (first) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  // Close the dropdown when clicking outside the search box.
  document.addEventListener('click', event => {
    if (!artefactSearch.closest('.artefact-search-box').contains(event.target)) {
      dropdown.classList.remove('open');
    }
  });

  // Fetch up to five matching artefacts from the V&A API and populate the dropdown.
  async function doArtefactSearch(query) {
    try {
      const data = await window.VAM.searchObjects({ q: query, page_size: 5 });
      const records = data.records || [];
      dropdown.innerHTML = '';
      if (!records.length) {
        dropdown.innerHTML = '<p class="search-results-dropdown__empty">No results found</p>';
        dropdown.classList.add('open');
        return;
      }
      records.forEach(record => {
        const item = document.createElement('button');
        item.className = 'dropdown-item';
        item.type = 'button';
        item.setAttribute('role', 'option');
        const imageUrl = window.VAM.getArtefactImageUrl(record, 'thumb');
        const title = record._primaryTitle || record.objectType || 'Object';
        const date = window.VAM.formatDateRange(record);
        item.innerHTML = `
          ${imageUrl ? `<img src="${imageUrl}" alt="" />` : '<div class="dropdown-item__placeholder"></div>'}
          <div>
            <div class="dropdown-item__title">${window.VAM.escHtml(title.slice(0, 50))}</div>
            <div class="dropdown-item__meta">${window.VAM.escHtml(record.objectType || '')} \u00b7 ${window.VAM.escHtml(date)}</div>
          </div>
        `;
        item.addEventListener('click', () => selectArtefact(record));
        item.addEventListener('keydown', event => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            item.nextElementSibling?.focus();
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            item.previousElementSibling?.focus() || artefactSearch.focus();
          }
          if (event.key === 'Escape') {
            dropdown.classList.remove('open');
            artefactSearch.focus();
          }
        });
        dropdown.appendChild(item);
      });
      dropdown.classList.add('open');
    } catch (_) {
      dropdown.classList.remove('open');
    }
  }

  // Confirm an artefact choice, update the preview panel, and check SD readiness.
  function selectArtefact(record) {
    selectedArtefact = record;
    dropdown.classList.remove('open');
    const title = record._primaryTitle || record.objectType || 'Object';
    artefactSearch.value = title;

    const imageUrl = window.VAM.getArtefactImageUrl(record, 'medium');
    const selected = document.getElementById('selected-artefact');
    const selectedImage = document.getElementById('selected-img');
    const selectedTitle = document.getElementById('selected-title');
    const selectedDate = document.getElementById('selected-date');

    selectedTitle.textContent = title;
    selectedDate.textContent = `${window.VAM.formatDateRange(record)}${record.objectType ? ` \u00b7 ${record.objectType}` : ''}`;
    if (imageUrl) {
      selectedImage.src = imageUrl;
      selectedImage.alt = title;
      selectedImage.hidden = false;
    } else {
      selectedImage.removeAttribute('src');
      selectedImage.alt = '';
      selectedImage.hidden = true;
    }
    selected.classList.add('show');
    updateGenerateButton();
    checkSdApi();
  }

  // Check the SD backend and update the status badge on the page.
  async function checkSdApi() {
    try {
      const response = await fetch(sdModelsUrl, { signal: AbortSignal.timeout(3000) });
      if (response.ok) {
        const models = await response.json();
        const model = Array.isArray(models) ? models[0] : null;
        if (model?.loaded) {
          setSdStatusBadge('ready');
          return { ready: true, loading: false, error: null };
        }
        if (model?.loading) {
          setSdStatusBadge('loading');
          startSdStatusPolling();
          return { ready: false, loading: true, error: null };
        }
        if (model?.error) {
          setSdStatusBadge('error', model.error);
          return { ready: false, loading: false, error: model.error };
        }
        setSdStatusBadge('missing');
        return { ready: false, loading: false, error: 'No model reported by backend.' };
      }
    } catch (_) {
      // ignore
    }
    setSdStatusBadge('offline');
    return { ready: false, loading: false, error: 'Service offline.' };
  }

  // Send the artefact and lens to Stable Diffusion and render the output image.
  async function runSdReimagining(lensId, customQuestion) {
    const output = document.getElementById('sd-output');
    if (!output) return;

    const sdStatus = await checkSdApi();
    if (!sdStatus.ready) {
      output.className = 'sd-output sd-output--error';
      output.innerHTML = `
        <p class="sd-output__error-message">
          <strong>Visual reimagining unavailable.</strong>
          ${sdStatus.loading
            ? 'Stable Diffusion is still downloading or loading its model. First startup can take several minutes. Try again when the badge says ready.'
            : window.VAM.escHtml(sdStatus.error || 'Stable Diffusion is not currently available.')}
        </p>
      `;
      return;
    }

    const lensStyle = sdLensPrompts[lensId] || 'artistic reimagining';
    const artefactTitle = selectedArtefact._primaryTitle || selectedArtefact.objectType || 'artefact';
    const artefactDescription = selectedArtefact._primaryDescription?.[0]?.value || selectedArtefact.briefDescription || '';
    const descriptionPart = artefactDescription ? `, ${artefactDescription.slice(0, 120)}` : '';
    const customPart = customQuestion ? `, ${customQuestion}` : '';
    const prompt = `${artefactTitle}${descriptionPart}, ${lensStyle}${customPart}, museum quality, detailed, high resolution`;

    output.className = 'sd-output sd-output--loading';
    output.innerHTML = `
      <div class="sd-output__spinner" aria-hidden="true">\u2736</div>
      <p class="sd-output__status">Generating visual reimagining \u2014 this may take 20\u201360 seconds\u2026</p>
    `;

    try {
      const response = await fetch(sdTxt2ImgUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          negative_prompt: 'blurry, ugly, watermark, text, low quality, deformed',
          steps: 20,
          width: 512,
          height: 512,
          cfg_scale: 7,
          sampler_name: 'Euler a'
        })
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`Stable Diffusion error ${response.status}: ${errorText.slice(0, 200)}`);
      }

      const data = await response.json();
      const outputBase64 = data.images?.[0];
      if (!outputBase64) throw new Error('Stable Diffusion returned no image data.');

      const escapedTitle = window.VAM.escHtml(artefactTitle);
      output.className = 'sd-output sd-output--result';
      output.innerHTML = `
        <div class="sd-result-label">\u2736 AI-generated visual \u2014 Stable Diffusion \u00b7 ${window.VAM.escHtml(lensStyle)}</div>
        <figure class="sd-figure sd-figure--single">
          <img src="data:image/png;base64,${outputBase64}" alt="AI visual reimagining of ${escapedTitle}" />
          <figcaption>${escapedTitle} \u2014 reimagined through ${window.VAM.escHtml(selectedLens.title)}</figcaption>
        </figure>
        <a class="btn btn--ghost sd-download-btn" href="data:image/png;base64,${outputBase64}" download="reimagined-artefact.png" aria-label="Download reimagined image as PNG">
          \u2193 Download PNG
        </a>
      `;
    } catch (error) {
      output.className = 'sd-output sd-output--error';
      output.innerHTML = `
        <p class="sd-output__error-message">
          <strong>Visual reimagining unavailable.</strong> ${window.VAM.escHtml(error.message)}
        </p>
      `;
    }
  }

  // Request a JSON interpretation from Ollama and render the parsed result.
  async function generateInterpretation() {
    if (!selectedArtefact || !selectedLens) return;

    const sdOutput = document.getElementById('sd-output');
    if (sdOutput) {
      sdOutput.innerHTML = '';
      sdOutput.className = 'sd-output';
    }

    const customQuestion = document.getElementById('custom-prompt').value.trim();
    runSdReimagining(selectedLens.id, customQuestion);

    const output = document.getElementById('generation-output');
    output.className = 'generation-output loading';
    output.innerHTML = `
      <div class="spinning generation-output__spinner" aria-hidden="true">\u2736</div>
      <p class="generation-output__status">Generating interpretation\u2026</p>
    `;

    const title = selectedArtefact._primaryTitle || selectedArtefact.objectType || 'Object';
    const description = selectedArtefact._primaryDescription?.[0]?.value || selectedArtefact.briefDescription || '';
    const date = window.VAM.formatDateRange(selectedArtefact);
    const userPrompt = `
Artefact: ${title}
Type: ${selectedArtefact.objectType || 'Unknown'}
Date: ${date}
Description: ${description}
Lens: ${selectedLens.title} \u2014 ${selectedLens.desc}
${customQuestion ? `Additional question: ${customQuestion}` : ''}

Please generate an interpretation of this artefact through the "${selectedLens.title}" lens.`;

    try {
      const parsed = await callOllamaJson(generativeSystem, userPrompt);
      output.className = 'generation-output';
      output.innerHTML = `
        <div class="generation-label">
          <strong>\u2736 AI-generated interpretation</strong> \u2014 <span>Lens: ${selectedLens.icon} ${selectedLens.title}</span>
        </div>
        <div class="generation-text" id="gen-opening"></div>
        <div class="generation-analysis" id="gen-analysis"></div>
        ${parsed.caveats ? `<div class="bias-notice"><span class="bias-notice__icon">\u2139</span><span>${window.VAM.escHtml(parsed.caveats)}</span></div>` : ''}
        ${parsed.connections?.length ? '<div class="generation-connections"><h4>Explore further</h4><div class="connection-list" id="connection-list"></div></div>' : ''}
      `;

      document.getElementById('gen-opening').textContent = parsed.opening || '';
      document.getElementById('gen-analysis').textContent = parsed.analysis || '';

      if (parsed.connections) {
        const connectionList = document.getElementById('connection-list');
        parsed.connections.forEach(connection => {
          const item = document.createElement('button');
          item.className = 'connection-item';
          item.type = 'button';
          item.innerHTML = `
            <span class="connection-item__arrow">\u2192</span>
            <div>
              <div class="connection-item__title">${window.VAM.escHtml(connection.label)}</div>
              <div class="connection-item__reason">${window.VAM.escHtml(connection.reason)}</div>
            </div>
          `;
          item.addEventListener('click', () => {
            window.open(`https://collections.vam.ac.uk/search/?q=${encodeURIComponent(connection.search)}`, '_blank', 'noopener,noreferrer');
          });
          connectionList?.appendChild(item);
        });
      }
    } catch (error) {
      output.className = 'generation-output';
      output.innerHTML = `
        <p class="generation-output__error">
          <strong>Could not generate interpretation.</strong> ${window.VAM.escHtml(error?.message || 'Please try again.')}
        </p>
      `;
    }
  }

  document.getElementById('generate-btn').addEventListener('click', generateInterpretation);
  checkSdApi();
}

// Initialise the generative page once the DOM is ready.
document.addEventListener('DOMContentLoaded', () => {
  initGenerativePage();
});
