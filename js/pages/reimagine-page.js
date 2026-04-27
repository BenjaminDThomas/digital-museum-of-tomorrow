'use strict';

// Reimagine page controller. Lets users search for a V&A artefact, choose an
// interpretive lens, then generate a streamed AI interpretation and a Stable
// Diffusion visual reimagining with undo/redo history and favourites support.
function initReimaginePage() {
  const lensGrid = document.getElementById('lens-grid');
  if (!lensGrid) return;

  // Interpretive lenses the user can pick to frame the AI response.
  const lenses = [
    { id: 'cultural', icon: '🌍', title: 'Cultural connections', desc: 'How does this object connect to similar traditions in other cultures?' },
    { id: 'historical', icon: '⏳', title: 'Through time', desc: 'How would this object have been understood in different time periods?' },
    { id: 'material', icon: '🔬', title: 'Material stories', desc: 'What journeys did the materials take to become this object?' },
    { id: 'maker', icon: '👐', title: 'The maker\'s hand', desc: 'Who made this and what was their world like?' },
    { id: 'symbol', icon: '✶', title: 'Symbols and meaning', desc: 'What symbols, motifs, or hidden meanings does this carry?' },
    { id: 'contemporary', icon: '🌱', title: 'Contemporary resonance', desc: 'How does this object speak to contemporary issues?' },
  ];
  const generativeSystem = `You are a thoughtful, imaginative museum educator at A2BC. Your role is to create engaging, accurate, and culturally sensitive interpretations of museum artefacts from specific perspectives.

When given an artefact and an interpretive lens, you:
1. Write a poetic, evocative opening passage (2-3 sentences) about the artefact from that lens.
2. Provide a substantive but concise cultural/historical analysis (2-3 short paragraphs).
3. Surface 3 specific connections to other A2BC objects or broader cultural movements as search suggestions.
4. Always acknowledge limitations and areas where interpretation is uncertain.

Format your response exactly like this:
OPENING:
<opening text>

ANALYSIS:
<analysis text>

CONNECTIONS:
- Label :: Search term :: Reason
- Label :: Search term :: Reason
- Label :: Search term :: Reason

CAVEATS:
<caveat text>

Do not use JSON. Do not add any extra headings. Keep the writing accessible, culturally sensitive, and clearly interpretive rather than authoritative.`;
  // Stable Diffusion style keywords mapped to each interpretive lens.
  const sdLensPrompts = {
    cultural: 'cross-cultural artistic fusion, world art traditions, multicultural decorative motifs',
    historical: 'historical period art style, period-accurate aesthetic, art history reimagining',
    material: 'rich material texture detail, artisan craftsmanship, raw materials close-up',
    maker: 'handcraft workshop aesthetic, traditional making technique, artisan detail',
    symbol: 'ornate symbolic iconography, decorative motifs, sacred geometry patterns',
    contemporary: 'contemporary modern art reinterpretation, minimalist redesign, modern aesthetic',
  };

  const isLocalPreviewHost = ['127.0.0.1', 'localhost'].includes(window.location.hostname)
    && window.location.port
    && window.location.port !== '80';
  const sdApiBaseUrl = isLocalPreviewHost ? 'http://localhost' : window.location.origin;
  const sdTxt2ImgUrl = `${sdApiBaseUrl}/sdapi/v1/txt2img`;
  const sdModelsUrl = `${sdApiBaseUrl}/sdapi/v1/sd-models`;

  let selectedArtefact = null;
  let selectedLens = null;
  let sdStatusPollId = null;
  let generationHistory = [];
  let currentHistoryIndex = -1;

  // Update the SD status badge with a ready, loading, error, missing, or offline state.
  function setSdStatusBadge(state, message = '') {
    const sdStatusBadge = document.getElementById('sd-status-badge');
    if (!sdStatusBadge) return;
    if (state === 'ready') {
      sdStatusBadge.textContent = '● Stable Diffusion ready';
      sdStatusBadge.className = 'sd-status-badge sd-status-badge--online';
      return;
    }
    if (state === 'loading') {
      sdStatusBadge.textContent = '● Stable Diffusion loading model - first run may take several minutes';
      sdStatusBadge.className = 'sd-status-badge sd-status-badge--offline';
      return;
    }
    if (state === 'error') {
      sdStatusBadge.textContent = `● Stable Diffusion failed: ${message || 'startup error'}`;
      sdStatusBadge.className = 'sd-status-badge sd-status-badge--offline';
      return;
    }
    if (state === 'missing') {
      sdStatusBadge.textContent = '● Stable Diffusion unavailable';
      sdStatusBadge.className = 'sd-status-badge sd-status-badge--offline';
      return;
    }
    sdStatusBadge.textContent = '● Stable Diffusion offline';
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

  // Persist the current generation to the favourites list in local storage.
  function saveToFavorites(generation) {
    const favorites = JSON.parse(localStorage.getItem('vam-favorites') || '[]');
    favorites.push({
      ...generation,
      savedAt: new Date().toISOString(),
      id: Date.now()
    });
    localStorage.setItem('vam-favorites', JSON.stringify(favorites));
    alert('Reimagining saved to favorites!');
  }

  // Push a generation onto the history stack, discarding any future entries.
  function addToHistory(generation) {
    // Remove any history after current index (for when user generates after undo)
    generationHistory = generationHistory.slice(0, currentHistoryIndex + 1);
    generationHistory.push(generation);
    currentHistoryIndex = generationHistory.length - 1;
    updateHistoryButtons();
  }

  // Sync the enabled state of the undo and redo buttons with the current history position.
  function updateHistoryButtons() {
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');
    if (undoBtn) undoBtn.disabled = currentHistoryIndex <= 0;
    if (redoBtn) redoBtn.disabled = currentHistoryIndex >= generationHistory.length - 1;
  }

  // Step back one entry in the generation history.
  function undoGeneration() {
    if (currentHistoryIndex > 0) {
      currentHistoryIndex--;
      const previousGeneration = generationHistory[currentHistoryIndex];
      restoreGeneration(previousGeneration);
      updateHistoryButtons();
    }
  }

  // Step forward one entry in the generation history.
  function redoGeneration() {
    if (currentHistoryIndex < generationHistory.length - 1) {
      currentHistoryIndex++;
      const nextGeneration = generationHistory[currentHistoryIndex];
      restoreGeneration(nextGeneration);
      updateHistoryButtons();
    }
  }

  // Re-render the output panels for a previously generated entry.
  function restoreGeneration(generation) {
    // Restore the generation state
    const output = document.getElementById('generation-output');
    const sdOutput = document.getElementById('sd-output');

    if (generation.interpretation) {
      renderFinalInterpretation(output, generation.interpretation);
    }

    if (generation.visualData) {
      const escapedTitle = window.VAM.escHtml(generation.artefactTitle);
      sdOutput.className = 'sd-output sd-output--result';
      sdOutput.innerHTML = `
        <div class="sd-result-label">✶ AI-generated visual — Stable Diffusion · ${window.VAM.escHtml(generation.lensStyle)}</div>
        <figure class="sd-figure sd-figure--single">
          <img src="${generation.visualData}" alt="AI visual reimagining of ${escapedTitle}" />
          <figcaption>${escapedTitle} — reimagined through ${window.VAM.escHtml(generation.lensTitle)}</figcaption>
        </figure>
        <a class="btn btn--ghost sd-download-btn" href="${generation.visualData}" download="reimagined-artefact.png" aria-label="Download reimagined image as PNG">
          ↓ Download PNG
        </a>
        <button class="btn btn--ghost save-favorite-btn" id="save-favorite-btn">♥ Save to Favorites</button>
      `;

      // Re-attach save event
      document.getElementById('save-favorite-btn').addEventListener('click', () => saveToFavorites(generation));
    }
  }

  // Parse the OPENING/ANALYSIS/CONNECTIONS/CAVEATS sections from the model's plain-text reply.
  function parseInterpretationResponse(text) {
    const normalized = String(text || '').trim();
    const extractSection = (startLabel, endLabel) => {
      const regex = endLabel
        ? new RegExp(`${startLabel}:\\s*([\\s\\S]*?)\\n\\s*${endLabel}:`, 'i')
        : new RegExp(`${startLabel}:\\s*([\\s\\S]*)$`, 'i');
      return normalized.match(regex)?.[1]?.trim() || '';
    };

    const opening = extractSection('OPENING', 'ANALYSIS');
    const analysis = extractSection('ANALYSIS', 'CONNECTIONS') || extractSection('ANALYSIS', 'CAVEATS');
    const connectionsBlock = extractSection('CONNECTIONS', 'CAVEATS');
    const caveats = extractSection('CAVEATS');
    const connections = connectionsBlock
      .split('\n')
      .map(line => line.replace(/^[-•]\s*/, '').trim())
      .filter(Boolean)
      .map(line => {
        const [label, search, reason] = line.split(/\s*::\s*/);
        return { label: label || 'Related connection', search: search || label || '', reason: reason || '' };
      })
      .filter(connection => connection.search);

    return {
      opening,
      analysis: analysis || normalized,
      connections,
      caveats,
    };
  }

  // Show a live streaming preview of the interpretation as tokens arrive.
  function renderStreamingInterpretation(container, text) {
    container.className = 'generation-output';
    container.innerHTML = `
      <div class="generation-label">
        <strong>✶ AI-generated interpretation</strong> — <span>Streaming response…</span>
      </div>
      <div class="generation-analysis" id="generation-streaming-text"></div>
    `;
    window.A2BCText.renderInline(container.querySelector('#generation-streaming-text'), text);
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
  let searchTimeout;

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

  document.addEventListener('click', event => {
    if (!artefactSearch.closest('.artefact-search-box').contains(event.target)) {
      dropdown.classList.remove('open');
    }
  });

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
            <div class="dropdown-item__meta">${window.VAM.escHtml(record.objectType || '')} · ${window.VAM.escHtml(date)}</div>
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
    selectedDate.textContent = `${window.VAM.formatDateRange(record)}${record.objectType ? ` · ${record.objectType}` : ''}`;
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
      // Ignore temporary startup failures.
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
      <div class="sd-output__spinner" aria-hidden="true">✶</div>
      <p class="sd-output__status">Generating visual reimagining — this may take 20–60 seconds…</p>
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
        <div class="sd-result-label">✶ AI-generated visual — Stable Diffusion · ${window.VAM.escHtml(lensStyle)}</div>
        <figure class="sd-figure sd-figure--single">
          <img src="data:image/png;base64,${outputBase64}" alt="AI visual reimagining of ${escapedTitle}" />
          <figcaption>${escapedTitle} — reimagined through ${window.VAM.escHtml(selectedLens.title)}</figcaption>
        </figure>
        <div class="sd-actions">
          <a class="btn btn--ghost sd-download-btn" href="data:image/png;base64,${outputBase64}" download="reimagined-artefact.png" aria-label="Download reimagined image as PNG">
            ↓ Download PNG
          </a>
          <button class="btn btn--ghost save-favorite-btn" id="save-visual-favorite-btn">♥ Save to Favorites</button>
        </div>
      `;

      // Store visual generation in history
      const visualGeneration = {
        artefact: selectedArtefact,
        lens: selectedLens,
        visualData: `data:image/png;base64,${outputBase64}`,
        artefactTitle: artefactTitle,
        lensStyle: lensStyle,
        lensTitle: selectedLens.title,
        timestamp: new Date().toISOString()
      };
      addToHistory(visualGeneration);

      // Add save event listener
      document.getElementById('save-visual-favorite-btn').addEventListener('click', () => saveToFavorites(visualGeneration));
    } catch (error) {
      output.className = 'sd-output sd-output--error';
      output.innerHTML = `
        <p class="sd-output__error-message">
          <strong>Visual reimagining unavailable.</strong> ${window.VAM.escHtml(error.message)}
        </p>
      `;
    }
  }

  // Render the fully parsed interpretation with opening, analysis, caveats, and connections.
  function renderFinalInterpretation(output, interpretation) {
    output.className = 'generation-output';
    output.innerHTML = `
      <div class="generation-label">
        <strong>✶ AI-generated interpretation</strong> — <span>Lens: ${selectedLens.icon} ${selectedLens.title}</span>
      </div>
      <div class="generation-text" id="gen-opening"></div>
      <div class="generation-analysis" id="gen-analysis"></div>
      ${interpretation.caveats ? `<div class="bias-notice"><span class="bias-notice__icon">ℹ</span><span>${window.VAM.escHtml(interpretation.caveats)}</span></div>` : ''}
      ${interpretation.connections?.length ? '<div class="generation-connections"><h4>Explore further</h4><div class="connection-list" id="connection-list"></div></div>' : ''}
      <div class="generation-actions">
        <button class="btn btn--ghost save-favorite-btn" id="save-favorite-btn">♥ Save to Favorites</button>
      </div>
    `;

    document.getElementById('gen-opening').textContent = interpretation.opening || '';
    window.A2BCText.renderParagraphs(document.getElementById('gen-analysis'), interpretation.analysis || '');

    if (interpretation.connections?.length) {
      const connectionList = document.getElementById('connection-list');
      interpretation.connections.forEach(connection => {
        const item = document.createElement('button');
        item.className = 'connection-item';
        item.type = 'button';
        item.innerHTML = `
          <span class="connection-item__arrow">→</span>
          <div>
            <div class="connection-item__title">${window.VAM.escHtml(connection.label)}</div>
            <div class="connection-item__reason">${window.VAM.escHtml(connection.reason)}</div>
          </div>
        `;
      // Open the V&A search results for this connection in a new tab.
      item.addEventListener('click', () => {
        window.open(`https://collections.vam.ac.uk/search/?q=${encodeURIComponent(connection.search)}`, '_blank', 'noopener,noreferrer');
        });
        connectionList.appendChild(item);
      });
    }

      // Store this generation in history.
      const generation = {
      artefact: selectedArtefact,
      lens: selectedLens,
      interpretation: interpretation,
      timestamp: new Date().toISOString()
    };
    addToHistory(generation);

      // Add save event listener
      document.getElementById('save-favorite-btn').addEventListener('click', () => saveToFavorites(generation));
  }

  // Kick off SD image generation and stream the textual interpretation in parallel.
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
      <div class="spinning generation-output__spinner" aria-hidden="true">✶</div>
      <p class="generation-output__status">Generating interpretation…</p>
    `;

    const title = selectedArtefact._primaryTitle || selectedArtefact.objectType || 'Object';
    const description = selectedArtefact._primaryDescription?.[0]?.value || selectedArtefact.briefDescription || '';
    const date = window.VAM.formatDateRange(selectedArtefact);
    const userPrompt = `
Artefact: ${title}
Type: ${selectedArtefact.objectType || 'Unknown'}
Date: ${date}
Description: ${description}
Lens: ${selectedLens.title} — ${selectedLens.desc}
${customQuestion ? `Additional question: ${customQuestion}` : ''}

Please generate an interpretation of this artefact through the "${selectedLens.title}" lens.`;

    try {
      const streamedText = await window.A2BCOllama.streamChat({
        systemPrompt: generativeSystem,
        userPrompt,
        options: { num_predict: 800, temperature: 0.4 },
        onText: partialText => renderStreamingInterpretation(output, partialText)
      });
      const parsed = parseInterpretationResponse(streamedText);
      renderFinalInterpretation(output, parsed);
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
  document.getElementById('undo-btn').addEventListener('click', undoGeneration);
  document.getElementById('redo-btn').addEventListener('click', redoGeneration);
  updateHistoryButtons();
  checkSdApi();
}

document.addEventListener('DOMContentLoaded', () => {
  initReimaginePage();
});
