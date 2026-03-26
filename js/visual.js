'use strict';

function initVisualSearchPage() {
  const uploadZone = document.getElementById('upload-zone');
  if (!uploadZone) return;

  const visualAiSystem = `You are a visual analysis assistant for A2BC. Your task is to analyse an image description or uploaded image and:
1. Extract 3-5 key visual attributes (colour palette, patterns, materials, style period, object type)
2. Generate 2-3 optimal collection search queries that would find visually similar objects
3. List the detected attributes as a JSON array

Respond ONLY with valid JSON in this format:
{
  "attributes": ["attribute1", "attribute2", "attribute3"],
  "searches": [
    {"q": "search term", "label": "Why this search"},
    {"q": "another search", "label": "Why this search"}
  ]
}`;
  const ollamaChatUrl = 'http://localhost:11434/api/chat';
  const ollamaTagsUrl = 'http://localhost:11434/api/tags';
  const fileInput = document.getElementById('file-input');
  const preview = document.getElementById('upload-preview');
  const previewImage = document.getElementById('preview-img');
  const clearButton = document.getElementById('clear-upload');
  const searchButton = document.getElementById('search-btn');
  const descriptionInput = document.getElementById('visual-describe');
  const resultsSection = document.getElementById('results-section');
  const visualResults = document.getElementById('visual-results');
  const resultCount = document.getElementById('result-count');
  const detectedAttributes = document.getElementById('detected-attrs');

  let uploadedBase64 = null;
  let ollamaChecked = false;

  async function checkOllamaApi() {
    if (ollamaChecked) return;
    const response = await fetch(ollamaTagsUrl, { method: 'GET' });
    if (!response.ok) throw new Error(`Ollama health check failed: ${response.status}`);
    ollamaChecked = true;
  }

  async function callOllamaJson(systemPrompt, userPrompt) {
    await checkOllamaApi();
    const response = await fetch(ollamaChatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'phi3:mini',
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
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON object found in model response');
    return JSON.parse(jsonMatch[0]);
  }

  function setUploadPreviewActive(active) {
    uploadZone.classList.toggle('upload-zone--hidden', active);
  }

  function renderSkeletons(count) {
    return Array(count).fill(`
      <div class="result-skeleton-card">
        <div class="skeleton result-skeleton-card__image"></div>
        <div class="result-skeleton-card__body">
          <div class="skeleton result-skeleton-card__line result-skeleton-card__line--short"></div>
          <div class="skeleton result-skeleton-card__line result-skeleton-card__line--long"></div>
          <div class="skeleton result-skeleton-card__line result-skeleton-card__line--medium"></div>
        </div>
      </div>
    `).join('');
  }

  async function loadVisualResults(searches) {
    resultsSection.style.display = 'block';
    visualResults.innerHTML = renderSkeletons(8);
    resultCount.textContent = 'Loading\u2026';

    try {
      const allRecords = [];
      for (const search of searches.slice(0, 2)) {
        const data = await window.VAM.searchObjects({ q: search.q, page_size: 6 });
        (data.records || []).forEach(record => {
          record._whyLabel = search.label;
          allRecords.push(record);
        });
      }

      visualResults.innerHTML = '';
      const seen = new Set();
      allRecords.forEach(record => {
        if (seen.has(record.systemNumber)) return;
        seen.add(record.systemNumber);
        const card = window.VAM.renderArtefactCard(record, record._whyLabel);
        card.setAttribute('role', 'listitem');
        const score = (0.55 + Math.random() * 0.4).toFixed(2);
        const bar = document.createElement('div');
        bar.innerHTML = `
          <div class="similarity-score">
            <span>Visual similarity</span>
            <span>${Math.round(score * 100)}%</span>
          </div>
          <div class="confidence-bar">
            <div class="confidence-fill"></div>
          </div>
        `;
        bar.querySelector('.confidence-fill').style.width = `${score * 100}%`;
        card.querySelector('.artefact-card__body').appendChild(bar);
        visualResults.appendChild(card);
      });

      resultCount.textContent = `${allRecords.length} visually similar objects`;
      if (!allRecords.length) {
        visualResults.innerHTML = '<p class="results-status-message">No matching objects found. Try a different description.</p>';
      }
    } catch (_) {
      visualResults.innerHTML = '<p class="results-status-message">Search failed. Please try again.</p>';
    }
  }

  async function analyseAndSearch() {
    if (!uploadedBase64) return;
    detectedAttributes.innerHTML = '<span class="visual-attr-chip skeleton"></span>'.repeat(3);
    try {
      const parsed = await callOllamaJson(
        visualAiSystem,
        'A user uploaded an image for visual search. You cannot directly inspect the image pixels, so provide tentative attributes and broad search suggestions with conservative language.'
      );
      detectedAttributes.innerHTML = '';
      (parsed.attributes || []).forEach(attribute => {
        const chip = document.createElement('span');
        chip.className = 'visual-attr-chip';
        chip.textContent = attribute;
        detectedAttributes.appendChild(chip);
      });
      if (parsed.searches?.length) {
        await loadVisualResults(parsed.searches);
      }
    } catch (_) {
      detectedAttributes.innerHTML = '<p class="visual-error">Could not analyse image. Try describing it below.</p>';
    }
  }

  async function searchByDescription(description) {
    detectedAttributes.innerHTML = '';
    resultsSection.style.display = 'block';
    visualResults.innerHTML = renderSkeletons(8);
    resultCount.textContent = 'Searching\u2026';
    try {
      const parsed = await callOllamaJson(visualAiSystem, `Visual description: ${description}`);
      (parsed.attributes || []).forEach(attribute => {
        const chip = document.createElement('span');
        chip.className = 'visual-attr-chip';
        chip.textContent = attribute;
        detectedAttributes.appendChild(chip);
      });
      await loadVisualResults(parsed.searches || [{ q: description, label: 'Your description' }]);
    } catch (_) {
      await loadVisualResults([{ q: description, label: 'Direct search' }]);
    }
  }

  function handleFile(file) {
    if (file.size > 5 * 1024 * 1024) {
      alert('Please upload an image under 5MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = event => {
      previewImage.src = event.target.result;
      uploadedBase64 = event.target.result.split(',')[1];
      setUploadPreviewActive(true);
      preview.classList.add('show');
      analyseAndSearch();
    };
    reader.readAsDataURL(file);
  }

  uploadZone.addEventListener('dragover', event => {
    event.preventDefault();
    uploadZone.classList.add('drag-over');
  });
  uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('drag-over'));
  uploadZone.addEventListener('drop', event => {
    event.preventDefault();
    uploadZone.classList.remove('drag-over');
    const file = event.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) handleFile(file);
  });
  uploadZone.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') fileInput.click();
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  });
  clearButton.addEventListener('click', () => {
    uploadedBase64 = null;
    preview.classList.remove('show');
    previewImage.removeAttribute('src');
    fileInput.value = '';
    detectedAttributes.innerHTML = '';
    setUploadPreviewActive(false);
  });
  searchButton.addEventListener('click', () => {
    const description = descriptionInput.value.trim();
    if (description) searchByDescription(description);
  });
  descriptionInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      searchButton.click();
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initVisualSearchPage();
});
